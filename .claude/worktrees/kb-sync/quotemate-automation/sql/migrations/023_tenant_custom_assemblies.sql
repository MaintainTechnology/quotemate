-- ════════════════════════════════════════════════════════════════════
-- Migration 023 — tenant-owned custom assemblies (Option B, Pass 1)
--
-- Background: pre-023 every service the AI could auto-quote came from
-- the shared seed catalogue in shared_assemblies. Tradies who offered
-- work outside the seeded "easy 5" (e.g. pool light installs, smart-
-- home cabling, washer hookups beyond the standard tap-pair) had no
-- way to add their own services without us shipping a global catalogue
-- migration for every niche.
--
-- This migration adds tenant_custom_assemblies — a tenant-owned table
-- that mirrors shared_assemblies' shape so the estimator pipeline
-- (lookup_assembly + grounding validator) can read both tables and
-- treat custom rows as first-class catalogue entries scoped to that
-- one tenant.
--
-- Design notes:
--   • Separate table (NOT a tenant_id column on shared_assemblies).
--     Three reasons:
--       1. Clean separation of system data vs user-generated data.
--       2. Trivial to RLS-protect later — `tenant_id = auth.tenant_id()`
--          on the whole table, no nullable-tenant edge case.
--       3. A bug or rogue tradie can't leak rows into another tradie's
--          quote because the tables are physically partitioned.
--   • Same columns as shared_assemblies + tenant_id + always_inspection.
--     `always_inspection` is the v1 "red flag" lever — tradies tick it
--     for services they prefer the AI never auto-quotes (e.g. anything
--     gas-fitting-adjacent, anything that needs a site visit). The SMS
--     dispatcher / estimator can opt to skip these rows when picking
--     candidates, forcing inspection routing.
--   • `inspection_triggers text[]` is reserved for future granular
--     control (Pass 2 of Option B — phrase-match triggers in customer
--     messages). Default empty array. Not wired to anything yet.
--   • `enabled` lives directly on the row (no tenant_service_offerings
--     join needed for custom rows — there's exactly one custom row per
--     (tenant, name) and the toggle is intrinsic to that ownership).
--
-- Idempotent: `create table if not exists` + `if not exists` indexes.
-- ════════════════════════════════════════════════════════════════════

create table if not exists tenant_custom_assemblies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  trade text not null check (trade in ('electrical', 'plumbing')),

  -- Mirror of shared_assemblies' shape so the estimator pipeline can
  -- treat both tables interchangeably via UNION.
  name text not null,
  description text,
  default_unit text default 'each',
  default_unit_price_ex_gst numeric(10,2) not null,
  default_labour_hours numeric(6,2) not null default 0,
  default_exclusions text,
  -- shared_assemblies has a properties jsonb (migration 007) used by
  -- the LLM tool's property filters. We accept that here for shape
  -- parity but expect most tradies to leave it empty.
  properties jsonb default '{}'::jsonb,

  -- Per-row "AI will auto-quote" vs "Always route to paid inspection"
  -- toggle. When TRUE the estimator pipeline must NOT use this row for
  -- pricing — the SMS dispatcher should force inspection routing on
  -- match. When FALSE the row is a normal auto-quote candidate.
  always_inspection boolean not null default false,

  -- Future granular triggers (Pass 2). Each entry is a substring the
  -- SMS dispatcher will look for in customer messages. Empty default
  -- — only the always_inspection flag is honoured in v1.
  inspection_triggers text[] not null default '{}',

  -- Whether the tradie has this service active. Mirrors
  -- tenant_service_offerings.enabled but lives on the row itself
  -- because there's no shared row to point at. Defaults TRUE — the
  -- tradie just added it because they perform it.
  enabled boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A tradie shouldn't have two custom services with the same name in
-- the same trade. Lets the dashboard form prevent dupes deterministically.
create unique index if not exists tenant_custom_assemblies_unique_name
  on tenant_custom_assemblies (tenant_id, trade, lower(name));

-- The estimator query pattern is "every row for this tenant in this
-- trade." A composite index covers it.
create index if not exists tenant_custom_assemblies_lookup_idx
  on tenant_custom_assemblies (tenant_id, trade)
  where enabled = true;

-- updated_at auto-bump trigger so the dashboard can show "last edited"
-- timestamps without the client having to manage them.
create or replace function tenant_custom_assemblies_set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tenant_custom_assemblies_set_updated_at
  on tenant_custom_assemblies;
create trigger tenant_custom_assemblies_set_updated_at
  before update on tenant_custom_assemblies
  for each row
  execute function tenant_custom_assemblies_set_updated_at();
