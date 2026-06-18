-- ════════════════════════════════════════════════════════════════════
-- Migration 120 — shared_materials brand A-pass (electrical + plumbing)
--
-- Context (R17, catalog data-accuracy pass, 2026-06-18):
--   A read-only prod audit (project bobvihqwhtcbxneelfns) found that 8
--   electrical/plumbing shared_materials rows carry brand IS NULL. The
--   spec also expected "some missing category" — CONFIRMED STALE: every
--   electrical+plumbing row already has a non-null category, so this
--   migration touches `brand` ONLY. No category writes, no schema change.
--
--   The brand column feeds two consumers:
--     1. tenant_material_preferences (migration 022) — the dashboard
--        enumerates distinct brands per category so a tradie can pick a
--        preferred supply brand. A NULL brand is invisible there.
--     2. The estimator's brand-preference hint (lib/estimate/run.ts
--        buildPreferencesBlock) — soft "prefer brand X" guidance.
--   Neither path is a grounding gate (grounding keys off price + category),
--   so this fill is purely a data-quality / brand-preference improvement
--   and CANNOT change which quotes ground or dump to inspection.
--
-- What this migration DOES (the only genuinely verifiable subset):
--   Sets brand = 'Generic' on the 3 rows that legitimately have NO single
--   brand — mixed-supplier consumables and generic cable. A 'Generic'
--   sentinel is accurate for these (they are not a branded SKU) and lets
--   the dashboard render them in the per-category brand list instead of a
--   blank.
--     • electrical "Sundries (terminals, wire, clips)"   ($50, each)
--     • electrical "TPS cable 2.5mm² per metre"          ($5,  lm)
--     • plumbing   "Plumbing sundries (fittings, seals, tape)" ($35, each)
--   TPS / twin-and-earth cable is a generic AS/NZS 5000.2 spec sold by
--   every wholesaler under house labels — there is no single canonical
--   brand to assign, so 'Generic' is the correct value (RESEARCH-INTEGRITY:
--   not a guessed brand, a structurally-accurate generic).
--
-- What this migration DELIBERATELY DOES NOT do (flagged — owner input):
--   The 5 remaining no-brand rows are genuinely branded products
--   (4 downlights + 1 smart outdoor light). Assigning a specific AU brand
--   (e.g. HPM / Brilliant / Mercator / Deta) to each could not be verified
--   against a primary AU source in this pass, and the spec's RESEARCH-
--   INTEGRITY rule forbids inventing an unverifiable brand. They are left
--   NULL and recorded in docs/markdown/catalog-data-provenance.md as
--   "needs owner input":
--     • "Basic LED downlight"                                  ($28)
--     • "Tri-colour LED downlight"                             ($48)
--     • "Dimmable IP-rated downlight"                          ($72)
--     • "Premium 90+CRI warm-white LED downlight (5yr warranty)" ($75)
--     • "Smart dimmable outdoor light"                         ($140)
--
-- Idempotent: each UPDATE is guarded by `(brand is null or brand = '')`
-- so re-running never clobbers a brand an owner later set by hand, and the
-- by-id WHERE makes the target unambiguous.
-- ════════════════════════════════════════════════════════════════════

-- electrical — Sundries (terminals, wire, clips)
update shared_materials
   set brand = 'Generic'
 where id = '3ff08f92-830b-4ccf-b01e-83b16930ae83'
   and trade = 'electrical'
   and (brand is null or brand = '');

-- electrical — TPS cable 2.5mm² per metre (generic AS/NZS 5000.2 cable)
update shared_materials
   set brand = 'Generic'
 where id = '7c2a4561-8b9d-4e1c-a3f4-b5d6e7f80250'
   and trade = 'electrical'
   and (brand is null or brand = '');

-- plumbing — Plumbing sundries (fittings, seals, tape)
update shared_materials
   set brand = 'Generic'
 where id = '23c751c4-ff97-49db-a34a-f8d676193819'
   and trade = 'plumbing'
   and (brand is null or brand = '');
