-- ════════════════════════════════════════════════════════════════════
-- 008 — Seed: Premium warm-white LED downlight (indoor, non-dimmable)
--
-- Catalogue gap discovered from quote dZCtFXpDg8zfAyZBO_F9hQ: customer
-- asked for "warm white, not dimmable" downlights and the Estimate
-- Agent could only populate GOOD (Basic LED $28) and BETTER (Tri-colour
-- $48) tiers. The existing premium variants all fail the customer's
-- preference filter:
--   - Dimmable IP-rated $72       → customer said NOT dimmable
--   - Premium IP65 outdoor $75    → outdoor-only, wrong fixture
--   - Smart dimmable outdoor $140 → outdoor + dimmable, both wrong
-- So BEST tier dropped. Correct behaviour (don't fabricate), but it
-- means a "warm white not-dimmable" job only ever produces 2 tiers.
--
-- This seed adds an indoor warm-white-only premium variant that
-- populates BEST cleanly:
--   cost  $75
--   ×1.28 markup = $96/each retail
--   6 fittings × $96 + 2.4hr labour × $110 = $840 ex GST = $924 inc GST
-- Sits cleanly above BETTER ($696) at ~33% premium step.
--
-- Tradies can adjust the price by updating default_unit_price_ex_gst on
-- this row. Idempotent — safe to re-run (NOT EXISTS guard, no unique
-- constraint required on the table).
-- ════════════════════════════════════════════════════════════════════

insert into public.shared_materials
  (trade, name, brand, unit, default_unit_price_ex_gst, properties)
select
  'electrical',
  'Premium 90+CRI warm-white LED downlight (5yr warranty)',
  null,
  'each',
  75.00,
  '{
    "smart": false,
    "dimmable": false,
    "weatherproof": false,
    "ip_rating": "IP44",
    "color_options": ["warm_white"],
    "cri": 90,
    "warranty_years": 5,
    "premium": true
  }'::jsonb
where not exists (
  select 1 from public.shared_materials
  where name = 'Premium 90+CRI warm-white LED downlight (5yr warranty)'
);
