-- Migration 099 · Electrical plan uploads + AI take-off extractions
--
-- Backs the "Estimator (Beta)" dashboard tab: a tradie uploads an electrical
-- plan PDF, Claude produces a quantity take-off (item/symbol/count/confidence),
-- the tradie corrects the counts, and the result is saved.
--
-- Two tenant-scoped tables (mirrors migration 023/028 tenant-owned data so a bug
-- can never leak one tenant's plan into another's):
--   plan_uploads     — metadata per uploaded plan PDF (filename, sheet hint,
--                      raster-vs-vector flag). The raw PDF bytes are NOT stored
--                      in v1 — only the metadata + the extraction result.
--   plan_extractions — the AI take-off (items jsonb) plus the tradie's corrected
--                      counts (corrected_items jsonb), the model used and runtime.
--
-- v1 is counts only — there is no pricing/labour here yet; that waits on the
-- validated per-tenant pricing seed and reuses the existing estimate engine.
--
-- Idempotent: create table if not exists + if-not-exists indexes.
-- Apply with:
--   node --env-file=.env.local scripts/run-migration-099.mjs

-- ── 1. plan_uploads — one row per uploaded plan PDF ──────────────────
create table if not exists public.plan_uploads (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,

  filename    text not null,
  sheet_hint  text,            -- e.g. "ELECTRICAL / POWER & DATA"
  is_raster   boolean,         -- true: scanned/raster, false: vector, null: unknown
  size_bytes  integer,

  created_at  timestamptz not null default now()
);

create index if not exists plan_uploads_tenant_idx
  on public.plan_uploads (tenant_id, created_at desc);

-- ── 2. plan_extractions — AI take-off + tradie corrections ───────────
create table if not exists public.plan_extractions (
  id              uuid primary key default gen_random_uuid(),
  plan_upload_id  uuid not null references plan_uploads(id) on delete cascade,
  tenant_id       uuid not null references tenants(id) on delete cascade,

  -- AI output: array of { item, symbol, count, confidence, note }
  items           jsonb not null default '[]'::jsonb,
  -- Tradie's corrected counts: array of { item, symbol, count }.
  -- null until the tradie reviews and saves.
  corrected_items jsonb,
  sheets_used     jsonb,
  overall_note    text,

  model           text,
  runtime_seconds numeric(8,2),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists plan_extractions_tenant_idx
  on public.plan_extractions (tenant_id, created_at desc);
create index if not exists plan_extractions_upload_idx
  on public.plan_extractions (plan_upload_id);

-- Enable RLS to match the post-040 posture. Service role (every /api/* route)
-- bypasses RLS after it has table privileges, so no positive anon/auth policy is
-- added — these are per-tenant operational tables never read via the browser.
alter table public.plan_uploads     enable row level security;
alter table public.plan_extractions enable row level security;

grant select, insert, update, delete
  on public.plan_uploads, public.plan_extractions
  to service_role;

-- Keep PostgREST's schema cache fresh.
notify pgrst, 'reload schema';

-- ── Verification ─────────────────────────────────────────────────────
do $$
declare
  uploads_ok     boolean;
  extractions_ok boolean;
begin
  select exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='plan_uploads') into uploads_ok;
  select exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='plan_extractions') into extractions_ok;
  raise notice 'Migration 099: plan_uploads=% plan_extractions=%', uploads_ok, extractions_ok;
end $$;
