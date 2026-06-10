-- ════════════════════════════════════════════════════════════════════
-- Migration 042 — supplier_catalogue_id link on tenant_material_catalogue
-- (v7 Phase 2a · paired with 041)
--
-- Records the supplier_catalogue row a tenant's catalogue product was
-- COPIED FROM, so we can later show "this SKU has a refreshed supplier
-- price you haven't reviewed" (a Phase 5 trigger — out of scope for v7).
--
-- on delete set null: if a supplier_catalogue row is hard-deleted (rare;
-- soft-delete via retired_at is the normal path), the tenant's catalogue
-- row keeps working — they still have the product, just no longer linked
-- to a supplier upstream. NEVER cascade-delete tenant rows from supplier
-- table changes — operator data is sacred.
--
-- Idempotent: add column if not exists.
-- This is purely additive — does not change a single existing row's
-- behaviour for the estimator, validator, or any UI that doesn't read
-- the new column.
--
-- Apply with:
--   node --env-file=.env.local scripts/run-migration-042.mjs
-- ════════════════════════════════════════════════════════════════════

alter table tenant_material_catalogue
  add column if not exists supplier_catalogue_id uuid
    references supplier_catalogue(id) on delete set null;

create index if not exists tenant_material_catalogue_supplier_idx
  on tenant_material_catalogue (supplier_catalogue_id)
  where supplier_catalogue_id is not null;

notify pgrst, 'reload schema';
