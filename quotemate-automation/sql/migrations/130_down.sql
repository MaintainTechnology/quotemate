-- ════════════════════════════════════════════════════════════════════
-- Migration 130 — DOWN (rollback of the catalogue-integrity pass, R11).
--
-- Reverses what is reversible in 130_catalogue_integrity.sql:
--   (3) DROP the duplicate-product unique index
--         shared_materials_trade_cat_name_uniq                 — reversible.
--   (2) RESET the column comment on shared_assembly_bom.material_category
--       back to the prior structural description               — reversible.
--
-- ── ONE-WAY DATA CHANGE — NOT auto-reversed here ─────────────────────
--   (1) The 'sundry' -> 'sundries' normalise on
--       shared_assembly_bom.material_category is a DATA change and is NOT
--       blindly reverted: 'sundries' is the correct value (it is also the
--       value migration 118 wrote on every NEW row), so a blanket
--       'sundries' -> 'sundry' would WRONGLY also rename the legitimate
--       118-seeded rows and re-break consumable resolution. There is no
--       safe column-level inverse.
--
--       To restore the EXACT pre-130 material_category values for the rows
--       this migration touched, use the runner's pre-apply snapshot:
--           shared_assembly_bom_backup_mig130
--       (taken by scripts/run-migration-130.mjs on the forward path).
--       e.g. (operator-run, after reviewing the diff):
--           update shared_assembly_bom b
--              set material_category = s.material_category
--             from shared_assembly_bom_backup_mig130 s
--            where s.id = b.id
--              and s.material_category is distinct from b.material_category;
--       shared_materials_backup_mig130 is the matching snapshot for the
--       (unmodified) materials table, kept for symmetry / a full restore.
--
-- Idempotent: DROP INDEX IF EXISTS; the comment reset is unconditional.
-- Apply with: node --env-file=.env.local scripts/run-migration-130.mjs --rollback
-- ════════════════════════════════════════════════════════════════════

-- (3) drop the duplicate-product unique index.
drop index if exists shared_materials_trade_cat_name_uniq;

-- (2) reset the column comment to the structural description from
-- migration 028 (its original create-time intent), dropping the 130
-- convention note.
comment on column shared_assembly_bom.material_category is
  'Which material category this BOM line needs. The estimator resolves it against tenant_material_catalogue first, then shared_materials.';

-- Keep PostgREST's schema cache fresh.
notify pgrst, 'reload schema';
