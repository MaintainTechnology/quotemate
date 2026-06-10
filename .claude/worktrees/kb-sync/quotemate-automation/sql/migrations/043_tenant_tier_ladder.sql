-- ════════════════════════════════════════════════════════════════════
-- Migration 043 — tenant_tier_ladder (v7 Phase 3 · keystone schema)
--
-- The explicit Good/Better/Best ladder per tenant per category.
--
-- BEFORE this migration: chooseMaterial() in lib/estimate/catalogue.ts
-- infers tier from brand+range_series keywords (Clipsal Iconic → better,
-- Saturn Zen → best). That works for known brands but it's implicit and
-- can't be overridden when the tradie's "Good" is e.g. SAL Aniko (the
-- inference would yield null and the model would have to guess).
--
-- AFTER: a tenant declares "for THIS category, my Good is X, my Better
-- is Y, my Best is Z" by inserting up to 3 rows here pointing at their
-- tenant_material_catalogue products. chooseMaterial() gives a ladder
-- hit +10 score — beating the existing +4 brand / +4 range / +2 tier
-- inference combined.
--
-- Empty table = no change for anyone (the inference path remains the
-- default). A tenant with PARTIAL ladder (e.g. only Good filled) falls
-- back to inference for the missing tiers — preserves the "zero-config
-- still works" guarantee.
--
-- WHY this is a separate table not extra columns on tenant_material_catalogue:
--   • A single catalogue product can be the "Good" for tap_basin AND
--     the "Better" for tap_kitchen if a tradie uses it that way.
--     Composite PK (tenant_id, category, tier) cleanly expresses that.
--   • Deleting a catalogue row via tenant_material_catalogue.id on-delete
--     cascade empties the ladder slot automatically (no broken FKs).
--
-- Idempotent: create table if not exists + if-not-exists indexes.
-- Money-path-adjacent: chooseMaterial reads this (Phase 3b wiring) so
-- the parity harness + catalogue tests re-run after wiring.
--
-- NOT auto-applied to prod — apply with:
--   node --env-file=.env.local scripts/run-migration-043.mjs
-- ════════════════════════════════════════════════════════════════════

create table if not exists tenant_tier_ladder (
  tenant_id uuid not null references tenants(id) on delete cascade,

  -- Grounding category (CATEGORIES vocab — gpo, downlight, tap, hot_water,
  -- etc.). Same vocab tenant_material_catalogue.category uses, so the
  -- (tenant_id, category) join lookup matches without translation.
  category text not null,

  tier text not null check (tier in ('good', 'better', 'best')),

  -- Points at a tenant_material_catalogue row this tradie has stocked.
  -- on delete cascade: if they remove the product from their catalogue,
  -- the ladder slot disappears with it (no orphan references).
  catalogue_id uuid not null references tenant_material_catalogue(id) on delete cascade,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (tenant_id, category, tier)
);

-- Index for the estimator-side lookup: "for this tenant, what's their
-- ladder for category X?". Returns 0-3 rows.
create index if not exists tenant_tier_ladder_lookup_idx
  on tenant_tier_ladder (tenant_id, category);

-- Reverse lookup — "if a catalogue row is deleted, which ladder rows
-- pointed at it?". Used implicitly by the FK; making it explicit keeps
-- the cascade fast on tenants with hundreds of catalogue rows.
create index if not exists tenant_tier_ladder_catalogue_idx
  on tenant_tier_ladder (catalogue_id);

create or replace function tenant_tier_ladder_set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tenant_tier_ladder_set_updated_at
  on tenant_tier_ladder;
create trigger tenant_tier_ladder_set_updated_at
  before update on tenant_tier_ladder
  for each row
  execute function tenant_tier_ladder_set_updated_at();

notify pgrst, 'reload schema';
