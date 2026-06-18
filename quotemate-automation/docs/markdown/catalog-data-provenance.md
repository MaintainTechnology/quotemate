# Catalog data provenance — shared_materials brand A-pass (R17) + groundable-path B-pass (R21)

> Scope: **electrical + plumbing only.** Roofing / aircon / solar / signage /
> painting rows are out of scope for this pass and are not audited here.
>
> Audit basis: **read-only** query of prod Supabase (`bobvihqwhtcbxneelfns`,
> `SUPABASE_DB_URL`) on 2026-06-18. Migration: `sql/migrations/120_material_brand_category.sql`
> (+ `scripts/run-migration-120.mjs`). Verified on dev via `BEGIN; … ROLLBACK;`
> (no permanent dev or prod write made during the audit).

---

## Confirmed drift vs. the spec's seed findings

| Seed finding (spec) | Reality on prod (2026-06-18) | Action |
|---|---|---|
| "8 el/pl rows missing brand **and some missing category**" | **8 rows missing brand; ZERO missing category.** Every electrical+plumbing `shared_materials` row already carries a non-null `category`. | R17 is **brand-only**. No category writes; no `category` column add. |
| "`apprentice_rate` / `senior_rate` / `after_hours_multiplier` not used by the estimator" | **STALE — they are WIRED.** `lib/estimate/validate.ts` accepts `apprentice_rate`, `senior_rate` (labour lines, L862-883) and `after_hours_multiplier` (after-hours labour + call-out, L737-900, gated >1 and ≤2.5). Prod `pricing_book` populates all three per tenant. | Treated as **wired**, not dead. Not edited (out of this task's file scope). |
| `shared_materials.category` == the validator's grounding category | **Two different taxonomies.** The stored column uses the **migration-022 taxonomy** (`sundries`, `safety_switch`, `ceiling_fan`, `hws_gas`, `tapware_basin`, …) for tenant brand-preferences. The validator's grounding categories (`lib/estimate/categories.ts`) are different (`sundry`, `rcbo`, `fan`, `hot_water`, `tap`, …). `buildCandidatePrices` only folds the stored category in when `isCategory()` matches `categories.ts`, so for most rows **grounding keys off the row NAME via regex**, not the stored category. | Category fills (if ever needed) must use the **existing 022 taxonomy** for consistency. None needed this pass. |

**Consequence for R17:** the `brand` column is **not** a grounding input — it feeds
(a) the dashboard's per-category brand list and (b) the estimator's soft
"prefer brand X" hint (`buildPreferencesBlock`). Filling brand cannot change
which quotes ground or dump to inspection. It is a pure data-quality fix.

---

## R17 A-pass — per-row brand provenance (electrical + plumbing)

The 8 no-brand rows fall into two classes.

### Filled by migration 120 — `brand = 'Generic'` (structurally accurate, not guessed)

| Trade | Row name | Price | Unit | prod id | Source / justification |
|---|---|---|---|---|---|
| electrical | Sundries (terminals, wire, clips) | $50.00 | each | `3ff08f92-830b-4ccf-b01e-83b16930ae83` | Mixed-supplier consumable bundle — no single SKU/brand. `'Generic'` is the structurally correct value (the row IS a grab-bag), not an invented brand. |
| electrical | TPS cable 2.5mm² per metre | $5.00 | lm | `7c2a4561-8b9d-4e1c-a3f4-b5d6e7f80250` | TPS / twin-and-earth is a generic **AS/NZS 5000.2** cable spec sold by every AU wholesaler under house labels (Olex, Prysmian, and store brands) — there is no single canonical brand. `'Generic'` reflects the spec-not-brand nature. |
| plumbing | Plumbing sundries (fittings, seals, tape) | $35.00 | each | `23c751c4-ff97-49db-a34a-f8d676193819` | Mixed-supplier consumable bundle (PTFE tape, seals, fittings) — no single brand. `'Generic'` is structurally accurate. |

### Flagged — NEEDS OWNER INPUT (left NULL; not guessed)

These are genuinely **branded products**, but a specific AU brand could not be
verified against a primary source in this pass. Per the research-integrity rule
(never invent an unverifiable brand) they are left `brand IS NULL` for the
catalogue owner to set. The dashboard already supports editing brand per row.

| Trade | Row name | Price | prod id | Why flagged |
|---|---|---|---|---|
| electrical | Basic LED downlight | $28.00 | `21704425-4e11-4403-b766-4ed8bc93cc6d` | Branded fitting; specific AU brand unverifiable here. Catalogue precedent uses HPM / Clipsal, but mapping a specific brand to *this* SKU/price needs the owner's supply choice. |
| electrical | Tri-colour LED downlight | $48.00 | `572a0a38-b9a6-40cd-976e-d14109035e10` | Same — branded tri-colour downlight; owner to confirm (e.g. Brilliant / Mercator / HPM). |
| electrical | Dimmable IP-rated downlight | $72.00 | `4b9826d9-1649-4587-89c1-8ffae7143aab` | Same — branded IP-rated dimmable downlight; owner to confirm. |
| electrical | Premium 90+CRI warm-white LED downlight (5yr warranty) | $75.00 | `a558384e-9203-49b6-a7e0-bddc0eed3299` | Premium branded downlight (the "5yr warranty" implies a specific brand line); owner to confirm. |
| electrical | Smart dimmable outdoor light | $140.00 | `116b0b13-e0df-4ac9-93d2-db524ac5437a` | Branded smart outdoor luminaire; owner to confirm (e.g. HPM / Brilliant Smart / Mercator). |

> Owner action: set `shared_materials.brand` on each of the 5 rows above to the
> real supply brand. A follow-up migration can do this once the brands are
> confirmed; until then they render blank in the dashboard brand list (harmless
> — grounding is unaffected).

---

## R21 B-pass — groundable price-path per representative job type

A path is **groundable** when, for the job's trade: (1) ≥1 non-`always_inspection`
assembly exists, (2) every material category the job needs exists and is priced,
and (3) tenant overlays resolve (`pricing_book` row present with hourly / call-out /
markup / min-labour). Material-category presence is checked in the **stored
(022) taxonomy**; note the validator additionally grounds material lines by NAME
regex, so a category whose stored value isn't in `categories.ts` (e.g.
`hws_electric`) still grounds via the material's name (`…HWS…` → `hot_water`).

