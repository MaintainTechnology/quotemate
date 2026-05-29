-- Migration 080 · Roofing trade — Phase 1 seed
--
-- Context: third trade (after electrical NSW/NECA and plumbing QLD/QBCC).
-- See docs/strategy.md v10 (2026-05-29) for the strategic rationale and
-- why we are hand-wiring this ahead of v9's admin-loader (v9 Phase 0 is
-- not yet built; roofing Phase 1 ships first against the legacy seed
-- pattern, the v9 loader will adopt this row set when it lands).
--
-- This migration is additive only. It does NOT:
--   • alter the IntakeSchema trade enum (roofing intake runs through a
--     separate lib/roofing/ pipeline, not lib/intake/structure.ts)
--   • insert a pricing_book row (tenant_id is NOT NULL since mig 025 —
--     per-tenant rows get created at tenant activation time)
--   • change any check constraints on existing tables
--
-- What it DOES seed:
--   • 14 shared_assemblies rows scoped to trade='roofing' covering the
--     Phase 1 service set (re-roof Colorbond, re-roof tile, repointing,
--     ridge cap rebed, valley flashing replace, gutter replace, downpipe
--     replace, flashing repair, leak-trace inspection, etc.)
--   • 8 shared_materials rows covering the headline products (Colorbond
--     Trimdek / Klip-Lok ranges, concrete tile, terracotta tile, ridge
--     bed cement, valley flashing, gutter profiles)
--
-- Idempotent: every insert uses a `where not exists` guard so re-runs
-- are no-ops.

-- ── 1. Roofing shared_assemblies ───────────────────────────────────
-- default_unit_price_ex_gst = sundries/equipment portion (NOT the
-- product itself — products live in shared_materials and the estimator
-- picks the tier-appropriate one via lookup_material).
-- default_labour_hours: per default_unit. For 'sqm' units this is the
-- per-square-metre labour. For 'each' / 'lm' it is per item.
--
-- Categories are unique to roofing — they map to the structured
-- intake.scope.roof_* fields the roofing module emits.

