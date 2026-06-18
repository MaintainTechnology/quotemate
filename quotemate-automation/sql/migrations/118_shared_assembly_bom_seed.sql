-- ════════════════════════════════════════════════════════════════════
-- Migration 118 — seed shared_assembly_bom for the CORE electrical +
-- plumbing assemblies (R18).
--
-- WHY: shared_assembly_bom (mig 028) is the structured bill-of-materials
-- per shared assembly. The estimator READS it in two places:
--   1. lib/estimate/run.ts buildBomHint() — ALWAYS-ON. Pulls the matching
--      assembly's BOM rows and renders them as a SOFT prompt hint
--      (formatBomHint) so Opus quotes the same baseline parts every time.
--      Falls back to shared_assembly_bom when the tenant has no own recipe.
--   2. lib/estimate/run.ts loadDeterministicInputs() — flag-gated behind
--      DETERMINISTIC_BOM=1 (default OFF). Falls back to shared_assembly_bom
--      when the tenant has no tenant_assembly_bom, then prices each line via
--      chooseMaterial(material_category) → tenant catalogue, else
--      shared_materials. The grounding validator + min-labour floor STILL
--      run on the output, so a drifted line self-corrects to $99 inspection.
--
-- Before this migration only 3 rows existed (Replace double GPO,
-- Replace LED downlight × 2). Every other CORE job had NO baseline recipe,
-- so buildBomHint returned null and the deterministic path bailed with
-- "no recipe for this job".
--
-- VOCAB — THE LOAD-BEARING CONSTRAINT (verified read-only against prod
-- 2026-06-18): material_category MUST be a real shared_materials.category
-- string, because the deterministic resolver chooseMaterial() matches it
-- with an exact (trim+lowercase) equality. The categories that actually
-- exist in shared_materials are:
--   electrical: ceiling_fan, downlight, gpo, outdoor_light, safety_switch,
--               smoke_alarm, sundries
--   plumbing:   hws_electric, hws_gas, hws_heat_pump, sundries,
--               tapware_basin, tapware_kitchen, tapware_laundry,
--               tapware_outdoor, toilet, toilet_repair
-- NOTE: it is `sundries` (PLURAL) — NOT `sundry`. The 3 pre-existing rows
-- used `sundry` for the downlight job; that string does NOT exist in
-- shared_materials so the downlight deterministic line cannot resolve its
-- consumables today. This migration uses the correct `sundries` for every
-- new row. (The existing `sundry` row is left untouched — fixing it is out
-- of scope for R18; flagged for the owner.)
--
-- STRUCTURAL, NOT INVENTED PRICE: each row says WHICH material category a
-- job consumes + a typical quantity. No prices are written here — pricing
-- comes from shared_materials / tenant catalogue at quote time. Quantities
-- are derived from the assembly definition (1 appliance per install job,
-- 6 downlights per downlight job to match the seeded "Replace LED
-- downlight" recipe, etc.).
--
-- LABOUR-DOMINANT / SAFETY JOBS (fault find, gas connection, drain clear,
-- CCTV inspection, PRV install): shared_materials carries NO stocked
-- product category for these — the value is the licensed labour, with only
-- generic consumables. They get a single `sundries` line (required for the
-- service jobs that genuinely fit a few fittings; optional for the pure
-- diagnostic/inspection jobs) so the BOM is structurally complete without
-- fabricating a product. The labour line is added by the estimator from
-- pricing_book.hourly_rate × the assembly's default_labour_hours, not here.
--
-- SCOPE: electrical + plumbing only (roofing/solar/aircon ignored).
--
-- Idempotent: every INSERT is guarded by `not exists` on
-- (assembly_id, lower(material_category)) — re-runnable, and the table's
-- unique index on (assembly_id, lower(material_category),
-- lower(coalesce(description,''))) is the backstop. Matches assemblies by
-- exact name + trade (the names verified against prod).
--
-- NOT auto-applied to prod. Apply with:
--   node --env-file=.env.local scripts/run-migration-118.mjs --apply
-- ════════════════════════════════════════════════════════════════════

-- Reusable insert helper as a CTE-free guarded INSERT...SELECT per row.
-- Each statement: pick the assembly by (trade, name); insert the BOM line
-- only when no row for that (assembly, material_category) exists yet.

-- ─────────────────────────────────────────────────────────────────────
-- ELECTRICAL
-- ─────────────────────────────────────────────────────────────────────

-- downlight (new install) — 6 downlights + consumables (matches the
-- existing "Replace LED downlight" recipe shape).
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'electrical', 'downlight', 'LED downlight', 6, true, 1
from shared_assemblies a
where a.trade = 'electrical' and a.name = 'Install LED downlight (new install, single-storey)'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'downlight');

insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'electrical', 'sundries', 'Cable, terminals, clips', 1, true, 2
from shared_assemblies a
where a.trade = 'electrical' and a.name = 'Install LED downlight (new install, single-storey)'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- gpo (new dedicated 20A) — 1 GPO + consumables.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'electrical', 'gpo', 'Power outlet', 1, true, 1
from shared_assemblies a
where a.trade = 'electrical' and a.name = 'Install 20A dedicated GPO'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'gpo');

insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'electrical', 'sundries', 'Cable, terminals, clips', 1, true, 2
from shared_assemblies a
where a.trade = 'electrical' and a.name = 'Install 20A dedicated GPO'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- fan (supply + install AC ceiling fan) — 1 ceiling fan + consumables.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'electrical', 'ceiling_fan', 'Ceiling fan', 1, true, 1
from shared_assemblies a
where a.trade = 'electrical' and a.name = 'Supply + install AC ceiling fan'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'ceiling_fan');

insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'electrical', 'sundries', 'Mounting hardware, terminals', 1, true, 2
from shared_assemblies a
where a.trade = 'electrical' and a.name = 'Supply + install AC ceiling fan'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- fan (premium DC fan with wall control) — 1 ceiling fan + consumables.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'electrical', 'ceiling_fan', 'Ceiling fan', 1, true, 1
from shared_assemblies a
where a.trade = 'electrical' and a.name = 'Install premium DC fan with wall control'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'ceiling_fan');

insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'electrical', 'sundries', 'Wall control, terminals', 1, true, 2
from shared_assemblies a
where a.trade = 'electrical' and a.name = 'Install premium DC fan with wall control'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- smoke_alarm (hardwire 240V) — 1 alarm + consumables.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'electrical', 'smoke_alarm', 'Hardwired smoke alarm', 1, true, 1
from shared_assemblies a
where a.trade = 'electrical' and a.name = 'Hardwire 240V smoke alarm'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'smoke_alarm');

insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'electrical', 'sundries', 'Cable, terminals', 1, true, 2
from shared_assemblies a
where a.trade = 'electrical' and a.name = 'Hardwire 240V smoke alarm'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- outdoor_light (IP-rated LED) — 1 light + consumables.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'electrical', 'outdoor_light', 'Outdoor IP-rated light', 1, true, 1
from shared_assemblies a
where a.trade = 'electrical' and a.name = 'Install outdoor IP-rated LED light'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'outdoor_light');

insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'electrical', 'sundries', 'Weatherproof fittings, cable', 1, true, 2
from shared_assemblies a
where a.trade = 'electrical' and a.name = 'Install outdoor IP-rated LED light'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- oven_cooktop (install oven, existing wiring) — appliance is customer-
-- supplied (no shared_materials category); job consumes consumables only.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'electrical', 'sundries', 'Connection kit, terminals', 1, true, 1
from shared_assemblies a
where a.trade = 'electrical' and a.name = 'Install oven (existing wiring)'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- oven_cooktop (install cooktop, existing wiring) — same shape.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'electrical', 'sundries', 'Connection kit, terminals', 1, true, 1
from shared_assemblies a
where a.trade = 'electrical' and a.name = 'Install cooktop (existing wiring)'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- fault_find (diagnostic call-out) — labour-only; consumables optional.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'electrical', 'sundries', 'Consumables if a minor fix is made', 1, false, 1
from shared_assemblies a
where a.trade = 'electrical' and a.name = 'Diagnostic call-out (fault finding)'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- ─────────────────────────────────────────────────────────────────────
-- PLUMBING
-- ─────────────────────────────────────────────────────────────────────

