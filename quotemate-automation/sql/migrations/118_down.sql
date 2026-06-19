-- ════════════════════════════════════════════════════════════════════
-- Migration 118 — DOWN (rollback of the shared_assembly_bom CORE seed).
--
-- Reverses: 118_shared_assembly_bom_seed.sql, which seeded one BOM line per
-- (assembly, material_category) for the CORE electrical + plumbing
-- assemblies. This down migration DELETEs exactly those seeded rows and
-- nothing else.
--
-- HOW IT MATCHES — surgical, never blanket:
--   Each DELETE joins shared_assembly_bom → shared_assemblies and matches on
--   the EXACT tuple the forward insert authored:
--     (assembly via a.trade + a.name) + b.material_category + b.description.
--   Matching the description too means a tenant-/owner-added BOM line for the
--   same (assembly, category) with a different description is NEVER touched,
--   and a job's other BOM rows are never collateral-deleted.
--
-- IRREVERSIBILITY CAVEAT:
--   • Only rows whose (assembly_name, trade, material_category, description)
--     tuple is one this migration authored are removed. If an operator later
--     hand-edited a seeded row's description/quantity, the description guard
--     means that edited row will NOT match and will survive (intended — we
--     never clobber a human edit). True row-for-row restore of the exact
--     pre-118 table state is available from the runner's pre-apply snapshot
--     table  shared_assembly_bom_backup_mig118  (created by
--     scripts/run-migration-118.mjs on the forward path).
--   • The 3 PRE-EXISTING rows (Replace double GPO, Replace LED downlight ×2)
--     that predate 118 are NOT matched by any tuple below and are preserved.
--
-- Idempotent: re-running deletes 0 rows once the seeded rows are gone.
-- Apply with: node --env-file=.env.local scripts/run-migration-118.mjs --rollback
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- ELECTRICAL
-- ─────────────────────────────────────────────────────────────────────

-- Install LED downlight (new install, single-storey)
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'electrical' and a.name = 'Install LED downlight (new install, single-storey)'
  and b.material_category = 'downlight' and b.description = 'LED downlight';

delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'electrical' and a.name = 'Install LED downlight (new install, single-storey)'
  and b.material_category = 'sundries' and b.description = 'Cable, terminals, clips';

-- Install 20A dedicated GPO
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'electrical' and a.name = 'Install 20A dedicated GPO'
  and b.material_category = 'gpo' and b.description = 'Power outlet';

delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'electrical' and a.name = 'Install 20A dedicated GPO'
  and b.material_category = 'sundries' and b.description = 'Cable, terminals, clips';

-- Supply + install AC ceiling fan
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'electrical' and a.name = 'Supply + install AC ceiling fan'
  and b.material_category = 'ceiling_fan' and b.description = 'Ceiling fan';

delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'electrical' and a.name = 'Supply + install AC ceiling fan'
  and b.material_category = 'sundries' and b.description = 'Mounting hardware, terminals';

-- Install premium DC fan with wall control
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'electrical' and a.name = 'Install premium DC fan with wall control'
  and b.material_category = 'ceiling_fan' and b.description = 'Ceiling fan';

delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'electrical' and a.name = 'Install premium DC fan with wall control'
  and b.material_category = 'sundries' and b.description = 'Wall control, terminals';

-- Hardwire 240V smoke alarm
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'electrical' and a.name = 'Hardwire 240V smoke alarm'
  and b.material_category = 'smoke_alarm' and b.description = 'Hardwired smoke alarm';

delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'electrical' and a.name = 'Hardwire 240V smoke alarm'
  and b.material_category = 'sundries' and b.description = 'Cable, terminals';

-- Install outdoor IP-rated LED light
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'electrical' and a.name = 'Install outdoor IP-rated LED light'
  and b.material_category = 'outdoor_light' and b.description = 'Outdoor IP-rated light';

delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'electrical' and a.name = 'Install outdoor IP-rated LED light'
  and b.material_category = 'sundries' and b.description = 'Weatherproof fittings, cable';

-- Install oven (existing wiring)
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'electrical' and a.name = 'Install oven (existing wiring)'
  and b.material_category = 'sundries' and b.description = 'Connection kit, terminals';

-- Install cooktop (existing wiring)
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'electrical' and a.name = 'Install cooktop (existing wiring)'
  and b.material_category = 'sundries' and b.description = 'Connection kit, terminals';

-- Diagnostic call-out (fault finding)
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'electrical' and a.name = 'Diagnostic call-out (fault finding)'
  and b.material_category = 'sundries' and b.description = 'Consumables if a minor fix is made';

-- ─────────────────────────────────────────────────────────────────────
-- PLUMBING
-- ─────────────────────────────────────────────────────────────────────

-- Install electric HWS
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'plumbing' and a.name = 'Install electric HWS'
  and b.material_category = 'hws_electric' and b.description = 'Electric hot water system';

delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'plumbing' and a.name = 'Install electric HWS'
  and b.material_category = 'sundries' and b.description = 'Fittings, seals, tape';

-- Install gas HWS
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'plumbing' and a.name = 'Install gas HWS'
  and b.material_category = 'hws_gas' and b.description = 'Gas hot water system';

delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'plumbing' and a.name = 'Install gas HWS'
  and b.material_category = 'sundries' and b.description = 'Fittings, seals, tape';

-- Install heat pump HWS
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'plumbing' and a.name = 'Install heat pump HWS'
  and b.material_category = 'hws_heat_pump' and b.description = 'Heat pump hot water system';

delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'plumbing' and a.name = 'Install heat pump HWS'
  and b.material_category = 'sundries' and b.description = 'Fittings, seals, tape';

-- Tap replacement
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'plumbing' and a.name = 'Tap replacement'
  and b.material_category = 'tapware_basin' and b.description = 'Replacement tap / mixer';

delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'plumbing' and a.name = 'Tap replacement'
  and b.material_category = 'sundries' and b.description = 'Seals, tape, connectors';

-- Toilet suite install
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'plumbing' and a.name = 'Toilet suite install'
  and b.material_category = 'toilet' and b.description = 'Toilet suite';

delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'plumbing' and a.name = 'Toilet suite install'
  and b.material_category = 'sundries' and b.description = 'Pan connector, seals, fixings';

-- Gas appliance connection
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'plumbing' and a.name = 'Gas appliance connection'
  and b.material_category = 'sundries' and b.description = 'Gas fittings, sealant, test';

-- Hand rod blocked drain
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'plumbing' and a.name = 'Hand rod blocked drain'
  and b.material_category = 'sundries' and b.description = 'Consumables, disposal';

-- Jet blast blocked drain
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'plumbing' and a.name = 'Jet blast blocked drain'
  and b.material_category = 'sundries' and b.description = 'Consumables, disposal';

-- CCTV drain inspection
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'plumbing' and a.name = 'CCTV drain inspection'
  and b.material_category = 'sundries' and b.description = 'Consumables if a minor repair is made';

-- Pressure reduction valve install
delete from shared_assembly_bom b
using shared_assemblies a
where b.assembly_id = a.id
  and a.trade = 'plumbing' and a.name = 'Pressure reduction valve install'
  and b.material_category = 'sundries' and b.description = 'PRV valve, fittings, seals';

-- Keep PostgREST's schema cache fresh (mirrors the forward migration).
notify pgrst, 'reload schema';
