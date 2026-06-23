# Roofing — roof types drive pricing

> Status: approved design, ready for implementation plan
> Date: 2026-06-24
> Trade: roofing
> Type: code-only change (no DB migration)

## Objective

Add **Corrugated COLORBOND** and **Spandek COLORBOND** as selectable roof types on
the roofing measure page, alongside the existing Trimdek, Klip-Lok 700, concrete
tile, terracotta tile and cement-sheet options, and have each new type **drive the
re-roof price** through the existing per-m² rate engine.

Source of the type list: the supplier catalogue the product owner pointed to
(`metalroofingonline.com.au`, ROOFING IRON → COLORBOND range). Corrugated is the
profile in the supplied link; Spandek, Trimdek and Klip-Lok are the other common
COLORBOND profiles in the same range.

## Background — how pricing works today

- A roof's `material` (`RoofMaterial` union, `lib/roofing/types.ts:17`) maps to a
  **fully-loaded installed `$/m²`** in `reroof_rate_per_m2`
  (`DEFAULT_ROOFING_RATE_CARD`, `lib/roofing/pricing.ts:127`).
- `calculateRoofingPrice` (`lib/roofing/pricing.ts:267`) computes three tiers on the
  chosen material's rate:
  - **Good** = patch (`GOOD_TIER_SCOPE_FRACTION = 0.20` of the full re-roof, same material).
  - **Better** = full re-roof, **same material** (`baseRate`).
  - **Best** = full re-roof, **upgraded** to `rateCard.upgrade_material` (default `colorbond_kliplok`).
  - Loadings (multi-storey, asbestos, complexity) and GST layer on top; a per-structure
    `call_out_minimum_ex_gst` floor applies.
- The rate lookup is **already keyed on the enum** (`baseRate = rateCard.reroof_rate_per_m2[inputs.material]`,
  `pricing.ts:297`). Adding an enum value + its rate is therefore the whole pricing change.
- `material` is **not a DB column** — it lives inside the `roofing_measurements.quote`
  jsonb (per structure, at `quote → structures[n] → inputs → material`). **No SQL migration
  is needed** for new enum values, and existing persisted quotes are unaffected (additive).
- Several `Record<RoofMaterial, …>` maps make the type union **exhaustive**, so TypeScript
  flags every site that must be updated when the enum grows.

## Decision (approved)

**Approach A — extend the flat enum.** Add two values, matching the existing
`colorbond_<profile>` naming. No new dimension, no engine rewrite, no migration.
(Approach B — structured `profile` / `finish` / `gauge` fields — was rejected as
over-engineering at this scope; revisit only if ZINCALUME + .48 BMT + Matt come into scope.)

## Roof types to add

| Enum value (new) | Display label | Dropdown order |
|---|---|---|
| `colorbond_corrugated` | `Colorbond Corrugated` | before Trimdek (cheapest metal) |
| `colorbond_spandek` | `Colorbond Spandek` | between Trimdek and Klip-Lok |

Resulting metal ordering on the measure dropdown (ascending price → reads good→better):
**Corrugated → Trimdek → Spandek → Klip-Lok 700**, then tiles, cement-sheet, unknown.

## Pricing — default rates

Installed `$/m²` defaults, **tenant-editable** in the Roof Rates editor. Anchored on the
two existing installed rates and the supplier's *relative* supply deltas (not invented):

| Roof type | Installed $/m² | Change | Basis |
|---|---|---|---|
| `colorbond_corrugated` | **90** | NEW | Supplier supply ≈ Trimdek ($22.18 vs $22.44/m²); simplest pierce-fix → budget baseline, just under Trimdek. |
| `colorbond_trimdek` | 95 | unchanged | existing anchor |
| `colorbond_spandek` | **105** | NEW | Supplier supply +37% over Trimdek ($30.71 vs $22.44/m²); sits between Trimdek and Klip-Lok. |
| `colorbond_kliplok` | 115 | unchanged | existing anchor; stays `upgrade_material` (Best tier) |
| `concrete_tile` | 95 | unchanged | |
| `terracotta_tile` | 130 | unchanged | |
| `cement_sheet` | 0 | unchanged | never auto-quoted → asbestos inspection |
| `unknown` | 0 | unchanged | routes to inspection |

Supplier reference (per lineal-metre, GST-incl, ÷ effective cover → $/m² supply), for the
record: Corrugated $16.90/762mm = $22.18; Trimdek $17.10/762mm = $22.44; Klip-Lok 700
$18.20/700mm = $26.00; Spandek $21.50/700mm = $30.71. These are **supply-only**; the
engine rates above are **fully-loaded installed** (supply + labour + tear-off + disposal),
which is why they are not the supplier numbers directly.

**Tier behaviour is unchanged.** `upgrade_material` stays `colorbond_kliplok`, so Best
always upsells to Klip-Lok. Picking Corrugated or Spandek as the base sets Better to that
rate; Best still upgrades to Klip-Lok (a genuine upgrade for both). No tier-logic edits.

## Requirements (edit sites — all code)

- **R1 — Enum.** Add `colorbond_corrugated` and `colorbond_spandek` to the `RoofMaterial`
  union (`lib/roofing/types.ts:17`).
