-- ════════════════════════════════════════════════════════════════════
-- Migration 130 — structural catalogue integrity (R11, AUTONOMOUS parts).
--
-- WHY: R11 requires the catalogue to be structurally sound BEFORE any AU
-- price calibration (R12/R13) runs — calibrating a catalogue that still has
-- a mis-categorised line, a NULL-brand row, or a duplicate product just
-- calibrates noise. This migration lands the parts that are safe to do
-- without owner judgement; the parts that need a human (deduping real rows,
-- assigning real brands) are FLAGGED here and reported by the read-only
-- audit, never auto-applied.
--
-- DATA MIGRATION — it mutates existing shared_assembly_bom rows (the
-- sundry -> sundries normalise below), so the runner takes a pre-apply
-- backup snapshot of BOTH shared_materials AND shared_assembly_bom
-- (scripts/run-migration-130.mjs: shared_materials_backup_mig130,
-- shared_assembly_bom_backup_mig130). The brand-NULL backfill and the
-- product de-dup are DELIBERATELY NOT performed here (flagged for owner).
--
-- ── WHAT THIS MIGRATION DOES ─────────────────────────────────────────
--
-- (1) NORMALISE shared_assembly_bom.material_category 'sundry' -> 'sundries'.
--     The deterministic resolver chooseMaterial() matches material_category
--     against shared_materials.category with an exact (trim+lowercase)
--     equality. shared_materials uses 'sundries' (PLURAL); the 3 legacy
--     downlight-recipe rows seeded before migration 118 used 'sundry'
--     (SINGULAR) — that string does NOT exist in shared_materials, so those
--     BOM lines cannot resolve their consumables today (documented in 118's
--     header as flagged-for-owner; this migration closes it). GUARDED: the
--     UPDATE only ever touches rows whose material_category is exactly
--     'sundry'; if 0 such rows exist it is a clean no-op.
--
--     NOTE — vocab boundary (verified, do NOT widen this): the SINGULAR
--     'sundry' is the CORRECT value in a DIFFERENT column —
--     shared_assemblies.category (the coarse GROUNDING vocab, set by
--     migrations 036/037). This migration touches ONLY
--     shared_assembly_bom.material_category (the granular MATERIAL vocab).
--     It must not rename any shared_assemblies.category value.
--
--     COLLISION GUARD: shared_assembly_bom has a unique index on
--     (assembly_id, lower(material_category), lower(coalesce(description,''))).
--     If an assembly already has BOTH a 'sundry' line and a 'sundries' line
--     with the same description, a blind rename would violate that index.
--     The UPDATE is therefore guarded by a NOT EXISTS so it skips any row
--     that would collide; the audit script reports such a row so the owner
--     can reconcile it by hand (it is not auto-deleted).
--
-- (2) RECURRENCE GUARD (deliberately NOT a hard enum CHECK). A hard CHECK on
--     material_category would be too strict — the live category set is open
--     (downlight, gpo, hws_*, tapware_*, toilet*, ceiling_fan, smoke_alarm,
--     outdoor_light, safety_switch, sundries, ...) and a future legitimate
--     category would be blocked. A trigger is overkill. Instead the
--     convention is DOCUMENTED on the column (comment below) and ENFORCED by
--     the read-only audit (scripts/audit-catalogue-integrity.mjs), which
--     FAILS (non-zero exit) if 'sundry' ever reappears. Strengthen later to
--     a CHECK only once the full category set is frozen.
--
-- (3) UNIQUE INDEX to prevent duplicate products:
--       shared_materials_trade_cat_name_uniq
--         on shared_materials (trade, lower(category), lower(name))
--     created IF NOT EXISTS. ⚠ CREATE UNIQUE INDEX FAILS if duplicate
--     (trade, lower(category), lower(name)) groups already exist. This
--     migration is written to be applied AFTER de-dup: RUN
--     scripts/audit-catalogue-integrity.mjs FIRST — if it reports any
--     duplicate group, do NOT apply this migration until the owner has
--     reconciled the duplicates by hand. De-duping real catalogue rows is a
--     judgement call (which row's price/brand survives) and is FLAGGED for
--     owner review, never auto-deleted here.
--
-- ── WHAT THIS MIGRATION DELIBERATELY DOES NOT DO (flagged — owner input) ─
--
--   • The brand=NULL shared_materials rows (the ~5-6 genuinely-branded
--     products migration 120 left NULL — downlights + smart outdoor light)
--     are NOT backfilled. The flag-not-fabricate constraint forbids
--     inventing an unverifiable AU brand. They are reported by the audit and
--     await owner input. (Provenance: docs/markdown/catalog-data-provenance.md
--     / migration 120 header.)
--   • Duplicate products are NOT auto-deleted (see (3)).
--   • Missing Good/Better/Best 3-tier spreads are NOT auto-filled (adding a
--     real third product needs a verified AU SKU/price — owner/calibration
--     work). The audit reports which allowlisted job types lack a complete
--     3-tier spread.
--
-- Idempotent: the normalise is guarded (no-op once 0 'sundry' rows remain);
-- the index is CREATE ... IF NOT EXISTS.
-- NOT auto-applied to prod. Apply with:
--   node --env-file=.env.local scripts/run-migration-130.mjs
-- Rollback with:
--   node --env-file=.env.local scripts/run-migration-130.mjs --rollback
-- ════════════════════════════════════════════════════════════════════

-- (1) Normalise shared_assembly_bom.material_category 'sundry' -> 'sundries'.
-- Guarded twice: only rows that ARE exactly 'sundry', and only when the
-- rename would not collide with an existing 'sundries' line on the same
-- (assembly_id, description) (the unique-index predicate).
update shared_assembly_bom b
   set material_category = 'sundries'
 where lower(b.material_category) = 'sundry'
   and not exists (
     select 1 from shared_assembly_bom c
     where c.assembly_id = b.assembly_id
       and lower(c.material_category) = 'sundries'
       and lower(coalesce(c.description, '')) = lower(coalesce(b.description, ''))
   );

-- (2) Document the convention on the column (the recurrence guard the audit
-- enforces). No hard CHECK / trigger — see header rationale.
comment on column shared_assembly_bom.material_category is
  'Granular MATERIAL vocab - MUST equal a shared_materials.category string (exact trim+lowercase match by chooseMaterial()). CONVENTION: use the PLURAL "sundries", never the singular "sundry" (which is the grounding-vocab value on shared_assemblies.category, a DIFFERENT column). Enforced by scripts/audit-catalogue-integrity.mjs, which fails if "sundry" reappears (migration 130 / R11). Not a hard CHECK because the category set is still open.';

-- (3) Unique index to prevent duplicate products. ⚠ Apply ONLY after the
-- audit confirms 0 duplicate (trade, lower(category), lower(name)) groups —
-- otherwise this CREATE fails. Duplicates are flagged for owner de-dup, not
-- auto-deleted.
create unique index if not exists shared_materials_trade_cat_name_uniq
  on shared_materials (trade, lower(category), lower(name));

comment on index shared_materials_trade_cat_name_uniq is
  'R11 duplicate-product guard: at most one shared_materials row per (trade, lower(category), lower(name)). Created by migration 130 AFTER owner de-dup (CREATE fails if duplicates exist). Brand NULLs + tier-spread gaps are flagged separately (audit-catalogue-integrity.mjs), not enforced here.';

-- Keep PostgREST's schema cache fresh (the column comment + new index).
notify pgrst, 'reload schema';