insert into shared_assemblies (
  trade, name, description, default_unit,
  default_unit_price_ex_gst, default_labour_hours, default_exclusions,
  category, properties
)
select * from (values
  ('roofing', 'Re-roof Colorbond Trimdek',         'Full re-roof using Colorbond Trimdek sheeting on existing battens. Includes lifting old sheets, installing new sarking if specified, fitting new sheets, all flashings, ridge caps and screws.',  'sqm',  18.00, 0.18, 'Excludes batten replacement, asbestos removal, ridge cap rebed beyond included caps, gutter/downpipe replacement, two-storey access loading', 're_roof_metal',  '{"material":"colorbond_trimdek","scope":"full_reroof"}'::jsonb),
  ('roofing', 'Re-roof Colorbond Klip-Lok',        'Full re-roof using Colorbond Klip-Lok 700 concealed-fix sheeting. Higher labour than Trimdek due to concealed clip system.',                                                                'sqm',  22.00, 0.22, 'Excludes batten replacement, asbestos removal, ridge cap rebed beyond included caps, gutter/downpipe replacement, two-storey access loading', 're_roof_metal',  '{"material":"colorbond_kliplok","scope":"full_reroof"}'::jsonb),
  ('roofing', 'Re-roof concrete tile',             'Full re-roof using concrete roof tiles on existing battens. Includes lifting old tiles, fitting new tiles, ridge/hip caps, and bedding.',                                                'sqm',  20.00, 0.20, 'Excludes batten replacement, asbestos removal, sarking upgrade, gutter/downpipe replacement, two-storey access loading', 're_roof_tile',   '{"material":"concrete_tile","scope":"full_reroof"}'::jsonb),
  ('roofing', 'Re-roof terracotta tile',           'Full re-roof using terracotta roof tiles. Higher labour and product cost than concrete tile.',                                                                                              'sqm',  28.00, 0.24, 'Excludes batten replacement, asbestos removal, sarking upgrade, gutter/downpipe replacement, two-storey access loading', 're_roof_tile',   '{"material":"terracotta_tile","scope":"full_reroof"}'::jsonb),
  ('roofing', 'Repoint ridge and hip caps',        'Remove old bedding mortar and repoint all ridge and hip caps with flexible pointing compound. Standard remedy for cracked or leaking caps.',                                              'lm',   12.00, 0.30, 'Excludes full cap rebed if bedding is fully failed; excludes tile replacement beyond 5 per 10lm',                       'repointing',     '{"scope":"repoint_only"}'::jsonb),
  ('roofing', 'Rebed ridge and hip caps',          'Lift caps, remove old bed and pointing, lay new bedding mortar, refit caps, repoint. Used when bedding has failed structurally.',                                                          'lm',   28.00, 0.50, 'Excludes new cap supply (priced separately if existing caps unusable); excludes asbestos cement cap removal',           'rebedding',      '{"scope":"rebed_full"}'::jsonb),
  ('roofing', 'Valley flashing replacement',       'Lift roof material adjacent to the valley, remove old flashing, fit new Colorbond valley iron, refit roof material. Priced per linear metre of valley.',                                  'lm',   45.00, 0.75, 'Excludes wider material replacement if damaged during lift; excludes new sarking beyond 1m strip',                       'valley_flashing','{"scope":"replace"}'::jsonb),
  ('roofing', 'Box gutter replacement',            'Remove old box gutter, fabricate and fit new Colorbond box gutter section. Includes flashings at upstand walls.',                                                                          'lm',   60.00, 1.00, 'Excludes structural carpentry if substrate is rotted; excludes outlet/sump replacement priced separately',              'box_gutter',     '{"scope":"replace"}'::jsonb),
  ('roofing', 'Replace eaves gutter',              'Remove existing gutter, supply and fit new Colorbond Quad / D-Section / Half-Round gutter to existing fascia. Includes gutter brackets, stop ends, joiners.',                              'lm',   38.00, 0.30, 'Excludes fascia replacement, downpipe replacement (priced separately), two-storey access loading',                     'gutter_replace', '{"scope":"replace"}'::jsonb),
  ('roofing', 'Replace downpipe',                  'Remove old downpipe, fit new Colorbond round or rectangular downpipe with brackets, top elbow, shoe at base.',                                                                             'each', 35.00, 0.75, 'Excludes connection to stormwater if blocked; excludes underground stormwater replacement',                              'downpipe',       '{"scope":"replace"}'::jsonb),
  ('roofing', 'Flashing repair',                   'Re-bed or replace a localised flashing (wall, chimney, vent pipe). Per location.',                                                                                                          'each', 65.00, 1.00, 'Excludes large-scale flashing replacement (priced as valley or apron rate)',                                            'flashing_repair','{"scope":"repair"}'::jsonb),
  ('roofing', 'Leak trace + minor repair',         'Inspect roof to locate leak source, perform minor repair (replace one tile, reseal one flashing, replace a sheet screw). Up to 2 hours.',                                                  'each', 45.00, 2.00, 'Excludes major repair if root cause is structural / requires re-roof of section',                                       'leak_repair',    '{"scope":"repair"}'::jsonb),
  ('roofing', 'Ridge cap supply and replace',      'Supply and replace one cracked or broken ridge cap tile. Includes new bedding mortar and pointing.',                                                                                       'each', 45.00, 0.50, 'Excludes broader rebed if more than 2 caps in a row are failed',                                                        'cap_replace',    '{"scope":"replace"}'::jsonb),
  ('roofing', 'Whirlybird vent install',           'Supply and fit a 300mm whirlybird roof ventilator on existing metal or tiled roof. Includes flashing kit.',                                                                                'each', 60.00, 1.25, 'Excludes electrical wiring (manual vent only); excludes asbestos cement cutting',                                       'ventilation',    '{"scope":"new_install"}'::jsonb)
) as v(trade, name, description, default_unit, default_unit_price_ex_gst, default_labour_hours, default_exclusions, category, properties)
where not exists (
  select 1 from shared_assemblies sa
   where sa.name = v.name and sa.trade = v.trade
);

-- ── 2. Roofing shared_materials ────────────────────────────────────
-- Estimator looks these up at quote time. Prices ex-GST per default_unit.
-- These are baseline rates; the per-tenant overlay (when the v9 admin
-- loader ships) will let each tradie override.

insert into shared_materials (
  trade, name, brand, unit, default_unit_price_ex_gst
)
select * from (values
  ('roofing', 'Colorbond Trimdek sheet (per sqm)', 'BlueScope',    'sqm',  42.00),
  ('roofing', 'Colorbond Klip-Lok 700 (per sqm)',  'BlueScope',    'sqm',  58.00),
  ('roofing', 'Concrete roof tile',                'Bristile',     'sqm',  28.00),
  ('roofing', 'Terracotta roof tile',              'Monier',       'sqm',  65.00),
  ('roofing', 'Roof sarking (anti-condensation)',  'CSR Bradford', 'sqm',   7.50),
  ('roofing', 'Colorbond ridge cap (per lm)',      'BlueScope',    'lm',   18.00),
  ('roofing', 'Colorbond Quad gutter (per lm)',    'BlueScope',    'lm',   16.00),
  ('roofing', 'Colorbond round downpipe (per lm)', 'BlueScope',    'lm',   12.00)
) as v(trade, name, brand, unit, default_unit_price_ex_gst)
where not exists (
  select 1 from shared_materials sm
   where sm.name = v.name and sm.trade = v.trade
);

-- ── 3. Sanity check (read-only) ────────────────────────────────────
-- The runner script post-verifies the row counts. This block is just a
-- diagnostic echo for psql / direct runs.

do $$
declare
  asm_count int;
  mat_count int;
begin
  select count(*) into asm_count from shared_assemblies where trade='roofing';
  select count(*) into mat_count from shared_materials  where trade='roofing';
  raise notice 'Migration 080: roofing assemblies = %, materials = %', asm_count, mat_count;
end $$;
