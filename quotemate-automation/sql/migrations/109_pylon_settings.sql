-- Migration 109 · Pylon supplements — tenant hardware SKUs
--
-- Backs the Instant Estimate's Pylon supplements (build 2026-06-13):
-- the tradie nominates their standard hardware once (Pylon component
-- SKUs) and every instant estimate is enriched with manufacturer
-- datasheet cards + the hardware-floor guardrail.
--
--   tenants.pylon_settings — jsonb, e.g.
--     { "module_sku": "…", "inverter_sku": "…", "battery_sku": "…" }
--   Parsed defensively by lib/solar/pylon-hardware.ts. Null = feature
--   inactive for the tenant.
--
-- Idempotent. Apply with:
--   node --env-file=.env.local scripts/run-migration-109.mjs

alter table public.tenants
  add column if not exists pylon_settings jsonb;

notify pgrst, 'reload schema';

-- ── Verification ─────────────────────────────────────────────────────
do $$
declare
  col_ok boolean;
begin
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='tenants'
                    and column_name='pylon_settings') into col_ok;
  raise notice 'Migration 109: tenants.pylon_settings=%', col_ok;
end $$;
