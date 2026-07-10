# Painting estimator — API review and feature research

> Research pass, 2026-07-10. Sources: 5 code auditors + 12 web-research agents + 59 API candidates each put through an adversarial verifier (26 survived, 31 refuted) + a completeness critic. The Google Solar terms and pricing below were then re-verified by hand against the primary source.

**One-line version:** the highest-value moves need no new API. Fix the trim formula, wire lead/asbestos routing off `year_built`, stop calling Google Solar (we are using it outside its licence), and build a room-schedule UI. The exciting APIs — Nearmap, CoreLogic, Hover, CubiCasa, phone LiDAR — are each either legally out of reach, unaffordable pre-revenue, or require a site visit that destroys the address-only instant-quote wedge.

---

## 1. What we use today, and what we waste

| API | What we extract | Verdict |
|---|---|---|
| Google Geocoding | address → lat/lng, first `OK` result | Keep, but there is **no address validation**. A mistyped address silently geocodes to a street or locality centroid, and the building lookup then returns the wrong building — or 404s — with no signal to the caller. `lib/solar/address-validation.ts` already solves this (gated on `PREMISE`/`SUB_PREMISE`). Small reuse. |
| **Google Solar `buildingInsights`** | `footprint_m2` + `imageryDate` | **Remove from the painting pipeline. Licence violation — see below.** |
| Geoscape | storeys, eave height, zonings, area | Keep, and promote `area` to the primary footprint source (replacing Solar). One stale in-code comment to correct. |
| PropRadar | beds, baths, `floor_area_sqm` (listing, HIGH), `year_built` (sparse) | Keep. `year_built` is fetched and never used — it is the only input the hazard flags need. Listing floor area has a low production hit-rate (on-market and recently-sold only). |
| Google Street View Static | frontage image | Keep. Feeds `MaterialCheck`, but the detection is advisory text only and never reaches the price. |
| Google Gemini | AI "after" preview, material detection | Keep for imagery. Material detection is shown to the tradie, then discarded before pricing. A new use is available: reading printed floor-plan dimensions (§3). |
| Google Photorealistic 3D Tiles | 3D fly-around | Cosmetic. Do **not** measure off it — deriving geometry from Maps Content breaches Maps Platform ToS §3.2.3(c), "No Creating Content From Google Maps Content". |

### The Google Solar problem

**First, a correction to my own earlier assumption.** I suspected the `// Cost: … free up to 10k calls/month` comment in `lib/painting/providers/solar.ts:11` was stale after Google's March 2025 pricing restructure. It is not. Verified against the [Google Maps Platform pricing list](https://developers.google.com/maps/billing-and-pricing/pricing): SKU `1856-4940-856A` (Solar API Building Insights) has a free usage cap of 10,000 calls/month, then $10.00 per 1,000 ($0.01/call), tiering down with volume. Data Layers is the expensive endpoint, and painting never calls it. **Cost is not the problem.**

**The licence is.** Google Maps Platform Service Specific Terms, §20, fetched and quoted verbatim from [cloud.google.com/maps-platform/terms/maps-service-terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) (last modified 10 June 2026):

> **20.1 Permitted Use.** Customer may use the Solar API only (a) to determine the feasibility of installing energy systems for a particular address or geographic area, (b) to design or install an energy system, or (c) for a Downstream Transaction. A "Downstream Transaction" means (i) the design of an energy system requested by a user for a particular address, (ii) the preparation and delivery of a commercial proposal for an energy system that is requested by a user for a particular address, or (iii) the preparation and delivery of marketing materials for an energy system where a user has opted-in to receiving such materials.

> **20.2 Caching.** Customer may temporarily cache the "Building Insights" and "Data Layers" from the Solar API ("Solar Data") for up to 30 consecutive calendar days, after which Customer must delete the cached Solar Data. The deletion obligation does not apply to Solar Data incorporated into fixed media (e.g. energy system design, feasibility study, commercial proposal, marketing materials) for use in a Downstream Transaction.

Every permitted use in §20.1 is scoped to an energy system. A house-painting quote is none of the three. Two consequences, both live today:

1. **`lib/painting/providers/solar.ts` calls `buildingInsights` for a painting estimate.** That is outside §20.1.
2. **We also breach §20.2.** `lib/painting/save-row.ts:102` stores the full `PaintingEstimate` verbatim in `painting_measurements.estimate`, including `facts.footprint_m2` and the capture note `"Footprint from Google Solar satellite imagery (YYYY-MM)"`. Those rows are never expired. The 30-day deletion obligation applies, and the "fixed media" carve-out does not rescue us because it too requires a Downstream Transaction, i.e. an energy system.

