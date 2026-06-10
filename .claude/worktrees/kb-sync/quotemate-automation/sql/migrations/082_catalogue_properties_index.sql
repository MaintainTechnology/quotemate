-- ════════════════════════════════════════════════════════════════════
-- Migration 082 — GIN index on tenant_material_catalogue.properties
--
-- Spec-aware pricing (fixes the "agreed-spec → wrong-material lock" class).
-- The reconcile guard (lib/estimate/spec-guard.ts) and spec-aware selection
-- (lib/sms/product-options.ts) read the `properties` jsonb column (added in
-- migration 028, default '{}') to compare a product's amperage / ip_rating /
-- energy_source / litres etc. against the customer's requested specs.
--
-- This index supports key/containment lookups on properties as it gets
-- populated (forward-fill + the backfill script). Purely additive and
-- idempotent — no behaviour change, no data change.
--
-- NOT auto-applied to prod — apply with:
--   node --env-file=.env.local scripts/run-migration-082.mjs
-- ════════════════════════════════════════════════════════════════════

create index if not exists tenant_material_catalogue_properties_gin
  on tenant_material_catalogue using gin (properties);

-- Keep PostgREST's schema cache fresh (mirrors prior migrations).
notify pgrst, 'reload schema';
