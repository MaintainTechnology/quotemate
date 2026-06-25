# Roofing hips/valleys pricing — Spec

## Objective
Roofing quotes show hips and valleys as `0` (or `?`) and never itemise hip/ridge
capping or valley flashing, because the pricing layer never reads
`metrics.hips` / `metrics.valleys`. Fix it so a roof's hips and valleys are
derived into linear metres, surfaced as honest line items on the customer quote,
and displayed consistently with what is actually priced — without double-counting
against the full-re-roof per-m² rate (which already bundles caps and flashings).

This is the bug Jon raised ("hips and valleys come back as zero") and Jeph
confirmed ("they should calculate automatically").

## Context / background
- The roofing pricer is **pure and deterministic** (`lib/roofing/pricing.ts`) —
  no DB, no LLM, no grounding validator. Per-tenant rates come from a
  `RoofingRateCard`; `DEFAULT_ROOFING_RATE_CARD` holds the defaults. This must
  stay pure: any new rates live on the rate card, not fetched from the DB.
- `RoofMetrics` (`lib/roofing/types.ts`) already carries `hips` / `valleys`
  (plural, `number | null` — **counts**, not metres), `footprint_m2` (always
  present on success), `sloped_area_m2`, `form`, and `ridge_lm` (currently always
  `null` from Geoscape — do not depend on it).
- Counts come from `estimateHipsFromForm` / `estimateValleysFromForm`
  (`lib/roofing/providers/geoscape.ts`): gable→(0,0), hip→(4,0),
  skillion→(0,0), gable_hip→(2,1), complex→(null,null), unknown→(null,null).
- The seeded assemblies that price these works already exist
  (`sql/migrations/080_roofing_trade_phase1.sql`, ex-GST):
  - **Repoint ridge and hip caps** — `lm`, **$12.00** (category `repointing`).
  - **Valley flashing replacement** — `lm`, **$45.00** (category `valley_flashing`).
- **The full re-roof per-m² assemblies already include ridge/hip caps and
  flashings** in scope (Trimdek: "all flashings, ridge caps and screws"; tile:
  "Includes ridge/hip caps"). So adding charged cap/flashing lines on top of a
  full-re-roof tier would double-count.
- `calculateRoofingPrice` → `RoofingQuotePrice` (3 tiers). Tier prices are
  consumed by `buildTierObjects` (`lib/roofing/save-as-quote-helpers.ts`), which
  today emits exactly **one** `sqm` line item per tier, then persisted by
  `app/api/roofing/save-as-quote/route.ts` into `quotes.good/better/best` and
  rendered on `/q/[token]`.
- Roofing is forced-confirm: every quote is `tradie_review` (or inspection) and a
  tradie signs off before the customer sees it — the liability backstop.
- Decisions taken in the spec interview: derive metres **from roof geometry**;
  when geometry is thin, **fixed-average fallback length per edge** (always price,
  no inspection routing triggered solely by hips/valleys); scope = **pricing
  layer + consistent display**; leave Geoscape roof-form classification as-is
  (recorded as a non-goal / follow-up).

## Requirements
1. **Derive per-edge length from geometry (pure).** Add a pure helper in
   `pricing.ts` that converts a hip/valley **count** into **linear metres** using
   the roof's geometry:
   - Characteristic plan dimension `s = sqrt(footprint_m2)`.
   - Per-edge run ≈ `s / 2`, lifted to true (along-slope) length by a pitch
     factor `1 / cos(θ)`, where θ is the representative pitch angle for the
     declared `PitchBucket` (shallow ≈ 15°, standard ≈ 22.5°, steep ≈ 30°). Use
     `metrics.pitch_degrees` when present, else the bucket angle.
   - Clamp per-edge length to a sane range **[3 m, 20 m]**.
   - `edge_lm = count × perEdgeLengthM`, rounded to 1 dp.
2. **Fixed-average fallback length.** When geometry is insufficient to derive a
   length (`footprint_m2` ≤ 0 or not finite, and no usable `pitch_degrees`), use a
   documented constant `DEFAULT_EDGE_LENGTH_M` (= 6.0 m) per edge so a number is
   always produced. The count is still required (see R3).
3. **Null counts are not fabricated.** When `hips` / `valleys` is `null`
   (form `unknown` / `complex`), price **no** edge works for that kind and surface
   it as absent — do not invent a count. (`complex` already routes to inspection;
   `unknown` keeps the main sqm quote but no edge works.) Improving the count for
   unknown forms is the form-classification follow-up (non-goal).
