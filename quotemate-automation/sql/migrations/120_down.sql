-- ════════════════════════════════════════════════════════════════════
-- Migration 120 — DOWN (rollback of the shared_materials brand A-pass).
--
-- Reverses: 120_material_brand_category.sql, which set brand = 'Generic' on
-- exactly 3 shared_materials rows (mixed-supplier consumables + generic
-- cable). This down migration sets those same 3 rows' brand back to NULL.
--
-- SURGICAL MATCH — never clobbers a real brand:
--   Each UPDATE is keyed by the EXACT id the forward migration targeted AND
--   guarded by  brand = 'Generic'.  The guard means that if an operator has
--   since replaced 'Generic' with a real brand on one of these rows, the
--   down migration leaves that real value untouched (it only un-does the
--   sentinel it itself wrote).
--
-- IRREVERSIBILITY CAVEAT:
--   The forward migration only ever touched rows whose brand was NULL/'' to
--   begin with, so NULL is the correct pre-119 state to restore for the
--   'Generic'-tagged rows. The 5 deliberately-left-NULL branded rows were
--   never changed by 120 and are not referenced here. For a true row-for-row
--   restore of the whole table, use the runner's pre-apply snapshot
--       shared_materials_backup_mig120
--   (created by scripts/run-migration-120.mjs on the forward path).
--
-- Idempotent: re-running affects 0 rows once the 3 are NULL again.
-- Apply with: node --env-file=.env.local scripts/run-migration-120.mjs --rollback
-- ════════════════════════════════════════════════════════════════════

-- electrical — Sundries (terminals, wire, clips)
update shared_materials
   set brand = null
 where id = '3ff08f92-830b-4ccf-b01e-83b16930ae83'
   and trade = 'electrical'
   and brand = 'Generic';

-- electrical — TPS cable 2.5mm² per metre (generic AS/NZS 5000.2 cable)
update shared_materials
   set brand = null
 where id = '7c2a4561-8b9d-4e1c-a3f4-b5d6e7f80250'
   and trade = 'electrical'
   and brand = 'Generic';

-- plumbing — Plumbing sundries (fittings, seals, tape)
update shared_materials
   set brand = null
 where id = '23c751c4-ff97-49db-a34a-f8d676193819'
   and trade = 'plumbing'
   and brand = 'Generic';
