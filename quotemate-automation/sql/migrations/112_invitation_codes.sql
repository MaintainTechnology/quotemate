-- Migration 112 — invitation codes (tradie onboarding allowlist + attribution).
-- See docs/superpowers/specs/2026-06-15-invitation-codes-design.md.
-- Idempotent: all `if not exists` / guarded.

-- ── 1. onboarding_codes ──────────────────────────────────────────
create table if not exists onboarding_codes (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,                       -- canonical UPPER-case
  tenant_id    uuid references tenants(id) on delete cascade, -- null = platform-wide
  campaign     text,
  description  text,
  quota_total  integer not null check (quota_total > 0),
  quota_used   integer not null default 0,
  status       text not null default 'active'
                 check (status in ('active','paused','revoked')),
  expires_at   timestamptz,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint quota_not_exceeded check (quota_used <= quota_total)
);

create unique index if not exists idx_onboarding_codes_code_lower
  on onboarding_codes (lower(code));
create index if not exists idx_onboarding_codes_tenant
  on onboarding_codes (tenant_id);

-- ── 2. code_redemptions (attribution ledger) ─────────────────────
create table if not exists code_redemptions (
  id          uuid primary key default gen_random_uuid(),
  code_id     uuid not null references onboarding_codes(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  channel     text not null check (channel in ('web','sms')),
  redeemed_at timestamptz not null default now(),
  unique (code_id, tenant_id)
);
create index if not exists idx_code_redemptions_code on code_redemptions (code_id);

-- ── 3. tenants convenience pointer ───────────────────────────────
alter table tenants
  add column if not exists used_onboarding_code_id uuid
    references onboarding_codes(id) on delete set null;

-- ── 4. RLS — enable, no public policy (matches migration 040 Phase 1) ──
alter table onboarding_codes enable row level security;
alter table code_redemptions enable row level security;

-- ── 4b. Table grants — the API roles need explicit privileges. ──────
-- service_role (used by every /api server route) bypasses RLS but still
-- needs the table GRANT. Some Supabase projects auto-grant new tables via
-- ALTER DEFAULT PRIVILEGES; others don't — so grant explicitly here to
-- keep this migration portable across environments. anon/authenticated
-- are granted too (RLS still gates them to zero rows until a policy lands).
grant select, insert, update, delete on onboarding_codes to service_role;
grant select, insert, update, delete on code_redemptions to service_role;
grant select, insert, update, delete on onboarding_codes to authenticated;
grant select, insert, update, delete on code_redemptions to authenticated;
grant select on onboarding_codes to anon;
grant select on code_redemptions to anon;

-- ── 5. Atomic guarded quota increment ───────────────────────────
-- Returns true if it incremented, false if quota was already full.
create or replace function increment_code_quota(p_code_id uuid)
returns boolean
language plpgsql
as $$
declare
  updated integer;
begin
  update onboarding_codes
     set quota_used = quota_used + 1
   where id = p_code_id
     and quota_used < quota_total;
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;