4. **Edge rates on the rate card.** Add to `RoofingRateCard` +
   `DEFAULT_ROOFING_RATE_CARD`, tenant-overridable:
   - `ridge_hip_repoint_rate_per_lm` (default **12.00**),
   - `valley_flashing_rate_per_lm` (default **45.00**),
   - `price_edge_works` (default **true**) — master switch to disable edge
     itemisation without code changes.
   Mirror the seeded migration-080 values; do not invent new prices.
5. **Per-tier line items, double-count-safe.** `calculateRoofingPrice` attaches a
   `line_items` array to each `RoofingPriceTier`:
   - Every tier keeps its base `sqm` labour line (as today).
   - Add a **hip/ridge-capping** line (when `hips` derives a positive `lm`) and a
     **valley-flashing** line (when `valleys` derives a positive `lm`), each with
     `unit: 'lm'`, the derived `quantity`, a `description`, and
     `unit_price_ex_gst` from the rate card.
   - **Charged (additive to the tier total) on repair-scoped tiers**: the `good`
     tier for every intent (it is patch/repair scope — its own text already says
     "ridge cap rebed"), and **all** tiers when the intent is a repair intent
     (`patch_repair`, `flashing_repair`, `ridge_cap`, `leak_trace`).
   - **Included (zero-charge) on full-re-roof `better`/`best` tiers**: emit the
     hip/valley lines with `total_ex_gst: 0` and a description noting they are
     "included in the re-roof scope" — so the quantities are visible across
     Good/Better/Best, but the tier total is unchanged (no double-count).
   - For every tier, the sum of `line_items[].total_ex_gst` MUST equal the tier's
     `ex_gst`.
6. **Tier totals reflect charged edge works.** Where edge works are charged
   (R5), the tier `ex_gst` / `inc_gst` include them (inc-GST via the existing GST
   factor). The full-re-roof `better`/`best` totals are unchanged.
7. **Expose effective edge figures for display.** Add an `edge_works` summary to
   `RoofingQuotePrice` (e.g. `{ hips_count, valleys_count, hips_lm, valleys_lm,
   per_edge_length_m, length_source: 'geometry' | 'fallback' }`) so display
   surfaces show the same hips/valleys figures that pricing used — never "0 shown
   but charged".
8. **`buildTierObjects` renders the line items.** Update
   `save-as-quote-helpers.ts` so each tier object's `line_items` is taken from the
   tier's `line_items` when present; fall back to the single `sqm` line for
   callers/tiers without it (back-compat). Keep the existing line-item object
   shape (`unit`, `quantity`, `description`, `unit_price_ex_gst`, `total_ex_gst`,
   `source`); edge lines use `source: 'material'` (valley iron / cap pointing are
   material-led) and labour stays `source: 'labour'`.
9. **Persistence round-trip.** Extend the `price.tiers[]` schema in
   `app/api/roofing/save-as-quote/route.ts` with an optional `line_items` array so
   the derived lines survive the request parse and reach `quotes.good/better/best`.
   Do not change the intake/measurement persistence otherwise.
10. **Multi-structure parity.** `priceMultiRoof` already calls
    `calculateRoofingPrice` per structure, so each structure inherits the line
    items and `edge_works` summary. The combined/aggregated tiers keep summing
    per-tier `ex_gst` / `inc_gst` exactly as today (no behaviour change required
    beyond what R5–R6 produce per structure).
11. **Tests.** Update and extend the vitest suites:
    - `lib/roofing/pricing.test.ts`: isolate the existing "good = better × 0.20"
      and exact-total assertions to a **gable** roof (no hips/valleys) so they
      stay green; add tests for the geometry derivation, the fallback, null-count
      handling, charged-vs-included tier behaviour, and the
      sum(line_items)=tier.ex_gst invariant.
    - `lib/roofing/save-as-quote-helpers.test.ts`: assert multiple line items
      render from `tier.line_items` and that back-compat single-line still works.

## Non-goals
- **Geoscape roof-form classification is not changed.** `normaliseGeoscapeRoofForm`
  and the `estimate*FromForm` count mappings stay as-is; improving counts for
  `unknown`/`complex` forms is a separate follow-up. (Recorded so no one builds it
  here.)
- No new DB migration — the assemblies are already seeded (080); rates are
  mirrored as rate-card defaults.