-- hot_water (electric HWS) — 1 unit + consumables.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'plumbing', 'hws_electric', 'Electric hot water system', 1, true, 1
from shared_assemblies a
where a.trade = 'plumbing' and a.name = 'Install electric HWS'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'hws_electric');

insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'plumbing', 'sundries', 'Fittings, seals, tape', 1, true, 2
from shared_assemblies a
where a.trade = 'plumbing' and a.name = 'Install electric HWS'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- hot_water (gas HWS) — 1 unit + consumables.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'plumbing', 'hws_gas', 'Gas hot water system', 1, true, 1
from shared_assemblies a
where a.trade = 'plumbing' and a.name = 'Install gas HWS'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'hws_gas');

insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'plumbing', 'sundries', 'Fittings, seals, tape', 1, true, 2
from shared_assemblies a
where a.trade = 'plumbing' and a.name = 'Install gas HWS'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- hot_water (heat pump HWS) — 1 unit + consumables.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'plumbing', 'hws_heat_pump', 'Heat pump hot water system', 1, true, 1
from shared_assemblies a
where a.trade = 'plumbing' and a.name = 'Install heat pump HWS'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'hws_heat_pump');

insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'plumbing', 'sundries', 'Fittings, seals, tape', 1, true, 2
from shared_assemblies a
where a.trade = 'plumbing' and a.name = 'Install heat pump HWS'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- tap (tap replacement) — 1 tap (basin tapware is the generic default) +
-- consumables.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'plumbing', 'tapware_basin', 'Replacement tap / mixer', 1, true, 1
from shared_assemblies a
where a.trade = 'plumbing' and a.name = 'Tap replacement'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'tapware_basin');

insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'plumbing', 'sundries', 'Seals, tape, connectors', 1, true, 2
from shared_assemblies a
where a.trade = 'plumbing' and a.name = 'Tap replacement'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- toilet (toilet suite install) — 1 suite + consumables.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'plumbing', 'toilet', 'Toilet suite', 1, true, 1
from shared_assemblies a
where a.trade = 'plumbing' and a.name = 'Toilet suite install'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'toilet');

insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'plumbing', 'sundries', 'Pan connector, seals, fixings', 1, true, 2
from shared_assemblies a
where a.trade = 'plumbing' and a.name = 'Toilet suite install'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- gas (gas appliance connection) — licensed labour; appliance customer-
-- supplied. No gas-appliance shared_materials category → consumables only.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'plumbing', 'sundries', 'Gas fittings, sealant, test', 1, true, 1
from shared_assemblies a
where a.trade = 'plumbing' and a.name = 'Gas appliance connection'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- drain (hand rod blocked drain) — service/labour; consumables only.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'plumbing', 'sundries', 'Consumables, disposal', 1, true, 1
from shared_assemblies a
where a.trade = 'plumbing' and a.name = 'Hand rod blocked drain'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- drain (jet blast blocked drain) — service/labour; consumables only.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'plumbing', 'sundries', 'Consumables, disposal', 1, true, 1
from shared_assemblies a
where a.trade = 'plumbing' and a.name = 'Jet blast blocked drain'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- cctv (CCTV drain inspection) — inspection/labour; consumables optional.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'plumbing', 'sundries', 'Consumables if a minor repair is made', 1, false, 1
from shared_assemblies a
where a.trade = 'plumbing' and a.name = 'CCTV drain inspection'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- prv (pressure reduction valve install) — no PRV shared_materials
-- category exists; the valve + fittings are quoted as consumables.
insert into shared_assembly_bom (assembly_id, trade, material_category, description, quantity, required, sort)
select a.id, 'plumbing', 'sundries', 'PRV valve, fittings, seals', 1, true, 1
from shared_assemblies a
where a.trade = 'plumbing' and a.name = 'Pressure reduction valve install'
  and not exists (select 1 from shared_assembly_bom b where b.assembly_id = a.id and lower(b.material_category) = 'sundries');

-- Keep PostgREST's schema cache fresh (mirrors migration 028 pattern).
notify pgrst, 'reload schema';
