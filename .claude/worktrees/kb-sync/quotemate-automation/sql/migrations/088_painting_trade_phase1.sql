-- Migration 088 · Painting trade — Phase 1 seed
--
-- Context: a painting trade alongside electrical / plumbing / roofing.
-- Like roofing (migration 080), painting runs on a self-contained
-- deterministic pipeline (lib/painting/*) — the money path is a per-m²
-- rate card (lib/painting/pricing.ts DEFAULT_PAINTING_RATE_CARD), NOT the
-- strict-grounding Opus estimator. These rows are forward-looking seed
-- data so painting also exists in the shared catalogue / future estimator
-- path; the deterministic engine does not read them.
--
-- This migration is additive only. It does NOT:
--   • alter the IntakeSchema trade enum (painting intake runs through the
--     separate lib/painting/ pipeline, not lib/intake/structure.ts)
--   • insert a pricing_book row (tenant_id is NOT NULL since mig 025 —
--     per-tenant rows are created at tenant activation)
--   • change any check constraints on existing tables
--
-- What it DOES seed:
--   • 11 shared_assemblies rows scoped to trade='painting' (interior
--     walls/ceilings, exterior, trim, doors, windows, feature wall, deck
--     stain, eaves/fascia, prep/undercoat)
--   • 9 shared_materials rows (interior / premium / ceiling / exterior
--     acrylics, primer/sealer, enamels, deck stain, job sundries kit)
--
-- Idempotent: every insert uses a `where not exists` guard so re-runs
-- are no-ops.

-- ── 1. Painting shared_assemblies ──────────────────────────────────
-- default_unit_price_ex_gst = sundries/equipment portion per unit (paint
-- product lives in shared_materials). default_labour_hours: per unit (for
-- 'sqm' = per square metre; 'lm' = per linear metre; 'each' = per item).
-- Categories map to the painting scope set the lib/painting module emits.

insert into shared_assemblies (
  trade, name, description, default_unit,
  default_unit_price_ex_gst, default_labour_hours, default_exclusions,
  category, properties
)
select * from (values
  ('painting', 'Interior wall paint — 2 coats',      'Two topcoats of low-sheen acrylic to interior walls over a sound, previously-painted surface. Includes cutting in, minor gap filling and one light sand.',                 'sqm',  6.00, 0.12, 'Excludes major patching/crack repair, undercoat on bare plaster, wallpaper removal, ceilings and trim',          'interior_wall_paint',   '{"surface":"interior_wall","coats":2}'::jsonb),
  ('painting', 'Ceiling paint — 2 coats',            'Two coats of flat ceiling white to interior ceilings. Roller from floor with pole; cutting in to cornice.',                                                              'sqm',  5.00, 0.10, 'Excludes stain-block on water-stained ceilings, raked/cathedral ceilings, cornice rebedding',                     'interior_ceiling_paint','{"surface":"ceiling","coats":2}'::jsonb),
  ('painting', 'Exterior wall paint — 2 coats',      'Two coats of exterior acrylic to render, weatherboard or fibre-cement. Includes pressure clean, minor gap fill and one cut-in coat.',                                     'sqm',  8.00, 0.15, 'Excludes lead-paint or asbestos handling, render crack repair, two-storey access loading, eaves and gutters',     'exterior_wall_paint',   '{"surface":"exterior_wall","coats":2}'::jsonb),
  ('painting', 'Trim — skirting & architraves',      'Prep and paint skirting boards and door/window architraves in enamel. Priced per linear metre of trim run.',                                                             'lm',   4.00, 0.12, 'Excludes timber repair/replacement, full gloss build-up beyond 2 coats',                                          'trim_paint',            '{"surface":"trim","coats":2}'::jsonb),
  ('painting', 'Door — paint both sides',            'Prep and paint one door leaf both sides plus the frame in enamel. Includes light sand and undercoat where needed.',                                                       'each',15.00, 1.00, 'Excludes door removal/rehang, stripping heavily built-up paint, stain/clear finishes',                            'door_paint',            '{"surface":"door","coats":2}'::jsonb),
  ('painting', 'Window frame — paint',               'Prep and paint one timber/metal window frame in enamel. Includes masking glass and one light sand.',                                                                     'each',12.00, 0.80, 'Excludes sash cord repair, glazing, stripping built-up paint',                                                    'trim_paint',            '{"surface":"window_frame","coats":2}'::jsonb),
  ('painting', 'Feature wall — accent colour',       'Two coats of a deep-base accent colour to a single feature wall. Extra masking and cut-in for a clean colour break.',                                                     'sqm',  8.00, 0.15, 'Excludes special finishes (Venetian, metallic), wallpaper, murals',                                              'feature_wall',          '{"surface":"feature_wall","coats":2}'::jsonb),
  ('painting', 'Deck / timber stain — 2 coats',      'Two coats of decking stain or oil to an exterior timber deck. Includes clean and light sand.',                                                                           'sqm',  4.50, 0.10, 'Excludes board replacement, heavy strip of old coating, structural repair',                                       'deck_stain',            '{"surface":"deck","coats":2}'::jsonb),
  ('painting', 'Eaves & fascia — paint',             'Prep and paint eaves/soffit lining and fascia in exterior acrylic/enamel. Priced per linear metre of fascia line.',                                                       'lm',   6.00, 0.18, 'Excludes fascia/board replacement, gutter painting (priced separately), two-storey access loading',              'eaves_fascia',          '{"surface":"eaves_fascia","coats":2}'::jsonb),
  ('painting', 'Undercoat / seal bare surfaces',     'One coat of acrylic primer-sealer to bare plaster, patched areas or bare timber before topcoats. Priced per square metre of bare area.',                                  'sqm',  3.00, 0.08, 'Excludes the topcoats themselves (priced as the relevant surface), masonry sealing of unprimed render',          'prep',                  '{"surface":"prime","coats":1}'::jsonb),
  ('painting', 'Patch & sand prep — per room',       'Fill nail holes and minor cracks, sand back and spot-prime in one room before painting. A standard light-prep allowance.',                                                'each',20.00, 1.00, 'Excludes major crack/structural repair, full re-skim, mould/water-damage remediation (route to inspection)',     'prep',                  '{"surface":"prep","coats":0}'::jsonb)
) as v(trade, name, description, default_unit, default_unit_price_ex_gst, default_labour_hours, default_exclusions, category, properties)
where not exists (
  select 1 from shared_assemblies sa
   where sa.name = v.name and sa.trade = v.trade
);

-- ── 2. Painting shared_materials ───────────────────────────────────
-- Baseline product rates ex-GST per unit. The per-tenant overlay (and the
-- v9 admin loader) let each tradie override these and pin a brand tier.

insert into shared_materials (
  trade, name, brand, unit, default_unit_price_ex_gst
)
select * from (values
  ('painting', 'Interior low-sheen acrylic — 10L',   'Dulux Wash&Wear',   'can',  95.00),
  ('painting', 'Premium interior acrylic — 10L',     'Dulux Wash&Wear+',  'can', 130.00),
  ('painting', 'Ceiling flat white — 10L',           'Dulux Ceiling',     'can',  55.00),
  ('painting', 'Exterior acrylic — 10L',             'Dulux Weathershield','can',110.00),
  ('painting', 'Acrylic primer / sealer — 10L',      'Dulux 1Step',       'can',  70.00),
  ('painting', 'Water-based enamel (trim/doors) — 4L','Dulux Aquanamel',  'can',  80.00),
  ('painting', 'Oil-based enamel (trim/doors) — 4L', 'Dulux Super Enamel','can',  75.00),
  ('painting', 'Timber decking stain — 10L',         'Cabot''s',          'can', 120.00),
  ('painting', 'Job sundries kit (tape, sheets, rollers)', 'Generic',     'each', 35.00)
) as v(trade, name, brand, unit, default_unit_price_ex_gst)
where not exists (
  select 1 from shared_materials sm
   where sm.name = v.name and sm.trade = v.trade
);

-- ── 3. Sanity check (read-only) ────────────────────────────────────

do $$
declare
  asm_count int;
  mat_count int;
begin
  select count(*) into asm_count from shared_assemblies where trade='painting';
  select count(*) into mat_count from shared_materials  where trade='painting';
  raise notice 'Migration 088: painting assemblies = %, materials = %', asm_count, mat_count;
end $$;