**This also kills every "free reuse" idea in the same breath.** `roofSegmentStats` (measured pitch/azimuth/per-segment area), `boundingBox`, `planeHeightAtCenterMeters`, `imageryQuality` all ride in the same response under the same clause. The tempting move — "we already pay for this response, let's use the roof geometry for the facade" — is barred. (It was weak on the merits anyway: `roofSegmentStats` is roof-plane geometry, not facade geometry, and `planeHeightAtCenterMeters` is elevation above sea level, not wall height.)

**Enforcement risk sits on the shared key.** `solar.ts` reads `GOOGLE_MAPS_API_KEY` — the same key behind Geocoding, Street View, 3D Tiles, roofing, and the solar trade. A suspension takes down every Google surface in the app at once.

**Scope note beyond painting:** `lib/roofing/solar-api.ts` calls the same endpoint to get measured roof pitch for *roof-replacement* quotes. That is not an energy system either, and it shares the key. Worth a separate look. `lib/solar/*` is a genuine solar-energy product and is squarely inside §20.1 — it is fine.

**The fix is already 90% wired.** `lib/painting/providers/geoscape-enrich.ts` already calls `extractArea` and writes `footprint_m2`; the merge guard at `lib/painting/enrich.ts:53` only lets it fire when the base (Solar) provider left the field null. Make Geoscape `area` the base footprint source, retire `solar.ts` from the painting pipeline, and the existing guard does the right thing.

Coverage cost is real but not a *legal* loss: Solar was the always-on footprint for any AU address, while Geoscape has strong urban and sparse rural building coverage, so some rural addresses fall through to the `beds × 45` path. Those addresses were never lawfully quotable from Solar data in the first place.

