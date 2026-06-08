# Volumetric Air-Conditioning Recommender — design spec

- **Date:** 2026-06-08
- **Status:** Approved design (awaiting spec review → implementation plan)
- **Author:** brainstormed with Claude (brainstorming + karpathy-guidelines)
- **Location note:** Co-located with the app under `quotemate-automation/docs/` per the repo convention that app docs live in the subdirectory (root `docs/` holds strategy/planning).

## 1. Summary

A new **air-conditioning recommendation tool** that turns a few property questions
(bedrooms, living spaces, ceiling height, location) into a sized, **indicative**
ducted-vs-split recommendation with an inc-GST price *range*, always ending in a
"book a site assessment" call to action.

It is a new self-contained deterministic trade slice (`lib/aircon/`), structurally
a fork of the existing **painting** and **roofing** trades — **not** the Opus
strict-grounding estimator.

### Decisions locked during brainstorming

| Fork | Decision |
|---|---|
| Output posture | **Indicative recommendation → book assessment** (not a firm payable quote) |
| First front door | **Tradie dashboard tool** (a tab like painting/roofing; no public funnel, no SMS/voice slot-filling in v1) |
| Sizing methodology | **Floor-area × climate-zone factor, per room** (Approach A); volume shown as an explainer, not the sizing basis |
| Pricing numbers | **Seed defensible AU defaults**, tune per-tenant later via `pricing_book.overlays` |

## 2. Goals / non-goals