**Result: all 14 representative job types have an intact groundable path. No BROKEN paths.**

| Job type | Trade | Groundable assembly(ies) | Material cats (exist + priced) | Path |
|---|---|---|---|---|
| downlights | electrical | Replace LED downlight ($28); Install LED downlight ($35) | downlight (4/4) | OK |
| power_points | electrical | Replace double GPO ($22); Install 20A dedicated GPO ($80); +2 more | gpo (4/4) | OK |
| ceiling_fans | electrical | Supply+install AC fan ($35); Premium DC fan ($55); +2 more | ceiling_fan (2/2) | OK |
| smoke_alarms | electrical | Hardwire 240V smoke alarm ($30); whole-house compliance ($40) | smoke_alarm (2/2) | OK |
| outdoor_lighting | electrical | Install outdoor IP-rated LED light ($32); +3 more | outdoor_light (2/2) | OK |
| oven_cooktop | electrical | Install oven (existing wiring) ($45); Install cooktop ($45); +2 | none (labour / customer-supplied appliance) | OK |
| fault_finding | electrical | Diagnostic call-out (fault finding) ($165) | none (labour / call-out) | OK |
| hot_water | plumbing | Install electric HWS ($45); Install heat pump HWS ($80) — gas HWS is `always_inspection` (correctly excluded) | hws_electric (4/4), hws_gas (4/4), hws_heat_pump (2/2) | OK |
| blocked_drain | plumbing | Hand rod ($30); Jet blast ($80); +1 (CCTV $150) | none (labour + sundries) | OK |
| tap_replace | plumbing | Tap replacement ($25); garden tap ($30); washing-machine taps ($25) | tapware_basin/kitchen/laundry/outdoor (all priced) | OK |
| toilet_replace | plumbing | Toilet suite install ($35) | toilet (4/4) | OK |
| tap_repair | plumbing | Tap washer replacement ($8) | none (labour + sundries) | OK |
| toilet_repair | plumbing | Toilet cistern repair ($25) | toilet_repair (1/1) | OK |
| gas_fitting | plumbing | Gas appliance connection ($30) — Install gas HWS is `always_inspection` (correctly excluded) | none (labour; appliance customer-supplied) | OK |

### R21 observations (not broken, but worth owner awareness — NOT fixed in this pass)

- **gas_fitting** has exactly **one** non-`always_inspection` groundable assembly
  ("Gas appliance connection"). The only other gas row ("Install gas HWS") is
  correctly `always_inspection=true`. The path is intact but thin — a second
  gas labour assembly (e.g. gas cooktop / bayonet point) would add resilience.
- **`default_enabled` vs per-tenant enablement:** several assemblies that back a
  job type ship `default_enabled=false` (e.g. "Install motion sensor flood
  light", "Install washing machine taps") but are enabled by ≥1 active tenant
  via `tenant_service_offerings`. Every job type above is enabled by at least one
  active tenant, so no job type is dark platform-wide. A tenant that has disabled
  *all* assemblies for a job type would route that job to inspection — that's
  by-design tenant scoping, not a catalogue defect.
- **pricing_book overlays resolve** for all 4 active tenants across electrical
  and/or plumbing (hourly, call-out, markup, min-labour all populated;
  `after_hours_multiplier` populated too — confirming it is wired in
  `validate.ts`).

---

## Verification

- **Audit:** read-only against prod (`SUPABASE_DB_URL`). No prod write.
- **Migration logic:** executed inside `BEGIN; … ROLLBACK;` on the dev DB
  (`SUPABASE_DEVELOPMENT_DB_URL`). The `(brand is null or brand = '')` guard
  matched the dev sundry rows on first run and **0 rows on a second run**
  (idempotent — no clobber). Dev left unchanged by the rollback.
- **Note on dev ids:** dev seed UUIDs differ from prod, so migration 120's
  by-id `UPDATE`s no-op on dev (expected/safe). The id targets were taken from
  the prod audit, where those exact rows exist.
- `scripts/run-migration-120.mjs` re-verifies after applying to prod: asserts the
  3 target rows are `brand='Generic'` and prints the remaining (flagged) no-brand
  rows.