**Stale comment to correct.** `geoscape-enrich.ts` asserts "There is NO total_floor_area … on this API". That is wrong: `total_floor_area` is a documented attribute in [Geoscape Buildings 4.0](https://docs.geoscape.com.au/projects/buildings_guide/en/4.0/). It is a modelled estimate (footprint × levels, urban only), not survey-grade — but the comment denies its existence.

---

## 2. Accuracy: where the estimate is actually wrong

Ranked by expected dollar impact on a real quote, not by how interesting the constant is. All references are `lib/painting/area.ts` unless noted.

| # | Constant / gap | Error | Scope | Fix |
|---|---|---|---|---|
| 1 | **Trim `× 1.6`** (`trimLm`, ~L202-209) | **Systematic 2-3× underestimate**, not a variance band. For a 150 m² house the formula gives ~85 lm. Real skirting runs the perimeter of *every* room (both faces of each partition) plus architraves around ~12 doors and ~10 windows: 230-260 lm. At $12/lm that is roughly **$1,800 ex-GST missed**, far outside the ±12% band. | Default (interior) | Room count → `√n` scaling, or a room schedule. |
| 2 | **MEDIUM confidence auto-quotes** (`pricing.ts`) | Structural, not a constant. `footprint × storeys` yields `confidence: 'medium'` (±25%), and only `low` routes to inspection. A 25% area error on an $8k repaint is a **$2k mis-quote that auto-sends** under Path B. | All | Product decision: should ±25% commit a firm price? |
| 3 | **`WALL_MULTIPLIER` 2.8** (~L43-53) | Collapses the opening deduction *and* the average room size into one scalar. Open-plan homes over-measured ~20-30%; glazing-heavy rooms worse. | Default (interior) | Real opening counts + room count (partition density). |
| 4 | **`beds × 45`** (~L149) | ±40-60%. But it is correctly tagged `low` and routed to inspection, so it does not *mis-price* — it **blocks** an auto-quote that a real floor area would have priced. | Fallback | Room schedule (§3). |
| 5 | **`K_SHAPE` 1.15 perimeter** (~L55) | `k·4·√area` only fits an aspect ratio near 3. A long terrace (r≈5) under-recovers ~14%; a compact square over-recovers ~15%; an L-shape 10-30%. Scales exterior *and* trim. | Exterior + trim | Real footprint polygon perimeter (Geoscape building outline). |
| 6 | **`EAVES_CORRECTION` 0.9** (~L63) | ±6-10%, over-states multi-storey (upper floors are smaller). Compounded when the `areaMeters2` fallback (sloped roof area) over-states footprint by 8-15%. | Fallback | Real floor area. |
| 7 | **`GABLE_FACTOR` 1.1** (~L61) | ±10% of exterior. Hip ≈ 1.0, steep gable ≈ 1.2. | Exterior | A roof-form checkbox. (Solar `roofSegmentStats` is ToS-barred.) |

**The punchline of that ranking:** items 5-7 are ±10-15% refinements on the *opt-in exterior* scope, and they sit *inside* the ±25% MEDIUM band that the engine already treats as commit-worthy (item 2). Tuning them polishes noise that is below the noise floor. Items 1-4 are in the *default interior* scope and move real money.

**And the elephant nobody costed: prep.** Condition is a single whole-house three-value dropdown (`sound 1.0 / minor 1.15 / bare 1.4`) driving 40-60% of a repaint's labour. Those multipliers were never validated against anything. There is no spray-vs-brush lever, though the [Methvin trade constants](https://methvin.org/estimating-production-rates/building-constants/painting-wallpapering/painting) put spray at roughly 2× brush throughput. And per `CLAUDE.md` there is still **no eval framework** — so none of these accuracy fixes are currently falsifiable.

---

## 3. Bedroom size and the room model

**The direct answer: no address-keyed API in Australia returns the size of an individual bedroom.** Not PropRadar, Domain, CoreLogic/Cotality, PropTrack, or Geoscape. Every one of them returns bedroom *count* as an integer and, at best, a whole-dwelling *total* floor area. Per-room square metres exist only on a floor plan, a building plan, or a physical/LiDAR measure of that specific house.

**Why `beds × 45` is the weakest link:** it converts a *count* into a *size*. A three-bedroom dwelling ranges from a ~110 m² unit to a ~200 m² house, and `3 × 45 = 135` either way. That is an irreducible ±40-60%.

**Why the "use ABS averages" instinct is a dead end.** Figures like "master 14-18 m², secondary 9-12 m²" are building-code minimums and population averages. They describe *the average house*, not *this house*. `bedroom_count × average_size` carries exactly the information content of `bedroom_count × constant` — which is what the code already does. Swapping 45 for a better-sourced constant adds **zero accuracy for the specific job.**

**What a room schedule replaces it with:** per-room L × W summed to a floor area at HIGH confidence — feeding the *existing* `manual` path at `area.ts:97-108`, because the engine does not care whether the number came from an API or a keyboard. Plus door/window counts that replace the flat opening percentage baked into `WALL_MULTIPLIER`. Plus per-room condition, which is the real cost driver currently hidden behind one dropdown.

### Ranked ways to get room dimensions

1. **Manual room-schedule UI.** The tradie or customer types room name, L × W, ceiling height, condition, and scopes. **Zero new APIs.** Sums into the existing HIGH-confidence path. **This is the recommendation.**
2. **Gemini reads a listing floor plan's printed dimensions.** AU floor plans almost always print callouts like `BED 1  3.6 × 3.2`. Extract the *printed text*, not the pixel geometry (text extraction is reliable; pixel-geometry inference sits around 60% and is not fit for a money path). About $0.004 per plan, and `GEMINI_API_KEY` is already wired. Only works where a plan exists. Legally: the **customer uploads their own plan**, or use the licensed Domain API `floorplanUrl`. Never scrape realestate.com.au or Domain — REA asserts floor-plan copyright and has litigated it.
3. **CubiCasa / Apple RoomPlan / phone LiDAR / Matterport / Polycam.** All require a site visit or a customer scan, which breaks the address-only instant-quote wedge. RoomPlan additionally has no HTTP API and needs a Pro-tier device. Reject for the instant path.
4. **A statistical model** (`floor_area ~ f(beds, baths, type, storeys, land)`). Adds no accuracy for a specific address, for the same reason the ABS averages don't. Reject.

**Recommendation:** build the manual room schedule. Pre-fill it from the address-derived estimate so the tradie *edits* rather than types from scratch, and optionally auto-fill from a Gemini floor-plan read when a plan is uploaded. Everything past that is a detour.

**And challenge the premise while we are here.** Australian painters do not quote firm prices sight-unseen; the trade norm is a site visit, precisely because condition and per-room geometry are *observations*, not *records*. The crude proxies exist because address-only cannot see what a human on site sees. Sell the address-only path honestly as "instant ballpark, confirm to lock", not as a firm price.

---

## 4. APIs worth adopting

Survivors only. Note that the top three are not really APIs — they are free rules, and a key we already pay for.

| Item | What it gives | Which number it fixes | AU coverage | Cost | Effort | Verdict |
|---|---|---|---|---|---|---|
| **Lead/asbestos rules** over `year_built` | pre-1970 → lead; pre-1990 → asbestos | Routing → inspection (the liability shield) | National (a rule, not an API) | Free | Small | **Adopt now** |
| **Geoscape `area`** (already wired) | `footprint_m2` | Replaces the Solar footprint, ToS-safe | Urban strong, rural sparse | Already paid | Small | **Adopt now** |
| **Dulux spread-rate table** (static constants) | ~16 m²/L topcoat, ~14 m²/L primer → litres → tins | New materials line item | National | Free | Small-med | Adopt |
| **Geoscape `total_floor_area`** | modelled whole-dwelling floor area | Urban addresses with no listing (beats `beds × 45`) | Urban only | Already paid | Small | Adopt (minor) |
| **Heritage overlay** (NSW/VIC/QLD ArcGIS) | point-in-polygon hit | Routing → review on exterior colour change | 3 states, free | Free | Medium | Consider |
| **Domain API** | `floorplanUrl`, off-market bed count | Feeds the Gemini floor-plan reader | National | Self-serve | Medium | Later |
| **Open-Meteo** | 16-day hourly forecast incl. dew point, no key | Exterior scheduling note — **no price change** | National | Free | Small-med | Later |

### Rejected, and why

This list is worth as much as the adopt list.

- **All Solar-derived data** — `roofSegmentStats`, `planeHeightAtCenterMeters`, `boundingBox`, `dataLayers` DSM. Maps ToS §20.1 restricts the Solar API to energy systems. Barred for painting, full stop.
- **Solar `EXPANDED_COVERAGE` / `BASE` quality** — Google's own coverage GeoJSON contains zero mainland-Australia points; its only AU-region polygons are Indonesian islands. It would lift none of our 404s. Also pre-GA and unfit for a money path.
- **CoreLogic / Cotality** — no self-serve pricing, enterprise contract only, and the licence bars third-party display and LLM-pipeline use. Unreachable pre-revenue. The headline "98% coverage" is *record* coverage, not floor-area completeness.
- **Nearmap AI** — enterprise-only. The licence permits derived Output "for internal purposes only" and forces deletion of all AI Attributes within 7 days of termination, which is incompatible with quotes we persist permanently. And storeys is already free from Geoscape.
- **Hover** — requires the customer to shoot 8+ on-site photos and wait hours. Breaks the wedge. US-centric, per-project fees.
- **CubiCasa / RoomPlan / magicplan / Matterport / Polycam** — all require a physical scan. Same wedge-breaker.
- **Restb.ai** — grades US appraisal quality/desirability (UAD C1-C6), not paint-prep condition. Tuned on US siding, with zero documented accuracy on AU weatherboard, fibro, or render.
- **Resene / Dulux / colornerd colour datasets** — licence-restricted (Resene is non-commercial by default; the Dulux GitHub scrape has a null licence plus trademark exposure) **and** they move no number, because `colour_change` is a flat 0.1 boolean. colornerd carries zero AU brands.
- **BOM direct** — the default licence forbids commercial redistribution. Reach BOM data via Open-Meteo if ever needed.
- **NSW Strata Hub** — NSW-only, no per-address REST lookup, and it only changes routing. High cost, no numeric payoff.
- **Measuring off 3D Tiles** — Maps ToS §3.2.3(c), "No Creating Content From Google Maps Content".

---

## 5. Feature roadmap for the painting tab

Features needing no new API are marked **[UI]** and are favoured.

### Now — safety, honesty, and the ToS fix

- **Lead/asbestos hazard banner + inspection route** **[UI + rule]**. Pre-1970 → lead, pre-1990 → asbestos; force the $99 inspection route by reusing the existing `poor`-condition hook in `pricing.ts`. This is a safety gate, not a nicety. Depends on `year_built`, which is sparse — treat an unknown-age house in an old suburb as a soft "confirm on site".
- **Per-surface confidence display** **[UI]**. Surface the ±12/25/40% band and the `floor_area_source` chip that the engine already computes and the UI currently throws away. Near-free trust win.
- **Drop Solar, promote Geoscape footprint.** Closes the licence exposure on the shared Google key.
- **Fix the trim formula.** The `× 1.6` systematic ~$1,800 error.

### Next — the room model and materials (all pure UI + engine)

- **Room schedule UI + per-room wall engine** **[UI]**. The keystone. Replaces `beds × 45` *and* the flat opening percentage in `WALL_MULTIPLIER`. Persists in the existing `inputs` jsonb, so no migration.
- **Materials take-off: litres → tins → $** **[UI + engine]**. From the static Dulux spread rates. **Requires splitting the blended `rate_per_unit` into labour + material first**, or it double-counts paint.
- **Prep line-item picker** **[UI]**. Pressure-wash, scrape/sand, fill, caulk, prime — each with a rate. Itemises what the single condition multiplier hides.
- **Access / scaffold selector** **[UI]**. Replaces the flat `double_storey_loading_pct: 0.5` with ladder/trestle/scaffold options and real hire costs.
- **Customer contact capture** **[UI]**. The dashboard estimate flow collects no name, phone, or email, yet the downstream flow texts the customer.

### Later — new dependencies, gated on demand

- **Gemini floor-plan reader.** A new route reusing `GEMINI_API_KEY`; auto-fills the room schedule from an uploaded plan's printed dimensions.
- **Exterior weather panel.** Open-Meteo; advisory only, on the booking surface, never the price.
- **Substrate-aware exterior pricing.** Gemini detects the substrate, then a *fixed* substrate→multiplier lookup applies, confirm-on-site. Keeps the LLM out of the arithmetic, per the grounding doctrine.
- **Heritage overlay flag.** NSW/VIC/QLD ArcGIS; suppress auto-send on exterior colour change.

---

## 6. Recommended sequence

Ordered by accuracy gain per unit of effort.

1. **Fix the trim formula.** Biggest systematic dollar error, in the default scope. `lib/painting/area.ts` (`trimLm`). *Validate against 2-3 real tradie quotes before trusting it — there is no eval set.*
2. **Lead/asbestos hazard route.** Free rules over the `year_built` we already fetch; reuses the inspection-routing hook. `lib/painting/pricing.ts` (`requiresInspection`). Liability shield — do it early despite being "just routing".
3. **Drop Solar, promote Geoscape footprint.** Closes the §20.1 and §20.2 exposure on the shared key. `lib/painting/enrich.ts`, retire `lib/painting/providers/solar.ts`, correct the `total_floor_area` comment in `geoscape-enrich.ts`. Purge or expire Solar-derived fields already persisted in `painting_measurements.estimate`.
4. **Per-surface confidence display.** Near-free; the engine already computes it. `app/dashboard/painting/_components/PaintResultView.tsx`.
5. **Room schedule UI + per-room engine.** The keystone, and the actual answer to the bedroom-size question. `app/dashboard/painting/page.tsx` (rooms[] state), `lib/painting/area.ts` (new `schedule` source), `lib/painting/types.ts` (Room type). Persists in the existing `inputs` jsonb — no migration.
6. **Gate MEDIUM-confidence auto-send.** Should a ±25% footprint estimate commit a firm price? This is a product and liability call more than a code change.
7. **Materials take-off**, after splitting `rate_per_unit` into labour + material.
8. **Prep picker, access selector, contact capture** — pure UI, as capacity allows.

Steps 1-4 are small and high-value. Step 5 is the large one. Nothing before step 6 needs a new vendor, key, or migration.

---

## 7. Open questions

- **Legal sign-off on Solar §20.1 and §20.2.** The terms read energy-only on their face, and we both call the API and persist its output past 30 days. My call is to drop Solar from painting rather than gamble the shared `GOOGLE_MAPS_API_KEY` on a favourable reading, when Geoscape is already wired as the fallback. But this is a lawyer's yes/no, not an engineer's. **The same question implicates `lib/roofing/solar-api.ts`.**
- **Production hit-rate of the HIGH floor-area path.** Listing floor area only exists for on-market and recently-sold homes; a typical repaint customer is not selling. What fraction of real quotes actually get a HIGH floor area rather than falling to MEDIUM/LOW? Unmeasured — and it determines whether the whole floor-area accuracy programme is worth prioritising at all.
- **The condition multipliers (1.0 / 1.15 / 1.4) are unvalidated.** They drive 40-60% of labour and were never checked against real quotes. No eval framework exists to tune them. Every accuracy claim in this document is currently unfalsifiable.
- **Geoscape `total_floor_area` accuracy on established stock.** It is a model (footprint × levels), urban-only. The repaint market is 1980s-and-older housing. Unverified there.
- **Gemini floor-plan OCR reliability on real AU listing plans.** Needs a spot-check on 10-20 actual plans before it feeds a price, and it must reconcile against the footprint estimate before pricing, per the grounding doctrine.