**Goals**
- Given simple inputs, produce a per-room and whole-house cooling/heating load (kW).
- Recommend **both** ducted and multi-split options with indicative price ranges and a "best fit" flag (per Jon's "two systems").
- Be *honest*: every output is a range with a confidence band; weak inputs widen the band and route to a site assessment.
- Pure, fully unit-tested engine (repo norm: every pure module has a `.test.ts`).

**Non-goals (YAGNI for v1)**
- Customer-facing wizard, SMS, or voice front doors.
- Firm payable quotes / Stripe deposits.
- Full heat-load "precision mode" (per-room glazing/orientation/insulation, AS/NZS parity) — designed-for-later, not built.
- Supplier pricing API integration.
- Geoscape / Google auto-fill of floor area (reuse later; v1 = tradie types inputs).
- **REA data dependency** — the team verified 2026-06-03 (`lib/painting/providers/rea.ts`) that REA has no usable property-attribute API and a tradie SaaS can't qualify for the Partner Platform. Do not architect against it.
- Persisting recommendations as quotes (fast-follow, mirrors `app/api/painting/save`).

## 3. Architecture

Mirror the painting slice ([`lib/painting/`](../../../lib/painting/)):

```
lib/aircon/
  types.ts            # PropertyInputs, RoomLoad, AcSizing, AcRecommendation, AcRateCard, AcRoutingDecision
  climate.ts          # postcode/state → climate zone → kW/m² factor   (PURE, static data + lookup)
  sizing.ts           # inputs → per-room kW + total + volume + confidence band   (PURE)  ← analog of area.ts
  recommend.ts        # sizing → ducted vs split + indicative pricing + routing   (PURE)  ← analog of pricing.ts
  request-schema.ts   # zod HTTP validation (mirrors painting/request-schema.ts)
  sizing.test.ts
  recommend.test.ts
  climate.test.ts
app/api/aircon/recommend/route.ts     # HTTP boundary (fork of app/api/painting/estimate/route.ts)
app/dashboard/aircon/page.tsx         # dashboard tab (fork of app/dashboard/painting/page.tsx)
  _components/AcInputForm.tsx
  _components/AcResultCard.tsx
sql/migrations/NNN_aircon_trade_phase1.sql   # fork of 088_painting_trade_phase1.sql
scripts/run-migration-NNN.mjs
```

Pipeline: `inputs → sizing (PURE) → recommend (PURE) → API route → dashboard tab`.
No external API calls in v1.

## 4. Inputs (dashboard form)

| Field | Type | Notes |
|---|---|---|
| address / postcode / state | string | postcode/state → climate zone |
| bedrooms | int | |
| bathrooms | int | typically lightly/not conditioned |
| living_spaces | int | living/dining/kitchen zones |
| floor_area_m2 | number, optional | **raises confidence to high when supplied** |
| ceiling_height | enum `standard`(2.4) / `high`(2.7) / `raked` | raked → site assessment |
| insulation | enum `good` / `average` / `poor` / `unknown` | |
| current_situation | enum `none` / `replacing` / `adding` | |
| budget | number, optional | nudges ducted vs split |

## 5. Sizing engine (`sizing.ts`) — the accuracy core

Per conditioned room:

```
room_kW = room_area_m2 × climate_factor × room_type_factor × ceiling_mult × insulation_mult
```

- **room_area_m2** — from `floor_area_m2` apportioned across rooms when supplied; else AU typical sizes per room type. Weaker input ⇒ wider band (mirrors `resolveFloorArea` in painting).
- **volume** — `floor_area × ceiling_height` is computed and surfaced as Jon's explainer number; kW is floor-area-based, not volume-based.
- Output carries **low/high band + confidence** derived from input quality:
  - `floor_area_m2` supplied → **high** (±12%)
  - room counts + ceiling height only → **medium** (±25%)
  - counts only / missing height → **low** (±40%) → routes to assessment

### Seed constants (calibrate before relying — these are starting values, not gospel)

```
// AU typical room sizes (m²) used only when floor_area_m2 is absent
TYPICAL_ROOM_M2 = { bedroom: 12, living: 25, kitchen: 12, bathroom: 6 }

// climate_factor — kW per m² (living-area basis), grouped from NCC zones
CLIMATE_FACTOR = {
  cool:        0.13,  // Hobart, alpine, NCC 7–8
  temperate:   0.15,  // Sydney, Melbourne, Adelaide, Perth coastal, NCC 5–6
  subtropical: 0.17,  // Brisbane, Coffs, inland warm, NCC 2–4
  tropical:    0.20,  // Cairns, Darwin, NCC 1
}

room_type_factor = { living: 1.0, kitchen: 1.1, bedroom: 0.7, bathroom: 0.6 }
ceiling_mult     = { standard: 1.0, high: 1.1, raked: 1.15 }   // raked also routes to assessment
insulation_mult  = { good: 0.9, average: 1.0, poor: 1.15, unknown: 1.05 }
```

Capacities are reported rounded to the nearest common AU unit size (2.5 / 3.5 / 5.0 / 7.0 / 8.0 kW for splits).

## 6. Recommendation (`recommend.ts`) — ducted vs split

- **conditioned_zones** = `bedrooms + living_spaces` (bathrooms excluded by default; they're rarely individually conditioned).
- **Total connected kW** = Σ room_kW.
- **Ducted system size** = `connected × diversity_factor` (`diversity_factor = 0.8`) — zones don't all peak simultaneously; sizing the central unit to the raw sum oversizes it.
- **Decision heuristic** (preference, not exclusion — both are always shown):
  - Prefer **ducted** when `conditioned_zones ≥ 4` OR `floor_area_m2 ≥ 150` OR (`zones ≥ 3` AND budget ≥ ducted low estimate).
  - Else prefer **multi-split** (or single splits for 1–2 zones).
- Output: for each option — recommended capacity (kW), indicative inc-GST price range, pros/cons text, and a `best_fit: boolean`.

## 7. Pricing (`AcRateCard`) — indicative ranges only

Per-tenant overridable via `pricing_book.overlays` (same mechanism as `DEFAULT_PAINTING_RATE_CARD`).

```
DEFAULT_AC_RATE_CARD = {
  split: {
    // supply + install per indoor head, by nearest kW band
    per_head: { 2.5: 1100, 3.5: 1400, 5.0: 1900, 7.0: 2600, 8.0: 3000 },
    multi_head_discount_pct: 0.08,   // applied when ≥2 heads
  },
  ducted: {
    rate_per_kw: 1100,               // all-in incl. ductwork
    base_ex_gst: 4000,
    per_zone: 350,                   // zone controller/outlet
    min_ex_gst: 8000,
  },
  gst_registered: true,              // ×1.10 for inc-GST display
}
```

Every tier output is an **inc-GST low/high range** scaled by the sizing confidence band — never a single firm number. Seed totals land in Jon's stated bands (split ≈ $3–8k, ducted ≈ $8–15k+).

## 8. Routing & confidence

Every result routes to **"book a site assessment"** (the indicative posture; mirrors `requiresInspection`). Hard assessment triggers:
- No floor area AND counts-only (low confidence)
- `ceiling_height === 'raked'`
- Implied load suggests 3-phase supply (large ducted)
- Budget far below the cheaper option (expectation gap)

## 9. Database & licensing

- **One migration** (fork of [`088_painting_trade_phase1.sql`](../../../sql/migrations/088_painting_trade_phase1.sql)):
  - Add `aircon` to the `trades` registry (`display_name = 'Air Conditioning'`, `is_job_based = true`).
  - Optional forward-looking `shared_assemblies` / `shared_materials` seed (the deterministic engine does not read them; parity with painting).
  - Per-tenant activation follows the migration 055 pattern.
  - Additive + idempotent; applied with `scripts/run-migration-NNN.mjs`.
- **Licensing note:** real AC install requires ARCtick refrigerant handling + electrical licences. The recommender does not install, so this is out of scope for v1; the "book assessment" assumes a licensed installer. Licence gating via `tenant_licences` is a later concern, not a v1 blocker.

## 10. Testing (TDD)

Pure modules are fully unit-tested (repo norm). Key cases:

- **climate.ts:** known postcodes map to expected zones; unknown postcode → safe default + low-confidence flag.
- **sizing.ts:** floor-area path = high confidence narrow band; counts-only path = low confidence wide band; ceiling-height and insulation multipliers move kW the expected direction; volume explainer computed; capacities round to AU unit sizes.
- **recommend.ts:** zone/area/budget thresholds flip ducted↔split as specified; both options always present; diversity factor reduces ducted size vs raw sum; price ranges land in expected bands; routing always returns a "book assessment" decision and fires the hard triggers.

## 11. Effort & surface

~6 new `lib/aircon/` files + 1 API route + 1 dashboard tab + 1 migration. **No new external integrations.** The only genuinely new *content* (vs plumbing) is the climate-factor table and the rate card — data, calibrated over time, not code risk.

## 12. Open items (non-blocking)

- Calibrate `CLIMATE_FACTOR`, room sizes, and `DEFAULT_AC_RATE_CARD` against a handful of real AU jobs after launch.
- Confirm the climate-zone grouping source (NCC zone table by postcode) to ship as static data in `climate.ts`.
- Decide later: customer-facing wizard and/or save-as-quote as the first fast-follows.
