-- Migration 102 · Persist the priced BOM on a plan extraction
--
-- The Estimator (Beta) take-off can now be priced (deterministic, grounded in
-- tenant_custom_assemblies + shared_assemblies + pricing_book). Until now the
-- priced BOM lived only in component state and evaporated on navigation; the
-- full-view run page (/dashboard/estimator/[runId]) and the run-history panel
-- both need it back after a reload.
--
--   priced_bom — the full PricedBom json the price route returned
--               { lines[], unmatched[], materialExGst, labourExGst,
--                 labourFloorAddedExGst, subtotalExGst, gstExGst, totalIncGst,
--                 gstRegistered, assumptions{} }
--   priced_at  — when that BOM was computed. Editing counts re-prices and
--               overwrites both; null = never priced.
--
-- Idempotent: add column if not exists.
-- Apply with:
--   node --env-file=.env.local scripts/run-migration-102.mjs

alter table public.plan_extractions
  add column if not exists priced_bom jsonb,
  add column if not exists priced_at  timestamptz;

-- Keep PostgREST's schema cache fresh.
notify pgrst, 'reload schema';

-- ── Verification ─────────────────────────────────────────────────────
do $$
declare
  bom_ok boolean;
  at_ok  boolean;
begin
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='plan_extractions'
                    and column_name='priced_bom') into bom_ok;
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='plan_extractions'
                    and column_name='priced_at') into at_ok;
  raise notice 'Migration 102: priced_bom=% priced_at=%', bom_ok, at_ok;
end $$;
