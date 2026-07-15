# Roofing measurement + quote fixes (V1/V2 walkthroughs) — Spec

> Contract for `/build` and `/review`. Three defects Jon raised on the roofing
> tool (28 Greens Rd = V1, 26 Grains Rd = V2), each grounded in code opened for
> this spec. "Output Format" was not supplied in the brief; this follows the
> repo idiom (`specs/roofing-hips-valleys-pricing.md`).

## Objective
Three independent roofing-tool defects, delivered so each has a measurable
acceptance test:

1. **P0** A pitched roof's `sloped_area_m2` can come back **smaller than its
   footprint** (V1: 161 m² sloped vs 208 m² footprint), which is geometrically
   impossible and silently under-prices every tier.
2. **P0** Good/Better/Best **collapse to one identical number in the edit-report
   and get corrupted on save** (V1: customer page ~$15k differentiated, "Edit
   report" shows $14k/$14k/$14k, "Save · re-issue" persists the collapsed value).
3. **P0–P1** Hip/valley counts are **wrong in both directions** and **box gutters
   are never represented** (V1: 4 hips/0 valleys, actual ~9/2 + a box gutter;
   V2: 8 hips/4 valleys, actual 4/1). Roofing is forced tradie-review, so the
   primary fix is a **tradie-confirmable override**; geometry accuracy is a
   secondary mitigation.

Each item is independently shippable; they share no code paths.

## Context / background (grounded)

### Item 1 — sloped area < footprint
- `measuredAreaWithinFootprint(areaM2, footprintM2)` (`lib/roofing/solar-api.ts:149-154`)
  gates whether Google Solar's DSM whole-roof area is accepted. Its lower bound is
  `MIN_SOLAR_AREA_RATIO = 0.33` (`:141`) — so a measured area **below** footprint
  (ratio 0.33–1.0) passes.
- Its only caller is `applySolarInsight()` (`:359-374`, HIGH-imagery branch):
  when the guard passes it writes `enriched.sloped_area_m2 = round1(insight.measuredRoofAreaM2)`
  (`:369`). That value flows into `calculateRoofingPrice` (`area_m2 = sloped_area_m2`),
  so a sub-footprint value under-prices every tier.
- The `else` branch (`:375-380`) derives `slopedAreaFromPitchDegrees(footprint, deg)`
  = `footprint / cos(θ)` — **guaranteed ≥ footprint**. This is the safe fall-through.
- `MIN_SOLAR_AREA_RATIO` is **also** used directly (not via the function) by the
  segment-sum guard at `:505` — that guard legitimately wants a loose lower band,
  so the constant must not change.
- Existing tests: `solar-api.test.ts:282-289` (`(230,200)=true`, `(560,200)=true`,
  `(700,200)=false`, plus 0/NaN cases). All stay valid under a `≥ 1` floor.

### Item 2 — G/B/B collapse + save corruption
- `calculateRoofingPrice`'s `buildTier` (`lib/roofing/pricing.ts:521-579`) already
  emits per-tier `line_items` with `sum(line_items.total_ex_gst) === tier.ex_gst`
  **by construction** (`:577-578`). The three tiers carry genuinely different totals.
- Promotion path: `buildSaveAsQuoteRequest` (`lib/roofing/save-as-quote-helpers.ts:92`)
  passes `narrowed.combined.tiers` (`:141`) as `price.tiers`. `narrowQuoteToStructures`
  (`lib/sms/roofing-compose.ts:258-306`) returns `combined: { area_m2, tiers }` where each
  tier is `{tier,label,ex_gst,inc_gst,scope}` — **`line_items` is dropped**.
- `buildTierObjects` (`save-as-quote-helpers.ts:23-72`): with no `line_items`, the
  fallback (`:54-63`) emits a single `sqm` line using `quantity = price.area_m2` and
  `unit_price_ex_gst = price.effective_rate_per_m2` (the **shared full-reroof rate**)
  for **all three tiers**, with `total_ex_gst = t.ex_gst`. So
  `quantity × unit_price === the better/full-reroof number` for every tier.
- The customer page (`/q/[token]` `TradeTiers`) reads `subtotal_ex_gst` → correct ~$15k.
  The edit modal (`app/q/[token]/TradieEditor.tsx:550`) and edit route
  (`app/api/quote/[id]/edit/route.ts:273`) **re-derive** each subtotal as
  `Σ(quantity × unit_price)` → the identical $14k, and the route **persists** that
  back into `good/better/best` on "Save · re-issue".

### Item 3 — hip/valley/box-gutter
- Counts originate at `buildingDetailsToMetrics` (`lib/roofing/providers/geoscape.ts:1001-1026`),
  which seeds `hips: estimateHipsFromForm(form)` / `valleys: estimateValleysFromForm(form)`
  (`:1019-1020`, `:1029-1049`: `hip→4/0`, `gable_hip→2/1`, `unknown/complex→null/null`),
  then calls `fillEdgesFromGeometry` (`:1014`).
- `fillEdgesFromGeometry` (`lib/roofing/geometry-edges.ts:105-116`) **early-returns
  when both counts are non-null** (`:106`) and leaves `complex` null (`:109`). So a
  non-null form constant **pre-empts** the geometry path (V1 under-count on
  articulated hip roofs capped at 4). When null, `polygonCornerCounts` (`:33-84`,
  `MIN_TURN_DEG = 25` at `:25`) counts every convex footprint corner as a hip /
  reflex as a valley — inflated by bay-window/jog noise (V2 over-count).
- Pricing edge-works already exist: `RoofingEdgeWorks` (`lib/roofing/types.ts:321-330`),
  `deriveEdgeWorks` (`pricing.ts:276-291`), `buildTier`'s `pushEdge` (`pricing.ts:546-575`),
  `edgeChargedForTier` (`pricing.ts:295-298`), rate-card `ridge_hip_repoint_rate_per_lm` /
  `valley_flashing_rate_per_lm` (`types.ts:283-289`, defaults `pricing.ts:150-151`).
- **Box gutter has no representation** in `RoofMetrics`/`RoofingEdgeWorks`/`RoofingRateCard`,
  but the **priced assembly already exists** — `sql/migrations/080_roofing_trade_phase1.sql:51`
  (`'Box gutter replacement'`, `lm`, **$60.00**, category `box_gutter`). So the rate-card
  default mirrors a seeded value; **no new DB migration is required** (`pricing_book.overlays`
  is jsonb).
- Tradie override precedent: `onStructureMaterial` (`app/dashboard/roofing/measure/page.tsx:257-283`)
  re-prices the property when a structure's material is changed. The per-structure card renders
  a `"Hips · valleys"` MiniStat (`:896`) and a material `<select>` (`:903-912`); `selectedMetrics`
  is the structure's `RoofMetrics` (`:640`).

## Requirements

### R1 — Sloped area is never below footprint (Item 1)
- **R1.1** In `measuredAreaWithinFootprint` (`solar-api.ts:149-154`), raise the lower
  bound so a measured area **below footprint is rejected**: `ratio >= 1` (keep the
  upper bound `<= MAX_SOLAR_AREA_RATIO`). Do **not** change `MIN_SOLAR_AREA_RATIO`
  (still used at `:505`); introduce the `1` floor locally in the function.
- **R1.2** Effect (no other code change): when Google's measured area < footprint,
  `applySolarInsight` falls through to the `footprint / cos(pitch)` derive branch
  (`:378`), so `sloped_area_m2 ≥ footprint_m2` always, `area_source = 'derived'`,
  and the measured pitch is still used.
- **R1.3** Update the now-stale comments (`:143-148` and `:364-368`) to state the
  physical floor (a pitched area is never below its footprint).

### R2 — Tiers stay differentiated through promotion + edit + save (Item 2)
- **R2.1** Fix `buildTierObjects`' single-line fallback (`save-as-quote-helpers.ts:54-63`)
  so the stored line satisfies, **per tier**, the identity the editor and edit route
  rely on: `quantity × unit_price_ex_gst === total_ex_gst === subtotal_ex_gst`.
  Use each tier's own effective rate (`unit_price_ex_gst = t.ex_gst / area`), set
  `total_ex_gst = subtotal_ex_gst = round(quantity × unit_price, 2)`. Keep the
  `area <= 0` guard (unit `'each'`, quantity `1`, unit_price `t.ex_gst`).
- **R2.2** The three resulting tiers must be **differentiated**, and each
  `subtotal_ex_gst` within **`area_m2 × $0.005`** of the true `t.ex_gst` — the
  unavoidable rounding of a single 2-dp per-m² unit price (~$0.80 on a 160 m²
  roof, sub-$2 on any real roof). Exact preservation would require carrying the
  itemised `line_items` (out of scope, R2.3). The itemised branch at `:44-53`
  stays exact and unchanged.
- **R2.3** The itemised branch (when `line_items` is present) is unchanged — this
  fix only repairs the fabricated fallback. (Carrying real per-tier `line_items`
  through `narrowQuoteToStructures` is a documented alternative but **out of scope**
  here to keep the change minimal.)

### R3 — Tradie-confirmable hip/valley/box-gutter (Item 3, MANDATORY)
- **R3.1** Add a nullable `box_gutter_lm: number | null` to `RoofMetrics`
  (`types.ts`, after `ridge_lm` `:144`) and to `RoofingEdgeWorks` (`types.ts:321-330`).
- **R3.2** Add `box_gutter_rate_per_lm?: number` to `RoofingRateCard` (`types.ts:260-296`)
  and default it to `60.0` in `DEFAULT_ROOFING_RATE_CARD` (`pricing.ts:150-153`),
  mirroring migration 080. `deriveEdgeWorks` passes `box_gutter_lm` through from
  metrics (it is a direct linear-metre input, **not** derived from a count).
- **R3.3** In `buildTier` (`pricing.ts:544-575`), add a box-gutter line via the
  existing `pushEdge` shape when `box_gutter_lm > 0` and `sqmEx > 0`: `unit: 'lm'`,
  `quantity = box_gutter_lm`, `unit_price = box_gutter_rate_per_lm`, `source: 'material'`.
  Box gutter is **charged on every priceable tier** (it is not bundled in the per-m²
  sheet rate — it is a distinct seeded assembly). The tier total already sums
  `line_items`, so the invariant `sum(line_items) === ex_gst` is preserved automatically.
- **R3.4** On the per-structure card (`app/dashboard/roofing/measure/page.tsx`,
  by the `"Hips · valleys"` MiniStat `:896` / material override `:903-912`), add
  editable numeric inputs for **Hips**, **Valleys**, and **Box gutter (lm)**,
  pre-filled from the current metrics/edge figures and labelled as an editable
  estimate. On change, thread the tradie's confirmed values into that structure's
  priced `RoofMetrics` and **re-price the property** via the same re-price path
  `onStructureMaterial` (`:257-283`) already uses, so tiers + edge line items reflect
  the confirmed counts. Persist them with the measurement (the corrected metrics are
  what `save-as-quote` promotes).

### R4 — Geometry count mitigation (Item 3, secondary — reduces how often R3.4 is needed)
- **R4.1** In `buildingDetailsToMetrics` (`geoscape.ts:1014-1026`), stop the form
  constant from pre-empting geometry for **classifiable, non-`complex`** forms: let
  the polygon path run and use `estimateHipsFromForm`/`estimateValleysFromForm` only
  as a **floor** when geometry yields nothing (missing/degenerate polygon). `complex`
  stays inspection-routed with null counts (unchanged).
- **R4.2** In `polygonCornerCounts` (`geometry-edges.ts:33-84`), merge consecutive
  vertices closer than a tunable `MIN_SEGMENT_M` (≈ 2 m — a calibration knob, comment
  it) before counting, so sub-metre jogs / bay windows don't each register as a
  hip/valley. Keep `MIN_TURN_DEG = 25`.
- **R4.3** In `edgesFromGeometry` (`geometry-edges.ts:91-98`), for form `gable_hip`
  exclude the 2 gable-end convex corners from the hip count.

## Non-goals (do not build here)
- **Item 3.4 (Solar roof-plane count/azimuth inference)** — explicitly deferred by
  the brief. Do not implement.
- No new DB migration (box-gutter assembly already seeded; rate is a code default).
- No pricing-model redesign, no unbundling of ridge/valley/strip from the per-m²
  rate, no whirlybird rate (no quantity is captured — separate task).
- No change to the tier LABELS (Patch/Full-roof/Upgraded) — separate task.
- The "roof form / storeys provenance" and "Edit & send flow" items — separate tasks.
- `pricing.ts`, `solar-api.ts` pure-math, and `save-as-quote-helpers.ts` stay **pure
  (no I/O)**. No LLM/tool-calling on the money path.
- Do not carry real per-tier `line_items` through `narrowQuoteToStructures` (bigger
  change; R2.1 fallback fix is sufficient).

## Constraints
- Money stored ex-GST, displayed inc-GST; new `unit_price_ex_gst` follow this.
- Field names exact: `sloped_area_m2`, `footprint_m2`, `hips`, `valleys` (plural),
  `box_gutter_lm`, `ridge_hip_repoint_rate_per_lm`, `box_gutter_rate_per_lm`.
- Next 16 / `AGENTS.md`: read `node_modules/next/dist/docs/` before touching the
  measure page (R3.4). R1/R2/R3.1-3.3/R4 are pure `lib/roofing/*` TS.
- Keep `calculateRoofingPrice` total-preserving for existing gable/hip fixtures that
  don't set `box_gutter_lm` (no `box_gutter_lm` ⇒ no new line, identical totals).

## Edge cases
- Item 1: measured area exactly == footprint (ratio 1.0) → accepted; measured < footprint
  → derived branch, `sloped ≥ footprint`; measured 1.15×/2.8× → still accepted; 3.5× → rejected.
- Item 2: `area <= 0` tier → `'each'`/qty 1 fallback, still differentiated; a tier that
  already carries `line_items` → unchanged (exact).
- Item 3: `box_gutter_lm` null/0 → no box-gutter line, totals unchanged; `box_gutter_lm > 0`
  on a `$0` base tier (cement_sheet/unknown → inspection) → no line (guarded by `sqmEx > 0`).
- Item 3/R4: `complex` form → counts stay null (inspection); rectangular hip footprint →
  geometry yields 4 convex (matches old constant); articulated hip → geometry > 4 (no longer capped).

## Test plan (acceptance criteria encoded as tests)
- **T1 (R1)** `solar-api.test.ts`: add `measuredAreaWithinFootprint(161,208) === false`
  and `(200,200) === true`; existing 282-289 cases stay green. Add an `applySolarInsight`
  HIGH-imagery case where `measuredRoofAreaM2 < footprint` asserting
  `sloped_area_m2 >= footprint_m2` and `area_source === 'derived'`.
- **T2 (R2)** `save-as-quote-helpers.test.ts`: given `price.tiers` with three distinct
  `ex_gst` and no `line_items`, assert the editor-recomputed `quantity × unit_price_ex_gst`
  stays distinct across tiers and equals each tier's `total_ex_gst === subtotal_ex_gst`;
  on non-round data, assert `subtotal_ex_gst` is within `area_m2 × 0.005` of the source
  `ex_gst`; itemised-branch test still passes.
- **T3 (R3.1-3.3)** `pricing.test.ts`: `box_gutter_lm > 0` emits a `lm` box-gutter line
  at $60/lm included in each priceable tier's `ex_gst`, `sum(line_items) === ex_gst`
  holds; `box_gutter_lm` null/0 emits none and totals equal today's.
- **T4 (R4)** `geometry-edges.test.ts`: a footprint with sub-2 m jogs collapses to the
  true corner count (V2 regression guard); `gable_hip` excludes the 2 gable-end convex
  corners. `geoscape.test.ts`: re-verify `hip`/`gable_hip` fixtures under geometry-first
  (update assertions only where the fixture's polygon legitimately changes the count).
- **T5 (R3.4)** browser: on `/dashboard/roofing/measure`, editing Hips/Valleys/Box-gutter
  re-prices the tiers and the promoted quote carries the confirmed values (see Verification).

## Verification & gates
- **Unit/type gate (all items):** confirm actual commands first, then `npm test`
  (vitest) + `npm run check` (`tsc --noEmit`) must pass each iteration.
- **Browser gate (R2 + R3.4 only — UI/authed surfaces):** the edit-report round-trip
  (R2) and the measure-page override (R3.4) live behind **Clerk auth** on `/dashboard/*`.
  `/verify` + `/playwright-cli` require an authenticated session; if headless Clerk auth
  is unavailable in this environment, that gate is blocked and completion cannot be
  self-certified for those two items. **This is the one gap the run must resolve before
  the completion bar can be met** (see the run's open decision).
- **Review gate:** `/review` (spec-by-spec) then `/code-review` (diff) must report no
  blocker/major findings.

## Definition of done
- [ ] R1: `measuredAreaWithinFootprint(161,208)` is false; a sub-footprint HIGH measured
      area yields `sloped_area_m2 ≥ footprint_m2`; comments updated; existing tests green.
- [ ] R2: promoted roofing quote shows three differentiated tiers in the edit-report;
      "Save · re-issue" preserves them (no 14/14/14 collapse); per-tier invariant holds.
- [ ] R3: `box_gutter_lm` priced at $60/lm on priceable tiers with `sum(line_items)===ex_gst`;
      tradie edits to Hips/Valleys/Box-gutter re-price and promote correctly.
- [ ] R4: articulated hip roofs no longer cap at 4; sub-2 m jogs don't inflate counts;
      `gable_hip` gable ends excluded.
- [ ] `npm test` + `npm run check` pass; `/verify` (+ `/playwright-cli` for R2/R3.4)
      confirms behaviour; `/review` + `/code-review` clean of blockers/majors.

## Open questions
- **Box-gutter charging model (R3.3):** spec charges it on every priceable tier
  (distinct assembly, not bundled). Confirm it should not be shown-at-$0 on any tier
  like ridge/valley are on full-reroof. (Changes customer dollars — flagged.)
- **R3.4 re-price wiring:** whether corrected counts flow via a client-side re-price or
  the measure API `perBuilding` override path — resolved at build time against the
  `onStructureMaterial` precedent; may adjust if the API re-derives geometry and would
  overwrite the tradie's edits.