- No change to the per-m² re-roof base rates or to GST/loadings logic.
- No LLM / tool-calling on the roofing money path; it stays deterministic.
- No new UI page; only the existing quote line-item rendering and any existing
  hips/valleys display read the new `edge_works` figures.
- No auto-send: roofing stays forced-confirm.

## Constraints
- `pricing.ts` and `save-as-quote-helpers.ts` stay **pure** (no I/O).
- Money stored ex-GST, displayed inc-GST; new `unit_price_ex_gst` follow this.
- Field names exact: `hips`, `valleys` (plural), `footprint_m2`, `pitch_degrees`.
- Next 16 / `quotemate-automation/AGENTS.md`: the change is in `lib/roofing/*`
  (pure TS) + one `zod` schema in an existing route; no new route/page code.
- Keep `calculateRoofingPrice` total-preserving for full-re-roof Better/Best so
  existing pinned price tests and live quote values don't shift.

## Edge cases to handle
- Gable roof (hips 0, valleys 0) → no edge lines; tiers identical to today.
- Hip roof (hips 4, valleys 0) full re-roof → Good tier charged hip repointing;
  Better/Best show hip line at $0 "included"; no valley line.
- Gable-hip (hips 2, valleys 1) full re-roof → Good charged both; Better/Best
  both at $0 "included".
- Repair intent (e.g. `patch_repair`) hip roof → hip/valley lines charged on all
  three tiers.
- `unknown` form (counts null) with valid footprint + declared pitch → main sqm
  quote proceeds; no edge works; `edge_works` reports null counts (honest).
- `complex` form / `sloped_area_m2` null / unknown pitch → already inspection-
  routed; customer sees inspection CTA, not the indicative edge numbers.
- `footprint_m2` ≤ 0 with a known count → fallback `DEFAULT_EDGE_LENGTH_M` length.
- Very long per-edge derivation on a huge footprint → clamped at 20 m.
- `price_edge_works: false` on the rate card → no edge lines anywhere; tiers
  identical to today.
- Non-GST tradie → edge inc-GST equals edge ex-GST (GST factor 1.0).

## Definition of done
- [ ] A hip roof (hips 4) full re-roof produces a Good tier whose `line_items`
      include a `lm` hip/ridge-capping line with a positive derived quantity, and
      whose `ex_gst` exceeds the old `better × 0.20` by exactly the edge cost.
- [ ] The same job's Better/Best tiers include the hip line at `total_ex_gst: 0`
      ("included in re-roof scope") and their `ex_gst` is unchanged from today.
- [ ] For every tier in every scenario, `sum(line_items[].total_ex_gst) ===
      tier.ex_gst`.
- [ ] Valley flashing lines appear for forms with valleys (gable_hip), priced at
      the $45/lm rate where charged, derived from geometry.
- [ ] `edge_works` on the price reports the counts and derived metres used, with
      `length_source` indicating geometry vs fallback.
- [ ] `unknown`-form roofs price the main quote with no fabricated edge works and
      report null counts in `edge_works`.
- [ ] `buildTierObjects` renders all of a tier's line items (not just one), and
      the persisted `quotes.good/better/best` carry them through
      `save-as-quote/route.ts`.
- [ ] Gable roofs and `price_edge_works: false` reproduce today's exact tier
      totals and single-line output.
- [ ] `npm run test` (vitest) passes, including updated `pricing.test.ts` and
      `save-as-quote-helpers.test.ts` and new derivation/fallback/invariant tests.
- [ ] `npx tsc --noEmit` (or the project's type-check) is clean.

## Open questions
- **Charged-vs-included split (for Jon/Jeph to confirm post-build):** this spec
  charges hip/valley edge works on repair-scoped tiers only and treats them as
  already-included (shown at $0) on full-re-roof Better/Best, because the seeded
  re-roof assemblies bundle caps and flashings. If the intent is that re-roof
  tiers should instead itemise (and add) caps/flashings on top — i.e. the per-m²
  rate is sheets-only — flip the model to additive on all tiers and reword the
  re-roof scope text. Surfaced because it changes customer-facing dollars.
- **Geometry formula precision:** the `sqrt(footprint)/2 × 1/cos(pitch)` estimate
  is a deliberate average for a roughly-square footprint; a polygon-aware edge
  measurement (from `polygon_geojson`) would be more accurate and could replace it
  later without changing the line-item contract.
