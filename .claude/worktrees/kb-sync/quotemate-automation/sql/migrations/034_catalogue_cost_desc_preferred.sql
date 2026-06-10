-- ════════════════════════════════════════════════════════════════════
-- Migration 034 — WP2 completion: cost price, product description,
--                 preferred-product flag on the operator catalogue.
--
-- Closes the three gaps the re-processed WP2 spec called out on
-- tenant_material_catalogue (migration 028):
--   • cost_price_ex_gst — what the tradie PAYS for the product (margin
--     insight + future margin reporting). This is NOT a sell price;
--     the estimator and grounding validator never read it.
--   • description       — the operator's own product description
--     ("Modern style", etc.) for display + later WP9 option labels.
--   • is_preferred      — "this is my go-to product for its category".
--     Used ONLY as a soft tiebreaker in chooseMaterial() — it can
--     never fabricate a price; the grounding validator still governs
--     the money path exactly as before.
--
-- Purely ADDITIVE + idempotent. None of these columns change any
-- existing price or any validator-accepted candidate, so this is safe
-- before OR after the code deploy and cannot regress a live quote.
--
-- Idempotent: add column if not exists. NOT auto-applied to prod —
-- apply (additive + safe, but it is keystone money-path-adjacent):
--   node --env-file=.env.local scripts/run-migration-034.mjs
-- ════════════════════════════════════════════════════════════════════

alter table tenant_material_catalogue
  add column if not exists cost_price_ex_gst numeric(10,2);

alter table tenant_material_catalogue
  add column if not exists description text;

alter table tenant_material_catalogue
  add column if not exists is_preferred boolean not null default false;

-- Keep PostgREST's schema cache fresh (mirrors migration 028/033 pattern).
notify pgrst, 'reload schema';
