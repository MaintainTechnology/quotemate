-- Migration 113 — QR marketing + per-tenant landing page.
-- See docs/superpowers/specs/2026-06-15-qr-marketing-landing-design.md.
-- Idempotent. Explicit grants included (migration 112 portability lesson).

-- ── 1. tenants.slug — powers /t/<slug> landing page ──────────────
alter table tenants add column if not exists slug text;
create unique index if not exists idx_tenants_slug
  on tenants (lower(slug)) where slug is not null;

-- ── 2. marketing_qrs — one row per generated QR ──────────────────
create table if not exists marketing_qrs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  short_code         text not null unique,               -- /s/<short_code>
  label              text not null,
  campaign           text,
  destination_type   text not null check (destination_type in ('sms','landing')),
  destination_config jsonb not null default '{}'::jsonb,  -- sms: { prefill_body }
  status             text not null default 'active'
                       check (status in ('active','paused','archived')),
  scan_count         integer not null default 0,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now()
);
create unique index if not exists idx_marketing_qrs_short_code_lower
  on marketing_qrs (lower(short_code));
create index if not exists idx_marketing_qrs_tenant on marketing_qrs (tenant_id);

-- ── 3. qr_scans — attribution ledger ─────────────────────────────
create table if not exists qr_scans (
  id         uuid primary key default gen_random_uuid(),
  qr_id      uuid not null references marketing_qrs(id) on delete cascade,
  scanned_at timestamptz not null default now(),
  user_agent text,
  referrer   text
);
create index if not exists idx_qr_scans_qr on qr_scans (qr_id);

-- ── 4. lead_throttle — minimal per-key rate limiting ─────────────
-- No rate-limit infra exists yet; this table backs the public lead
-- endpoint's per-mobile + per-IP throttle (1-hour fixed windows).
create table if not exists lead_throttle (
  key          text primary key,                          -- 'mobile:+61...' | 'ip:1.2.3.4'
  window_start timestamptz not null default now(),
  count        integer not null default 0
);

-- ── 5. RPCs — atomic counters ────────────────────────────────────
create or replace function increment_qr_scan(p_qr_id uuid)
returns void language sql as $$
  update marketing_qrs set scan_count = scan_count + 1 where id = p_qr_id;
$$;

-- Fixed-window throttle bump. Resets the window when older than p_window
-- seconds. Returns the post-increment count so the caller can 429.
create or replace function bump_lead_throttle(p_key text, p_window_seconds integer)
returns integer
language plpgsql
as $$
declare
  cur_count integer;
begin
  insert into lead_throttle (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case
                  when lead_throttle.window_start < now() - make_interval(secs => p_window_seconds)
                    then 1
                  else lead_throttle.count + 1
                end,
        window_start = case
                  when lead_throttle.window_start < now() - make_interval(secs => p_window_seconds)
                    then now()
                  else lead_throttle.window_start
                end
  returning count into cur_count;
  return cur_count;
end;
$$;

-- ── 6. RLS — enable, no public policy (matches migration 040/112) ──
alter table marketing_qrs enable row level security;
alter table qr_scans enable row level security;
alter table lead_throttle enable row level security;

-- ── 7. Explicit grants (migration-112 portability lesson) ────────
grant select, insert, update, delete on marketing_qrs to service_role;
grant select, insert, update, delete on qr_scans to service_role;
grant select, insert, update, delete on lead_throttle to service_role;
grant select, insert, update, delete on marketing_qrs to authenticated;
grant select, insert, update, delete on qr_scans to authenticated;
grant select on marketing_qrs to anon;
grant select, insert on qr_scans to anon;