- **R2 — Default rates.** Add both keys to `DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2`
  (`lib/roofing/pricing.ts:128`): `colorbond_corrugated: 90`, `colorbond_spandek: 105`.
- **R3 — Scope-line words.** Add both keys to the exhaustive `materialWords:
  Record<RoofMaterial, string>` (`lib/roofing/pricing.ts:234`): `'Colorbond Corrugated'`,
  `'Colorbond Spandek'`. (This also feeds the customer PDF, which renders the baked
  `quote` jsonb scope lines — no separate PDF change needed.)
- **R4 — Request validation.** Add both to the Zod `material` enum in `MeasureInputsSchema`
  (`lib/roofing/request-schema.ts:19`).
- **R5 — Measure dropdown.** Add both to `MATERIALS`
  (`app/dashboard/roofing/measure/page.tsx:44`) in the order above.
- **R6 — Editable rates.** Add both to `EDITABLE_MATERIALS`
  (`lib/roofing/rate-card-overlay.ts:52`) so tenants can override the two new rates via the
  overlay merge. Confirm `RoofRatesEditor.tsx` renders a labelled input for every
  `EDITABLE_MATERIALS` entry (add labels for the two new keys if it uses its own label map).
- **R7 — Customer quote label.** Add both to the `MATERIAL_LABEL` map used at
  `app/q/roof/[token]/page.tsx:164` (`'Colorbond Corrugated'`, `'Colorbond Spandek'`).
- **R8 — SMS material parser.** In `mapMaterial` (`lib/sms/roofing-intake.ts:106`):
  - route `corrugated` / `corro` / `custom orb` → `colorbond_corrugated` (currently they
    fall into the generic-metal branch → `colorbond_trimdek`);
  - add `spandek` / `span deck` → `colorbond_spandek`;
  - keep the generic `colorbond` / `metal` / `tin` / `steel` / `zincalume` branch →
    `colorbond_trimdek` as the default metal.
  SMS is the secondary surface (homeowner free-text); the primary surface is the tradie
  measure dropdown.
- **R9 — Exhaustiveness sweep.** After R1, run `tsc` and resolve every newly-flagged
  `Record<RoofMaterial, …>` / exhaustive `switch` (the type system enumerates the remaining
  sites — fix each rather than casting around it).

## Testing

- **T1** `lib/roofing/pricing.test.ts` — assert `reroof_rate_per_m2` has the two new keys
  with `90` / `105`; assert a Better-tier price computed on Corrugated and on Spandek uses
  those rates; assert ordering `Corrugated < Trimdek < Spandek < Klip-Lok`.
- **T2** `lib/roofing/rate-card-overlay.test.ts` — overlay can set/override the two new
  rates; unset falls back to defaults.
- **T3** `lib/roofing/request-schema.test.ts` — `MeasureInputsSchema` accepts
  `colorbond_corrugated` and `colorbond_spandek`; rejects an unknown material.
- **T4** `lib/sms/roofing-intake.test.ts` — `mapMaterial('corrugated')` →
  `colorbond_corrugated`; `mapMaterial('spandek')` → `colorbond_spandek`;
  `mapMaterial('colorbond')` still → `colorbond_trimdek`.
- **T5** Update any existing fixtures/snapshots that enumerate the full material list
  (e.g. multi-roof / receptionist tests) so they compile and pass.

## Definition of Done

1. `tsc` compiles with no exhaustiveness errors; all roofing tests pass (existing + T1–T5).
2. On the measure page, Corrugated and Spandek appear as options and produce a price using
   their rates (Corrugated $90, Spandek $105 by default), with Good/Better/Best and loadings
   behaving as before.
3. The customer quote page and PDF show the correct human label for a Corrugated/Spandek job.
4. A tenant can edit the Corrugated and Spandek `$/m²` rates in the Roof Rates editor and the
   override flows through `mergeRoofingRateCard`.
5. The SMS roofing flow maps "corrugated" and "spandek" to the new types.
6. No SQL migration was added; existing persisted quotes still render.

## Out of scope (non-goals)

- ZINCALUME finishes, .48 BMT heavy gauge, Matt finish, and the other supplier profiles
  (Mini-Orb, Enseam, Dominion, Multiclad) — deferred; would motivate Approach B.
- COLORBOND **colour** selection (a finish attribute, not a price driver).
- A customer-facing roof-type picker (material stays tradie/satellite-derived; the customer
  quote is display-only for material).
- Fetching live supplier prices at runtime — rates are static, tenant-editable defaults.
- Any change to tier logic, loadings, routing, or measurement.

## Risks / caveats

- **Rates are defaults.** They are tenant-editable and grounded in the supplier matrix +
  existing anchors, not final quoted prices. If the product owner has firmer numbers, change
  R2 values only.
- **Type list sourced from the supplier link, not Jon's PDF.** If the PDF named different or
  additional types, the enum is trivially extended — R1–R8 are the template per new value.
- **Spandek effective cover (700mm) is assumed** from the standard profile spec; the supplier
  page did not expose it in the parsed spec block. It affects only the supply-reference note,
  not the chosen installed rate.
