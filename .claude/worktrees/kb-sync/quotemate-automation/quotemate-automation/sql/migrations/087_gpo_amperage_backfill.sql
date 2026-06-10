-- 087_gpo_amperage_backfill.sql
--
-- Stamp properties.amperage onto GPO catalogue rows so the spec-guard
-- (lib/estimate/spec-guard.ts, registry key electrical/gpo->amperage) can
-- distinguish 10A vs 15A vs 20A/32A products. Closes the diagnose-james-gpo-15a
-- class: customer agreed 15A, quote locked a 10A GPO, validator passed it
-- (price + 'gpo' category match, no amperage check).
--
-- Additive + safe: merges into existing properties jsonb, changes NO prices.
--   • Standard double GPOs            -> 10A  (the AU standard)
--   • Rows with explicit amperage     -> that value (20A, 32A from the name)
--   • Genuinely ambiguous rows        -> left unknown ("aircon power point")
-- Value format "10A"/"15A"/... matches the pre-existing tenant rows
-- (Clipsal 15Amp = {"amperage":"15A"}, ...10A = {"amperage":"10A"}) so
-- spec-registry canonicalise() parses them identically.
--
-- Row ids + current properties captured read-only via
-- scripts/diag-gpo-rows.mjs (2026-06-02). Also folds in the two cleanups the
-- check surfaced: a name typo and a same-tenant exact duplicate.

-- ── shared_materials: all 4 are standard double GPOs -> 10A ──
update shared_materials
   set properties = coalesce(properties, '{}'::jsonb) || jsonb_build_object('amperage', '10A')
 where id in (
   'e37e8068-b4a5-4544-ba3b-0eccdc266ce8',  -- Smart Wi-Fi double GPO
   'a68a1ea1-93a0-498d-b1d9-899f175961cc',  -- Standard double GPO
   'fe4613e8-6358-4e21-8564-c9b669ab6894',  -- USB double GPO
   'f8a76230-820e-4519-854e-9ef0e4eb9f67'   -- Weatherproof double GPO (IP56)
 );

-- ── shared_assemblies: explicit amperage from the name; standard installs ->
--    10A; "Install aircon power point" left unknown (ambiguous 10/15/20A) ──
update shared_assemblies
   set properties = coalesce(properties, '{}'::jsonb) || jsonb_build_object('amperage', '20A')
 where id = '5b48eed9-3f37-4d1c-a3e2-d4afae0a5e20';  -- Install 20A dedicated GPO
update shared_assemblies
   set properties = coalesce(properties, '{}'::jsonb) || jsonb_build_object('amperage', '32A')
 where id = '5b48eed9-3f37-4d1c-a3e2-d4afae0a5e32';  -- Install 32A three-phase outlet
update shared_assemblies
   set properties = coalesce(properties, '{}'::jsonb) || jsonb_build_object('amperage', '10A')
 where id in (
   '69f87a78-703a-4e35-b3a4-faec6f6e8956',  -- Install outdoor IP-rated GPO (standard outdoor = 10A)
   'd19f97df-070e-443b-9c31-da6e76eeca41'   -- Replace double GPO (standard = 10A)
 );
-- 0efa1035-9126-414d-9cb5-7ad74532cb80 "Install aircon power point" intentionally NOT stamped.

-- ── tenant_material_catalogue: standard branded GPOs with no amperage -> 10A ──
update tenant_material_catalogue
   set properties = coalesce(properties, '{}'::jsonb) || jsonb_build_object('amperage', '10A')
 where id in (
   'bf199644-5602-4517-bd85-49c75239bf61',  -- Clipal Iconic Wifi (standard Iconic)
   '43429e41-070e-44fe-934b-9bbc2ac577ff',  -- Clipsal 2000 GPO (standard)
   'a5eff0cf-0e3a-4c74-a04b-f538765799fe'   -- Clipsal Iconic (standard)
 );
-- 4f0ccef4 "Clipsal 15Amp" already {"amperage":"15A"}; ce083a0c / f5a60ce4
-- already {"amperage":"10A"} -> left untouched.

-- ── cleanup 1: name typo "Clipal" -> "Clipsal" ──
update tenant_material_catalogue
   set name = 'Clipsal Iconic Wifi'
 where id = 'bf199644-5602-4517-bd85-49c75239bf61'
   and name = 'Clipal Iconic Wifi';

-- ── cleanup 2: SAFE dedupe. Deactivate the duplicate "Clipsal 2000...10A" ONLY
--    when it is a genuine same-tenant, same-name, same-price duplicate of the
--    kept row. If they are different tenants or differ in any way, the join
--    matches nothing and this is a no-op (both rows preserved). ──
update tenant_material_catalogue dup
   set active = false
  from tenant_material_catalogue keep
 where dup.id  = 'f5a60ce4-f0ff-4762-bda9-3864ea1a866c'
   and keep.id = 'ce083a0c-f6ea-4889-a9b8-a8276028d510'
   and dup.tenant_id = keep.tenant_id
   and dup.name = keep.name
   and dup.unit_price_ex_gst is not distinct from keep.unit_price_ex_gst;
