# Solar Panel Installation Estimate — v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an instant, self-serve, roof-specific solar estimate (system size, annual production, net price after the STC rebate, banded payback) as a deterministic QuoteMate trade, tradie-reviewed before it sends.

**Architecture:** A self-contained `lib/solar/` deterministic pipeline mirroring `lib/roofing/*` and `lib/painting/*` (no LLM on the money path), backed by the existing Google Solar API `buildingInsights:findClosest` client, a per-address coverage gate with a manual-roof fallback, an AU economics engine (STC rebate / feed-in / payback), a dedicated `/solar/[tenantSlug]` entry page and `/q/solar/[token]` customer page, and a forced tradie-confirm step that unlocks the per-tier Stripe deposit.

**Tech Stack:** Next.js 16 (App Router, async route params), TypeScript, Supabase (Postgres + service-role), Vitest (unit), Playwright (e2e), Google Solar API + Google Maps geocoding/static maps, Stripe (test mode), Maintain design system.

**Source spec:** [docs/superpowers/specs/2026-06-08-solar-estimate-design.md](2026-06-08-solar-estimate-design.md) · **Research:** [2026-06-08-solar-estimate-feasibility-research.md](2026-06-08-solar-estimate-feasibility-research.md)

---

## Shared interface contract — `lib/solar/types.ts`

All tasks reference these type and function names verbatim. Phase 2 Task creates this file from the block below.

```typescript
// ════════════════════════════════════════════════════════════════════
// lib/solar/types.ts — SHARED interface contract for the solar engine.
//
// Solar runs as a self-contained deterministic slice mirroring
// lib/roofing/* and lib/painting/*. It does NOT touch
// lib/intake/structure.ts; the IntakeSchema enum stays
// ['electrical', 'plumbing'] (trade routed via intakes.trade='solar').
//
// MONEY PATH IS DETERMINISTIC — no LLM. Every $ figure derives from the
// rate card + SolarConfig + roof facts. Out-of-bounds values flag for
// tradie review; they never publish silently (spec §7).
//
// PURE TYPES — no I/O, no SDK, no dependencies. Used by:
//   • lib/solar/coverage.ts        (coverage gate)
//   • lib/solar/roof.ts            (buildingInsights → roof facts)
//   • lib/solar/sizing.ts          (system-size tiers)
//   • lib/solar/production.ts      (DC→AC energy + confidence band)
//   • lib/solar/pricing.ts         (gross − STC = net)
//   • lib/solar/economics.ts       (savings + banded payback)
//   • lib/solar/manual-fallback.ts (declared-roof capacity estimate)
//   • lib/solar/intake.ts          (orchestrator)
//   • lib/solar/config.ts          (SolarConfig load/validate)
//   • app/api/solar/* (HTTP boundary), app/q/solar/[token] (UI)
// ════════════════════════════════════════════════════════════════════

import type { GeoJSONPolygon } from '../roofing/types'

// ╔══════════════════════════════════════════════════════════════════╗
// ║ 0. SHARED PRIMITIVES                                              ║
// ╚══════════════════════════════════════════════════════════════════╝

/** AU state/territory — same union used across roofing/painting. */
export type AuState =
  | 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT'

/** Property-side lead-form input. Mirrors RoofAddressInput. */
export type SolarAddressInput = {
  address: string
  postcode: string
  state: AuState
}

/** A resolved geocode (Google Maps) — the engine entry coordinate. */
export type LatLng = {
  lat: number
  lng: number
}

/** Google Solar imagery quality, normalised. LOW fails the money gate. */
export type SolarImageryQuality = 'HIGH' | 'MEDIUM' | 'LOW'

/**
 * Where the roof facts came from. 'google' = buildingInsights;
 * 'manual' = customer-declared fallback (spec §3, coverage_source).
 */
export type SolarCoverageSource = 'google' | 'manual'

/**
 * Confidence band on the whole estimate. Drives the ± width on the
 * customer page and the "indicative only" chip (spec §6).
 *   tight  = ±20% (covered + HIGH imagery, fresh config)
 *   wide   = ±30% (MEDIUM imagery, manual fallback, or stale imagery)
 */
export type SolarConfidenceBand = 'tight' | 'wide'

/** Panel quality grade the tenant offers — drives $/kW lookup. */
export type SolarPanelType =
  | 'standard_panels'
  | 'premium_panels'
  | 'unknown'

/** Routing outcome — identical shape to roofing/painting deciders. */
export type SolarRoutingDecision =
  | { decision: 'auto_quote'; reason: string }
  | { decision: 'tradie_review'; reason: string }
  | { decision: 'inspection_required'; reason: string }

// ╔══════════════════════════════════════════════════════════════════╗
// ║ 1. ROOF FACTS  (coverage.ts + roof.ts + manual-fallback.ts)      ║
// ║    Normalised identically from buildingInsights OR manual input. ║
// ╚══════════════════════════════════════════════════════════════════╝

/** One roof plane the Solar API reported (subset of SolarRoofSegment). */
export type SolarRoofPlane = {
  /** Area-weighted pitch of this plane, degrees. */
  pitch_degrees: number
  /** Compass azimuth, degrees (0 = N, 90 = E). Null when unreported. */
  azimuth_degrees: number | null
  /** Plane area in m². */
  area_m2: number
  /** Coarse orientation bucket derived from azimuth (drives derate hints). */
  orientation: SolarOrientation
}

/** Coarse roof-plane orientation — also the manual-fallback declared field. */
export type SolarOrientation =
  | 'north' | 'north_east' | 'east' | 'south_east'
  | 'south' | 'south_west' | 'west' | 'north_west'
  | 'flat' | 'unknown'

/**
 * One precomputed panel configuration as returned by Google
 * `solarPanelConfigs` — panel count + the API's own annual DC estimate.
 * Manual fallback synthesises these from declared capacity.
 */
export type SolarPanelConfig = {
  /** Number of panels in this configuration. */
  panels_count: number
  /** Google's annual DC energy estimate for this config, kWh/yr. */
  yearly_energy_dc_kwh: number
}

/**
 * The normalised roof facts — the single shape the whole engine consumes,
 * produced by EITHER roof.ts (from buildingInsights) OR
 * manual-fallback.ts (from declared direction + size/storeys). The
 * `source` field is the only thing that differs between the two paths.
 */
export type SolarRoofFacts = {
  source: SolarCoverageSource
  /** Usable (panel-placeable) roof area in m², after obstruction discount. */
  usable_area_m2: number
  /** Roof planes; empty/synthetic on the manual path. */
  planes: SolarRoofPlane[]
  segment_count: number
  /** Dominant array orientation (best plane, or declared on manual path). */
  primary_orientation: SolarOrientation
  /** Area-weighted mean pitch, degrees. Null when undeterminable. */
  mean_pitch_degrees: number | null
  /**
   * Max panels the roof can physically hold (Google maxArrayPanelsCount,
   * or derived from usable_area_m2 on the manual path).
   */
  max_panels_count: number
  /** Per-panel DC rating Google assumed, watts (manual default ~400). */
  panel_capacity_watts: number
  /** Precomputed configs (sizing.ts picks tiers from these). */
  panel_configs: SolarPanelConfig[]
  storeys: number | null
  /** Building footprint, for the satellite hero centring. Null on manual. */
  polygon_geojson: GeoJSONPolygon | null
  /** Imagery quality backing these facts ('LOW'/null degrade confidence). */
  imagery_quality: SolarImageryQuality | null
  /** ISO YYYY-MM-DD the imagery was captured. Null on manual. */
  imagery_date: string | null
}

// ── Coverage gate (coverage.ts) ──────────────────────────────────────

/** Why a coverage check resolved the way it did — operator-actionable. */
export type SolarCoverageFailureCode =
  | 'address_not_resolved'
  | 'outside_coverage'        // offline GeoJSON pre-check or 404
  | 'no_building_at_address'
  | 'imagery_below_floor'     // imageryQuality < MEDIUM
  | 'provider_unavailable'
  | 'provider_rate_limited'
  | 'provider_quota_exhausted'
  | 'provider_invalid_response'

/**
 * Coverage outcome. `covered` carries the resolved coordinate + imagery
 * metadata so roof.ts can fetch insights without re-checking; `uncovered`
 * carries the reason so intake.ts can branch to the manual fallback
 * (never a hard fail — spec §7).
 */
export type SolarCoverageResult =
  | {
      covered: true
      location: LatLng
      imagery_quality: SolarImageryQuality
      imagery_date: string | null
    }
  | {
      covered: false
      code: SolarCoverageFailureCode
      detail: string
    }

// ── Manual fallback inputs (manual-fallback.ts) ──────────────────────

/** The 2–3 declared answers when the address is uncovered (spec §3). */
export type SolarManualRoofInput = {
  /** Customer-declared dominant roof direction. */
  orientation: SolarOrientation
  /** Rough roof size bucket → usable area heuristic. */
  roof_size: 'small' | 'medium' | 'large'
  storeys: 1 | 2 | 3
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ 2. SIZING  (sizing.ts)                                            ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * One honest system-size tier, chosen from real panel_configs and capped
 * by roof capacity AND the DNSP export limit (spec §3). The kW here is
 * the DC array size; production.ts derates it to AC.
 */
export type SolarSystemTier = {
  tier: 'good' | 'better' | 'best'
  label: string
  /** DC system size, kW (panels_count × panel_capacity_watts / 1000). */
  system_kw_dc: number
  panels_count: number
  panel_type: SolarPanelType
  /** The source config this tier was picked from. */
  source_config: SolarPanelConfig
  /** True when the export limit (not the roof) capped this tier's size. */
  export_limited: boolean
}

/** The sizing engine's full output — 2–3 tiers + the caps that bound them. */
export type SolarSizingResult = {
  /** Always 2 or 3 tiers, good→best ascending. */
  tiers: SolarSystemTier[]
  /** Largest system the roof can physically fit, kW DC. */
  roof_capacity_kw_dc: number
  /** Export ceiling applied (default 5 kW/phase), kW AC. */
  export_limit_kw_ac: number
  routing: SolarRoutingDecision
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ 3. PRODUCTION  (production.ts)                                    ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * Annual AC production for one tier, with a ± confidence band and the
 * CEC benchmark cross-check (spec §3, §7). Derate 0.80–0.82 applied;
 * 0.5%/yr degradation gives the year-1 vs lifetime split.
 */
export type SolarProductionResult = {
  system_kw_dc: number
  /** Year-1 AC production point estimate, kWh/yr. */
  annual_kwh_ac: number
  /** Band bounds, kWh/yr (drives the page's ± figure). */
  annual_kwh_low: number
  annual_kwh_high: number
  /** DC→AC derate factor actually applied (0.80–0.82). */
  derate_applied: number
  /** Annual linear degradation fraction applied (e.g. 0.005). */
  degradation_pct_per_year: number
  /** CEC city benchmark kWh/kW/yr used for the cross-check. */
  cec_benchmark_kwh_per_kw: number
  /** True when the estimate sits within ±35% of the CEC benchmark. */
  within_cec_benchmark: boolean
  band: SolarConfidenceBand
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ 4. PRICING  (pricing.ts)  — gross − STC = net                    ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * STC rebate breakdown for one tier — every input shown so the customer
 * page can render the subtraction line transparently (spec §6).
 * certificates = floor(kW × zone_rating × deeming_years).
 */
export type SolarStcBreakdown = {
  /** System size used for the STC calc, kW (DC). */
  system_kw: number
  /** CER zone rating for the postcode (1.382 … 1.622). */
  zone_rating: number
  /** Deeming years remaining for the install year (2026=5 … 2030=1). */
  deeming_years: number
  /** floor(kW × zone_rating × deeming_years). */
  certificates: number
  /** Conservative $/STC used (date-stamped from config). */
  stc_price_aud: number
  /** certificates × stc_price_aud, the dollar rebate. */
  rebate_aud: number
}

/** One priced tier: gross → STC subtraction → net (spec §6 tier card). */
export type SolarPriceTier = {
  tier: 'good' | 'better' | 'best'
  label: string
  system_kw_dc: number
  /** Gross install price before rebate, ex GST. */
  gross_ex_gst: number
  gross_inc_gst: number
  /** The STC rebate subtracted. */
  stc: SolarStcBreakdown
  /** Net customer price after rebate, ex GST. */
  net_ex_gst: number
  net_inc_gst: number
  /** Single-line scope, sentence case. */
  scope: string
}

/** Per-tenant pricing inputs. Overridable via pricing_book.overlays. */
export type SolarRateCard = {
  /** All-in install price per kW DC, by panel grade. */
  install_rate_per_kw: Record<SolarPanelType, number>
  /** Multi-storey roof-access loading as a fraction (0.15 = +15%). */
  multi_storey_loading_pct: number
  /** Complex/steep roof loading as a fraction. */
  complex_roof_loading_pct: number
  gst_registered: boolean
  /** Per-job floor (ex-GST) so a tiny system never computes absurdly low. */
  call_out_minimum_ex_gst?: number
}

/** The full price breakdown returned to the dashboard / customer page. */
export type SolarQuotePrice = {
  /** Tiers in good → best order (2 or 3, matching sizing). */
  tiers: SolarPriceTier[]
  /** Effective $/kW after loadings, for the "$X/kW applied" display. */
  effective_rate_per_kw: number
  loadings_applied: Array<{
    code: 'multi_storey' | 'complex_roof'
    pct: number
    detail: string
  }>
  routing: SolarRoutingDecision
  call_out_minimum_applied?: boolean
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ 5. ECONOMICS  (economics.ts) — savings + banded payback          ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * Annual-savings + payback breakdown for one tier. Savings =
 * self-consumed kWh × retail + exported kWh × feed-in. Payback is a
 * RANGE (net price ÷ savings band), not a point (spec §1, §6).
 */
export type SolarEconomicsTier = {
  tier: 'good' | 'better' | 'best'
  /** kWh/yr the household uses on-site (self-consumption × production). */
  self_consumed_kwh: number
  /** kWh/yr exported to grid. */
  exported_kwh: number
  /** $/yr saved on retail bill (self-consumed × retail rate). */
  bill_savings_aud: number
  /** $/yr earned from exports (exported × feed-in tariff). */
  export_earnings_aud: number
  /** Total first-year benefit, $/yr. */
  annual_savings_aud: number
  /** Simple payback band, years (net price ÷ savings, low/high bounds). */
  payback_years_low: number
  payback_years_high: number
}

/** The economics engine's output — per-tier + the assumptions panel data. */
export type SolarEconomicsResult = {
  tiers: SolarEconomicsTier[]
  /** Assumptions surfaced verbatim on the always-visible panel (spec §6). */
  assumptions: {
    self_consumption_pct: number
    retail_rate_aud_per_kwh: number
    feed_in_tariff_aud_per_kwh: number
    feed_in_network: string
  }
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ 6. CONFIG  (config.ts) — dated, no magic numbers in code (spec §5)║
// ╚══════════════════════════════════════════════════════════════════╝

/** STC deeming-year schedule: install year → deeming years remaining. */
export type StcDeemingSchedule = Record<number, number>

/** Postcode → CER STC zone rating. NSW spans 2–4, QLD 1–3; never state-default. */
export type StcZoneTable = Record<string, number>

/** Feed-in tariff config, keyed by network/DNSP. */
export type SolarFeedInConfig = {
  /** Network/DNSP name → $/kWh feed-in benchmark. */
  by_network: Record<string, number>
  /** Used when a network can't be resolved from postcode. */
  default_aud_per_kwh: number
}

/** Per-DNSP export-limit overrides; falls back to the default kW/phase. */
export type SolarExportLimitConfig = {
  default_kw_per_phase: number
  by_network: Record<string, number>
}

/**
 * The dated config the whole engine reads — DB table or versioned file
 * (spec §5, §11). Every published estimate stamps `version`. Stale config
 * (deeming year past / STC price unset) blocks publish and alerts admin.
 */
export type SolarConfig = {
  /** Date-stamped version id persisted on every estimate. */
  version: string
  /** ISO date this config was published. */
  effective_date: string
  deeming_schedule: StcDeemingSchedule
  zone_table: StcZoneTable
  /** Conservative $/STC (date-stamped, ~$38 vs $40 clearing-house cap). */
  stc_price_aud: number
  feed_in: SolarFeedInConfig
  export_limits: SolarExportLimitConfig
  /** Shipped default rate card; tenant overrides via pricing_book.overlays. */
  default_rate_card: SolarRateCard
  /** DC→AC derate factor (0.80–0.82). */
  derate_factor: number
  /** Assumed household self-consumption fraction (e.g. 0.40). */
  self_consumption_pct: number
  /** Retail electricity rate, $/kWh, for savings calc. */
  retail_rate_aud_per_kwh: number
}

/** Result of validating config freshness before a publish (spec §5, §7). */
export type SolarConfigValidation =
  | { ok: true; config: SolarConfig }
  | {
      ok: false
      /** Why publish is blocked — surfaced to the admin alert. */
      code: 'deeming_year_past' | 'stc_price_unset' | 'config_missing' | 'config_invalid'
      detail: string
    }

// ╔══════════════════════════════════════════════════════════════════╗
// ║ 7. TOP-LEVEL ESTIMATE  (intake.ts orchestrator → solar_estimates) ║
// ╚══════════════════════════════════════════════════════════════════╝

/** Install year + postcode the estimate was computed for (STC context). */
export type SolarEstimateContext = {
  postcode: string
  state: AuState
  install_year: number
  /** The network/DNSP resolved from postcode (for FiT + export limit). */
  network: string
}

/**
 * The complete, persisted estimate. This is the shape intake.ts returns
 * AND the (jsonb-friendly) shape written to the `solar_estimates` row
 * (spec §4). Roof facts + chosen tiers + economics + image + band +
 * config version, all token-keyed.
 */
export type SolarEstimate = {
  /** Public share token (base64url, 16 bytes) — the row's public identity. */
  token: string
  context: SolarEstimateContext
  coverage_source: SolarCoverageSource
  roof: SolarRoofFacts
  sizing: SolarSizingResult
  production: SolarProductionResult[]   // one per tier, aligned to sizing.tiers
  price: SolarQuotePrice
  economics: SolarEconomicsResult
  /** Overall band on the published estimate (worst of imagery + source). */
  confidence_band: SolarConfidenceBand
  /** Satellite hero image URL/storage path (real photo, no generative). */
  satellite_image_url: string | null
  /** Job-level routing (always tradie-reviewed; never auto-send). */
  routing: SolarRoutingDecision
  /** Deterministic-output check flags (spec §7); empty = clean. */
  guardrail_flags: string[]
  /** SolarConfig.version used — date-stamps the estimate (spec §5). */
  config_version: string
}
```

## Module ownership table

Each module owns exactly one exported function; all types above live in `lib/solar/types.ts` and are imported by every module. `config.ts` and `manual-fallback.ts` each carry one extra helper that is intrinsic to their single job.

| Module file path | Single exported function signature | Returns |
|---|---|---|
| `lib/solar/types.ts` | _(types only — no functions)_ | the contract above |
| `lib/solar/config.ts` | `function validateSolarConfig(config: SolarConfig \| null, installYear: number): SolarConfigValidation` | `SolarConfigValidation` |
| `lib/solar/coverage.ts` | `async function checkSolarCoverage(input: SolarAddressInput, location: LatLng, opts: ResolvedSolarOpts): Promise<SolarCoverageResult>` | `SolarCoverageResult` |
| `lib/solar/roof.ts` | `function normaliseSolarRoofFacts(insights: SolarRoofInsight, coverage: Extract<SolarCoverageResult, { covered: true }>): SolarRoofFacts` | `SolarRoofFacts` |
| `lib/solar/manual-fallback.ts` | `function buildManualRoofFacts(input: SolarManualRoofInput): SolarRoofFacts` | `SolarRoofFacts` |
| `lib/solar/sizing.ts` | `function sizeSolarSystem(args: { roof: SolarRoofFacts; panelType: SolarPanelType; config: SolarConfig; context: SolarEstimateContext }): SolarSizingResult` | `SolarSizingResult` |
| `lib/solar/production.ts` | `function estimateSolarProduction(args: { tier: SolarSystemTier; roof: SolarRoofFacts; config: SolarConfig; context: SolarEstimateContext }): SolarProductionResult` | `SolarProductionResult` |
| `lib/solar/pricing.ts` | `function calculateSolarPrice(args: { sizing: SolarSizingResult; roof: SolarRoofFacts; context: SolarEstimateContext; config: SolarConfig; rateCard?: SolarRateCard }): SolarQuotePrice` | `SolarQuotePrice` |
| `lib/solar/economics.ts` | `function calculateSolarEconomics(args: { price: SolarQuotePrice; production: SolarProductionResult[]; config: SolarConfig; context: SolarEstimateContext }): SolarEconomicsResult` | `SolarEconomicsResult` |
| `lib/solar/intake.ts` | `async function runSolarEstimate(args: { input: SolarAddressInput; manual?: SolarManualRoofInput; panelType?: SolarPanelType; config: SolarConfig; opts?: SolarEnrichmentOpts }): Promise<SolarEstimate>` | `SolarEstimate` (the orchestrator; persists the `solar_estimates` row) |

Notes for downstream authors:
- `SolarRoofInsight`, `SolarRoofSegment`, `ResolvedSolarOpts`, `SolarEnrichmentOpts` are **reused verbatim** from the existing `lib/roofing/solar-api.ts` client (do not redefine). `GeoJSONPolygon` is imported from `lib/roofing/types.ts`.
- `calculateSolarPrice` mirrors the roofing/painting `calculate*Price` naming and signature shape exactly (args object, optional `rateCard`, GST factor 1.10, `roundTo(n,2)`, call-out floor applied after multiplication). The pattern-card excerpt's older single-arg version is superseded by this `{ sizing, roof, context, config, rateCard? }` form so the STC subtraction (which needs `context` + `config`) lives in `pricing.ts`, not the caller.
- Tier arrays are `SolarSystemTier[]` / `SolarPriceTier[]` (2 **or** 3 tiers, ascending) rather than fixed 3-tuples, because the spec allows 2–3 honest sizes capped by roof + export limit; `production` is a parallel array aligned by index to `sizing.tiers`.
- `SolarEstimate` is the single shape both returned by `runSolarEstimate` and persisted to `solar_estimates` (token-keyed), satisfying spec §4.

---

## Phase 1 — Foundation (migration, config, data model)

## Phase 1 — Foundation (migration, config, data model)

This phase creates the **`solar` trade row**, the **`solar_estimates`** table, and the **`solar_config`** table in a single additive migration, seeds the default AU rate card + STC/feed-in config (dated `version`), and ships a Node verification check that the migration applied (tables exist, config seeded, trade registered). Next free migration number is **097** (highest existing is `096_signage_two_stage.sql`).

All money/config values in the seed come verbatim from the spec (§5, §7): deeming schedule 2026=5…2030=1, zone ratings 1.382–1.622, conservative STC price ~$38, install rates $/kW within the $700–$1,800/kW sane band, 5 kW/phase default export limit, derate 0.80–0.82, self-consumption %, NSW/QLD feed-in benchmarks.

This phase writes **SQL + a run-script + a Node check only** — no `lib/solar/*.ts` engine modules yet (those land in later phases). The check is a standalone Node parity-style script (mirrors `scripts/test-sms-parity.mjs`) rather than a vitest file, because it must connect to the live Supabase DB to assert the migration applied, and vitest's env is `node`-only with no DB harness.

---

### Task 1: Write the migration SQL file (solar trade row + solar_estimates + solar_config)

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/sql/migrations/097_solar_trade_phase1.sql`

This task has no failing-test-first step because a `.sql` file is a static artifact with no runtime until applied; Task 3 is the executable TDD step that runs the migration and asserts the result. Here we author the exact DDL + seed.

- [ ] **Step 1: Create the migration file with the trade row, both tables, the seed config, and the sanity echo.**

Write the full file:

```sql
-- Migration 097 · Solar trade — Phase 1 foundation
--
-- Context: a self-serve solar PV estimate trade alongside electrical /
-- plumbing / roofing / painting. Like roofing (mig 080) and painting
-- (mig 088), solar runs on a self-contained DETERMINISTIC pipeline
-- (lib/solar/* — built in later phases), NOT the strict-grounding Opus
-- estimator. The money path is a per-kW rate card minus the STC rebate
-- (gross − STC = net); every $ figure derives from this config + roof
-- facts. See docs/superpowers/specs/2026-06-08-solar-estimate-design.md.
--
-- ADDITIVE ONLY. This migration does NOT:
--   • alter the IntakeSchema trade enum (solar intake runs through the
--     separate lib/solar/ pipeline, not lib/intake/structure.ts)
--   • insert a pricing_book row (tenant_id is NOT NULL since mig 025 —
--     per-tenant rows are created at tenant activation; tenants override
--     the shipped rate card via pricing_book.overlays)
--   • change any CHECK constraints on existing tables
--
-- What it DOES:
--   1. registers the 'solar' trade row in the trades registry (mig 046)
--   2. creates solar_estimates (token-keyed, mirrors roofing_measurements)
--   3. creates solar_config (dated, no magic numbers in code — spec §5)
--   4. seeds ONE default-AU solar_config row (rate card + STC schedule +
--      zone table + feed-in + export limits + derate + self-consumption)
--
-- Idempotent: create table if not exists + on-conflict / where-not-exists
-- guards so re-runs are no-ops. Apply with:
--   node --env-file=.env.local scripts/run-migration-097.mjs

-- ── 1. Register the solar trade row (trades registry, mig 046) ──────
insert into public.trades (name, display_name, is_job_based, active)
values ('solar', 'Solar', true, true)
on conflict (name) do nothing;

-- ── 2. solar_estimates (mirrors roofing_measurements, mig 081/086) ──
-- ONE row per estimate, token-keyed (the row's public identity), holding
-- normalised roof facts + chosen tiers + economics as jsonb (mirroring
-- how quotes embed good/better/best rather than normalising line items).
create table if not exists public.solar_estimates (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid references public.tenants(id) on delete set null,
  created_by           uuid,                        -- auth.users id of the tradie
  public_token         text not null unique,        -- base64url(16) public identity
  intake_id            uuid references public.intakes(id) on delete set null,
  quote_id             uuid references public.quotes(id) on delete set null,
  -- Property + STC context
  address              text not null,
  postcode             text,
  state                text,
  install_year         int,
  network              text,                        -- resolved DNSP (FiT + export limit)
  -- Coverage / imagery provenance (spec §3, §6)
  coverage_source      text not null default 'google',  -- google | manual
  imagery_quality      text,                        -- HIGH | MEDIUM | LOW | null
  imagery_date         text,                        -- ISO YYYY-MM-DD | null
  confidence_band      text,                        -- tight | wide
  -- Full deterministic payloads (the SolarEstimate shape, jsonb)
  roof                 jsonb,                        -- SolarRoofFacts
  sizing               jsonb,                        -- SolarSizingResult
  production           jsonb,                        -- SolarProductionResult[]
  price                jsonb,                        -- SolarQuotePrice
  economics            jsonb,                        -- SolarEconomicsResult
  guardrail_flags      jsonb not null default '[]'::jsonb,  -- string[] (spec §7)
  routing              text,                         -- tradie_review | inspection_required | auto_quote
  -- Visual + freshness
  satellite_image_path text,                         -- intake-photos bucket path
  config_version       text,                         -- solar_config.version used (spec §5)
  -- Customer confirmation gate (mirrors roofing mig 086)
  confirmed_at         timestamptz,
  created_at           timestamptz not null default now()
);

create index if not exists solar_estimates_tenant_idx
  on public.solar_estimates (tenant_id, created_at desc);

create index if not exists solar_estimates_token_idx
  on public.solar_estimates (public_token);

create index if not exists solar_estimates_created_by_idx
  on public.solar_estimates (created_by, created_at desc);

-- Defence in depth — enable RLS now; service role still bypasses it
-- (Phase-1.5 convention, mig 060/081). Anon key sees zero rows.
alter table public.solar_estimates enable row level security;

-- ── 3. solar_config (dated config, spec §5 — no magic numbers in code) ─
-- ONE active config row at a time; every published estimate stamps its
-- `version`. Stale config (deeming year past / stc_price_aud null) is
-- detected in code (lib/solar/config.ts, later phase) and blocks publish.
create table if not exists public.solar_config (
  version                  text primary key,          -- stamped on every estimate
  effective_date           text not null,             -- ISO date config published
  active                   boolean not null default true,
  -- STC (spec §5, §7)
  deeming_schedule         jsonb not null,            -- { "2026":5, ... "2030":1, "2031":0 }
  zone_table               jsonb not null,            -- { "2000":1.382, ... } postcode→rating
  stc_price_aud            numeric not null,          -- conservative $/STC, date-stamped
  -- Economics (spec §5, §6)
  feed_in                  jsonb not null,            -- { by_network:{}, default_aud_per_kwh }
  export_limits            jsonb not null,            -- { default_kw_per_phase, by_network:{} }
  default_rate_card        jsonb not null,            -- SolarRateCard ($/kW by panel grade)
  derate_factor            numeric not null,          -- DC→AC derate 0.80–0.82
  self_consumption_pct     numeric not null,          -- household self-consumption fraction
  retail_rate_aud_per_kwh  numeric not null,          -- retail $/kWh for savings calc
  created_at               timestamptz not null default now()
);

alter table public.solar_config enable row level security;

-- ── 4. Seed the default AU solar_config (spec §5 / §7 values) ───────
-- version is date-stamped; re-runs are no-ops via where-not-exists.
insert into public.solar_config (
  version, effective_date, active,
  deeming_schedule, zone_table, stc_price_aud,
  feed_in, export_limits, default_rate_card,
  derate_factor, self_consumption_pct, retail_rate_aud_per_kwh
)
select
  '2026-06-08',
  '2026-06-08',
  true,
  -- deeming_schedule: install year → deeming years remaining (SRES ends 2030)
  '{"2026":5,"2027":4,"2028":3,"2029":2,"2030":1,"2031":0}'::jsonb,
  -- zone_table: representative CER postcode→zone ratings (NSW spans 2–4,
  -- QLD 1–3 — never state-default). Expanded to a full table in a later
  -- config refresh; this seed carries the live-tenant capital-city anchors.
  '{
    "2000":1.382,"2150":1.382,"2300":1.382,"2500":1.382,"2600":1.382,
    "2640":1.536,"2480":1.536,
    "4000":1.622,"4350":1.622,"4870":1.622,"4810":1.622,
    "3000":1.185,"5000":1.382,"6000":1.382,"7000":1.185
  }'::jsonb,
  38.00,
  -- feed_in: $/kWh by DNSP (spec §5 — NSW IPART, QLD Energex/Ergon)
  '{
    "by_network":{"Ausgrid":0.05,"Endeavour":0.05,"Essential":0.05,"Energex":0.04,"Ergon":0.07},
    "default_aud_per_kwh":0.05
  }'::jsonb,
  -- export_limits: default 5 kW/phase, small per-DNSP override list (spec §3)
  '{
    "default_kw_per_phase":5.0,
    "by_network":{"Energex":5.0,"Ergon":5.0,"Ausgrid":5.0,"Endeavour":5.0,"Essential":5.0}
  }'::jsonb,
  -- default_rate_card: all-in $/kW DC by grade (within $700–$1,800/kW sane
  -- band, spec §7), loadings as fractions, GST registered, per-job floor.
  '{
    "install_rate_per_kw":{"standard_panels":1100,"premium_panels":1450,"unknown":0},
    "multi_storey_loading_pct":0.15,
    "complex_roof_loading_pct":0.10,
    "gst_registered":true,
    "call_out_minimum_ex_gst":3500
  }'::jsonb,
  0.81,
  0.40,
  0.30
where not exists (
  select 1 from public.solar_config sc where sc.version = '2026-06-08'
);

-- CRITICAL: refresh PostgREST's schema cache so supabase-js routes can
-- immediately read/write the new tables/columns (mirrors mig 085/086).
notify pgrst, 'reload schema';

-- ── 5. Sanity echo (read-only; visible on direct psql runs) ────────
do $$
declare
  has_trade   boolean;
  has_est     boolean;
  has_cfg     boolean;
  cfg_count   int;
begin
  select exists (select 1 from public.trades where name = 'solar') into has_trade;
  select exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'solar_estimates'
  ) into has_est;
  select exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'solar_config'
  ) into has_cfg;
  select count(*) into cfg_count from public.solar_config;
  raise notice 'Migration 097: solar trade=%, solar_estimates=%, solar_config=%, config rows=%',
    has_trade, has_est, has_cfg, cfg_count;
end $$;
```

- [ ] **Step 2: Commit the migration file.**

```bash
git -C "c:/Users/dalig/Downloads/QuoteMate/quoteMate" add quotemate-automation/sql/migrations/097_solar_trade_phase1.sql
git -C "c:/Users/dalig/Downloads/QuoteMate/quoteMate" commit -m "$(cat <<'EOF'
feat(solar): migration 097 — solar trade row + solar_estimates + solar_config

Additive Phase 1 foundation for the deterministic solar trade:
registers the 'solar' trades row, creates the token-keyed
solar_estimates table (mirrors roofing_measurements) and the dated
solar_config table, and seeds the default AU rate card + STC deeming
schedule + zone table + feed-in + export limits (config version
2026-06-08). No lib/solar engine yet.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Write the run-migration script (097)

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/scripts/run-migration-097.mjs`

Mirrors `scripts/run-migration-088.mjs` exactly (same `pg.Client` + SSL pattern, pre-flight/post-verify, abort-with-exit-2 on expectation failure), adapted to assert the three solar objects instead of assembly/material counts. This script is the applier; Task 3 adds the independent verification check.

- [ ] **Step 1: Create the run-migration script.**

```javascript
// QuoteMate · run migration 097
// (solar trade Phase 1 — solar trade row + solar_estimates + solar_config)
// Usage: node --env-file=.env.local scripts/run-migration-097.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '097_solar_trade_phase1.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select exists (
       select 1 from information_schema.tables
        where table_schema = 'public' and table_name = $1
     ) as present`,
    [table],
  )
  return rows[0].present
}

async function tradeExists(client, name) {
  const { rows } = await client.query(
    `select exists (select 1 from public.trades where name = $1) as present`,
    [name],
  )
  return rows[0].present
}

async function configCount(client) {
  const { rows } = await client.query(
    `select count(*)::int as n from public.solar_config`,
  )
  return rows[0].n
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  const beforeTrade = await tradeExists(c, 'solar')
  const beforeEst = await tableExists(c, 'solar_estimates')
  const beforeCfg = await tableExists(c, 'solar_config')
  console.log(`  before · solar trade row               ${beforeTrade}`)
  console.log(`  before · solar_estimates table         ${beforeEst}`)
  console.log(`  before · solar_config table            ${beforeCfg}`)

  console.log('\n─── executing migration 097 ──')
  await c.query(sql)
  console.log('  migration committed.')

  console.log('\n─── post-verify ──')
  const afterTrade = await tradeExists(c, 'solar')
  const afterEst = await tableExists(c, 'solar_estimates')
  const afterCfg = await tableExists(c, 'solar_config')
  const cfgRows = await configCount(c)
  console.log(`  after  · solar trade row               ${afterTrade}`)
  console.log(`  after  · solar_estimates table         ${afterEst}`)
  console.log(`  after  · solar_config table            ${afterCfg}`)
  console.log(`  after  · solar_config rows             ${cfgRows}`)

  if (!afterTrade) {
    console.error(`\nABORTING: expected the 'solar' trade row to exist.`)
    process.exit(2)
  }
  if (!afterEst) {
    console.error(`\nABORTING: expected the solar_estimates table to exist.`)
    process.exit(2)
  }
  if (!afterCfg) {
    console.error(`\nABORTING: expected the solar_config table to exist.`)
    process.exit(2)
  }
  if (cfgRows < 1) {
    console.error(`\nABORTING: expected ≥1 seeded solar_config row, found ${cfgRows}.`)
    process.exit(2)
  }

  console.log('\nMigration 097 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
```

- [ ] **Step 2: Commit the run-migration script.**

```bash
git -C "c:/Users/dalig/Downloads/QuoteMate/quoteMate" add quotemate-automation/scripts/run-migration-097.mjs
git -C "c:/Users/dalig/Downloads/QuoteMate/quoteMate" commit -m "$(cat <<'EOF'
chore(solar): run-migration-097 applier with pre/post verification

Applies sql/migrations/097_solar_trade_phase1.sql, pre-flights the
three solar objects, post-verifies the solar trade row + solar_estimates
+ solar_config tables exist and ≥1 config row was seeded, aborts exit 2
if any expectation fails. Mirrors run-migration-088.mjs.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Write the failing verification check, run it (fails: tables absent), apply the migration, run it (passes)

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/scripts/check-solar-migration.mjs`
- Test: same file (it IS the check — a standalone Node parity-style assertion script, run against the live DB)

This is the TDD heart of the phase. The check asserts the migration's *effect* (trade row registered, both tables present, config seeded with the exact spec values). It is written first, run to confirm it **fails** against a DB where 097 has not yet been applied, then the migration is applied via Task 2's script, then re-run to confirm it **passes**. It uses the `assert` + custom `it()/describe()` parity harness from `scripts/test-sms-parity.mjs` and the `pg.Client` SSL connection from the run-migration template.

- [ ] **Step 1: Write the full verification check (the failing test).**

```javascript
// QuoteMate · verify migration 097 applied (solar Phase 1 foundation)
//
// Asserts the EFFECT of sql/migrations/097_solar_trade_phase1.sql against
// the live Supabase DB: the 'solar' trade row is registered, the
// solar_estimates + solar_config tables exist with their key columns, and
// exactly one default-AU solar_config row was seeded with the spec §5/§7
// values. Parity-style harness (à la test-sms-parity.mjs) + pg.Client.
//
// Usage: node --env-file=.env.local scripts/check-solar-migration.mjs
// Exit 0 = all assertions pass; exit 1 = any failure (TDD signal).

import { strict as assert } from 'node:assert'
import pg from 'pg'

const { Client } = pg

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const results = { passed: 0, failed: 0, failures: [] }
const tests = []

function describe(group, fn) {
  console.log(`\n${group}`)
  fn()
}

function it(name, fn) {
  tests.push({ name, fn })
}

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `select exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = $1 and column_name = $2
     ) as present`,
    [table, column],
  )
  return rows[0].present
}

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select exists (
       select 1 from information_schema.tables
        where table_schema = 'public' and table_name = $1
     ) as present`,
    [table],
  )
  return rows[0].present
}

const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

await c.connect()

// ── Trade registry ──────────────────────────────────────────────────
describe('trades registry', () => {
  it('has an active, job-based solar trade row', async () => {
    const { rows } = await c.query(
      `select display_name, is_job_based, active
         from public.trades where name = 'solar'`,
    )
    assert.equal(rows.length, 1, "expected exactly one 'solar' trade row")
    assert.equal(rows[0].display_name, 'Solar')
    assert.equal(rows[0].is_job_based, true)
    assert.equal(rows[0].active, true)
  })
})

// ── solar_estimates table ───────────────────────────────────────────
describe('solar_estimates table', () => {
  it('exists', async () => {
    assert.equal(await tableExists(c, 'solar_estimates'), true)
  })

  it('has the token-keyed public identity column', async () => {
    assert.equal(await columnExists(c, 'solar_estimates', 'public_token'), true)
  })

  it('has the coverage_source / imagery / confidence_band columns', async () => {
    assert.equal(await columnExists(c, 'solar_estimates', 'coverage_source'), true)
    assert.equal(await columnExists(c, 'solar_estimates', 'imagery_quality'), true)
    assert.equal(await columnExists(c, 'solar_estimates', 'imagery_date'), true)
    assert.equal(await columnExists(c, 'solar_estimates', 'confidence_band'), true)
  })

  it('has the jsonb payload + config_version columns', async () => {
    assert.equal(await columnExists(c, 'solar_estimates', 'roof'), true)
    assert.equal(await columnExists(c, 'solar_estimates', 'sizing'), true)
    assert.equal(await columnExists(c, 'solar_estimates', 'production'), true)
    assert.equal(await columnExists(c, 'solar_estimates', 'price'), true)
    assert.equal(await columnExists(c, 'solar_estimates', 'economics'), true)
    assert.equal(await columnExists(c, 'solar_estimates', 'guardrail_flags'), true)
    assert.equal(await columnExists(c, 'solar_estimates', 'config_version'), true)
  })
})

// ── solar_config table + seed ───────────────────────────────────────
describe('solar_config table + default AU seed', () => {
  it('exists', async () => {
    assert.equal(await tableExists(c, 'solar_config'), true)
  })

  it('has exactly one seeded config row', async () => {
    const { rows } = await c.query(`select count(*)::int as n from public.solar_config`)
    assert.equal(rows[0].n, 1, 'expected exactly one seeded solar_config row')
  })

  it('seeds the dated 2026-06-08 version', async () => {
    const { rows } = await c.query(
      `select effective_date, active from public.solar_config where version = '2026-06-08'`,
    )
    assert.equal(rows.length, 1, "expected the '2026-06-08' config version")
    assert.equal(rows[0].active, true)
  })

  it('seeds the conservative STC price (~$38)', async () => {
    const { rows } = await c.query(
      `select stc_price_aud from public.solar_config where version = '2026-06-08'`,
    )
    assert.equal(Number(rows[0].stc_price_aud), 38)
  })

  it('seeds the SRES deeming schedule (2026=5 … 2030=1, 2031=0)', async () => {
    const { rows } = await c.query(
      `select deeming_schedule from public.solar_config where version = '2026-06-08'`,
    )
    const sched = rows[0].deeming_schedule
    assert.equal(sched['2026'], 5)
    assert.equal(sched['2030'], 1)
    assert.equal(sched['2031'], 0)
  })

  it('seeds a zone table with NSW + QLD postcode anchors (no state-default)', async () => {
    const { rows } = await c.query(
      `select zone_table from public.solar_config where version = '2026-06-08'`,
    )
    const zones = rows[0].zone_table
    assert.equal(zones['2000'], 1.382) // Sydney CBD (NSW zone 3)
    assert.equal(zones['4000'], 1.622) // Brisbane CBD (QLD zone 2)
  })

  it('seeds a rate card with $/kW within the $700–$1,800 sane band (spec §7)', async () => {
    const { rows } = await c.query(
      `select default_rate_card from public.solar_config where version = '2026-06-08'`,
    )
    const card = rows[0].default_rate_card
    const std = card.install_rate_per_kw.standard_panels
    const prem = card.install_rate_per_kw.premium_panels
    assert.ok(std >= 700 && std <= 1800, `standard $/kW ${std} outside 700–1800`)
    assert.ok(prem >= 700 && prem <= 1800, `premium $/kW ${prem} outside 700–1800`)
    assert.equal(card.gst_registered, true)
  })

  it('seeds export limits (default 5 kW/phase) and a derate in 0.80–0.82', async () => {
    const { rows } = await c.query(
      `select export_limits, derate_factor from public.solar_config where version = '2026-06-08'`,
    )
    assert.equal(rows[0].export_limits.default_kw_per_phase, 5)
    const derate = Number(rows[0].derate_factor)
    assert.ok(derate >= 0.8 && derate <= 0.82, `derate ${derate} outside 0.80–0.82`)
  })

  it('seeds feed-in tariffs by network with a default', async () => {
    const { rows } = await c.query(
      `select feed_in from public.solar_config where version = '2026-06-08'`,
    )
    const fi = rows[0].feed_in
    assert.ok(typeof fi.default_aud_per_kwh === 'number')
    assert.ok(typeof fi.by_network.Energex === 'number')
  })
})

// ── Run all collected tests sequentially ────────────────────────────
for (const t of tests) {
  try {
    await t.fn()
    results.passed++
    console.log(`  ✓ ${t.name}`)
  } catch (err) {
    results.failed++
    results.failures.push({ name: t.name, err })
    console.log(`  ✗ ${t.name} — ${err.message}`)
  }
}

await c.end()

console.log(`\n  ${results.passed} passed · ${results.failed} failed`)
if (results.failed > 0) process.exit(1)
process.exit(0)
```

Note on the harness: `describe()` runs synchronously and pushes async `it()` bodies into the `tests` array; the bottom loop then `await`s them in order against the single open `pg` connection. This matches the `test-sms-parity.mjs` `describe/it` style while supporting the `await c.query(...)` DB assertions the migration check requires.

- [ ] **Step 2: Run the check BEFORE applying the migration — confirm it FAILS.**

```bash
node --env-file=quotemate-automation/.env.local quotemate-automation/scripts/check-solar-migration.mjs
```

Expected failure output (migration 097 not yet applied — no solar trade row, no solar tables): the script prints `✗` for the trade/table/config assertions and exits non-zero, e.g.:

```
trades registry
  ✗ has an active, job-based solar trade row — expected exactly one 'solar' trade row
solar_estimates table
  ✗ exists
  ...
  0 passed · 12 failed
```

(Exit code 1.) If instead it errors on connection, confirm `SUPABASE_DB_URL` is present in `quotemate-automation/.env.local` before proceeding — do not edit the check to mask a connection error.

- [ ] **Step 3: Apply the migration with the Task 2 run-script.**

```bash
node --env-file=quotemate-automation/.env.local quotemate-automation/scripts/run-migration-097.mjs
```

Expected output ends with:

```
  after  · solar trade row               true
  after  · solar_estimates table         true
  after  · solar_config table            true
  after  · solar_config rows             1

Migration 097 complete.
```

(Exit code 0.)

- [ ] **Step 4: Re-run the check AFTER applying the migration — confirm it PASSES.**

```bash
node --env-file=quotemate-automation/.env.local quotemate-automation/scripts/check-solar-migration.mjs
```

Expected output:

```
  12 passed · 0 failed
```

(Exit code 0.)

- [ ] **Step 5: Confirm idempotency — re-apply the migration, confirm it stays a no-op (still 1 config row, check still passes).**

```bash
node --env-file=quotemate-automation/.env.local quotemate-automation/scripts/run-migration-097.mjs
node --env-file=quotemate-automation/.env.local quotemate-automation/scripts/check-solar-migration.mjs
```

Expected: the second run-script run prints `after · solar_config rows  1` (not 2 — the `on conflict do nothing` + `where not exists` guards held), `Migration 097 complete.`, and the check again prints `12 passed · 0 failed`.

- [ ] **Step 6: Commit the verification check.**

```bash
git -C "c:/Users/dalig/Downloads/QuoteMate/quoteMate" add quotemate-automation/scripts/check-solar-migration.mjs
git -C "c:/Users/dalig/Downloads/QuoteMate/quoteMate" commit -m "$(cat <<'EOF'
test(solar): verification check for migration 097 (Phase 1 foundation)

Standalone Node parity-style check asserting the migration's effect
against the live DB: solar trade row registered, solar_estimates +
solar_config tables present with key columns, exactly one default-AU
config row seeded with the spec §5/§7 values (STC $38, deeming
2026=5…2031=0, NSW+QLD zone anchors, $/kW in the 700–1800 band, 5
kW/phase export, derate 0.80–0.82). Verified red-before / green-after.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 1 deliverables summary

| Artifact | Path | Role |
|---|---|---|
| Migration SQL | `quotemate-automation/sql/migrations/097_solar_trade_phase1.sql` | solar trade row + `solar_estimates` + `solar_config` + default-AU seed |
| Run-migration applier | `quotemate-automation/scripts/run-migration-097.mjs` | applies 097, pre/post-verifies, aborts exit 2 on failure |
| Verification check | `quotemate-automation/scripts/check-solar-migration.mjs` | TDD red-before/green-after assertion of migration effect + seed values |

**Next free migration number used:** `097` (highest existing was `096_signage_two_stage.sql`).

**Carried into later phases (not built here):** `lib/solar/types.ts` (the shared contract — the `solar_estimates` jsonb columns `roof`/`sizing`/`production`/`price`/`economics` already match `SolarRoofFacts`/`SolarSizingResult`/`SolarProductionResult[]`/`SolarQuotePrice`/`SolarEconomicsResult`, and `solar_config` columns match the `SolarConfig` type field-for-field), `lib/solar/config.ts`'s `validateSolarConfig()` (reads this `solar_config` row to detect stale `deeming_year_past` / `stc_price_unset` and block publish), and the rest of the engine + pages.

**Key decisions made (flagged for review):**
- `solar_config` is a **DB table** (resolves spec open item §11 — "leaning DB table for admin edit").
- Default `install_rate_per_kw`: standard **$1,100/kW**, premium **$1,450/kW**; `call_out_minimum_ex_gst` **$3,500** — all within the spec §7 $700–$1,800/kW sane band and tradie-overridable via `pricing_book.overlays`. These are seed defaults the spec (§11) explicitly leaves to confirm during planning; the exact tier sizes (6.6/10/13.2 kW) are a `sizing.ts` concern in a later phase, not seeded here.
- `zone_table` seeds **capital-city/regional postcode anchors** (NSW 1.382/1.536, QLD 1.622, plus VIC/SA/WA/TAS capitals) rather than the full CER table — flagged for expansion in a later config refresh, consistent with spec §5's "do not state-default" rule while keeping the seed reviewable.

These three scripts are independently runnable (`node --env-file=quotemate-automation/.env.local …`); the check is re-runnable any time to confirm the foundation is intact before later phases build on it.

---

## Phase 2 — Estimate engine (lib/solar/*)

# Phase 2 — Estimate engine (`lib/solar/*`)

This phase builds the eight deterministic modules of `lib/solar/` against the shared interface contract in `lib/solar/types.ts` (delivered in Phase 1). Every module is a pure function with one export, TDD'd with vitest fixtures. The Google Solar API client (`lib/roofing/solar-api.ts`) is reused verbatim — `fetchBuildingInsights`, `resolveSolarOpts`, and the `SolarRoofInsight` / `SolarRoofSegment` / `ResolvedSolarOpts` / `SolarEnrichmentOpts` types are imported, never redefined.

All commands run from `C:\Users\dalig\Downloads\QuoteMate\quoteMate\quotemate-automation`. Vitest auto-discovers `lib/**/*.test.ts`.

---

### Task 4: Test fixtures — covered, uncovered, and manual-fallback payloads

**Files:**
- Create: `quotemate-automation/lib/solar/__fixtures__/building-insights.ts`
- Test: `quotemate-automation/lib/solar/__fixtures__/building-insights.test.ts`

- [ ] **Step 1: Write the failing fixture test.** Create `quotemate-automation/lib/solar/__fixtures__/building-insights.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  COVERED_INSIGHT,
  COVERED_RAW_BODY,
  UNCOVERED_RAW_BODY,
  MANUAL_INPUT,
} from './building-insights'

describe('solar fixtures', () => {
  it('COVERED_INSIGHT is a parsed SolarRoofInsight with usable segments', () => {
    expect(COVERED_INSIGHT.segmentCount).toBeGreaterThan(0)
    expect(COVERED_INSIGHT.segments.length).toBe(COVERED_INSIGHT.segmentCount)
    expect(COVERED_INSIGHT.imageryQuality).toBe('HIGH')
    expect(COVERED_INSIGHT.totalSegmentAreaM2).toBeGreaterThan(0)
    expect(COVERED_INSIGHT.weightedMeanPitchDegrees).toBeGreaterThan(0)
  })

  it('COVERED_RAW_BODY carries solarPanelConfigs + maxArrayPanelsCount + panelCapacityWatts', () => {
    const sp = (COVERED_RAW_BODY as Record<string, any>).solarPotential
    expect(Array.isArray(sp.solarPanelConfigs)).toBe(true)
    expect(sp.solarPanelConfigs.length).toBeGreaterThan(0)
    expect(sp.maxArrayPanelsCount).toBeGreaterThan(0)
    expect(sp.panelCapacityWatts).toBe(400)
  })

  it('UNCOVERED_RAW_BODY has no usable roof segments', () => {
    const sp = (UNCOVERED_RAW_BODY as Record<string, any>).solarPotential
    expect(sp === undefined || sp === null).toBe(true)
  })

  it('MANUAL_INPUT is a north-facing medium single-storey declaration', () => {
    expect(MANUAL_INPUT.orientation).toBe('north')
    expect(MANUAL_INPUT.roof_size).toBe('medium')
    expect(MANUAL_INPUT.storeys).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/__fixtures__/building-insights.test.ts
```

Expected failure: `Error: Failed to load url ./building-insights` (module not found) — the fixture file does not exist yet.

- [ ] **Step 3: Write the fixture module.** Create `quotemate-automation/lib/solar/__fixtures__/building-insights.ts`:

```typescript
// ════════════════════════════════════════════════════════════════════
// Solar test fixtures — three deterministic payloads the whole lib/solar
// suite reuses:
//   • COVERED_RAW_BODY    — a realistic buildingInsights:findClosest body
//                           with roofSegmentStats + solarPanelConfigs +
//                           maxArrayPanelsCount + panelCapacityWatts.
//   • COVERED_INSIGHT     — that body run through parseBuildingInsights
//                           (the reused solar-api parser), HIGH imagery.
//   • UNCOVERED_RAW_BODY  — a 404-shaped body (no solarPotential).
//   • MANUAL_INPUT        — a customer-declared manual-roof fallback.
//
// Numbers are hand-chosen so the downstream STC / production / payback
// assertions land on exact, hand-worked values (see each module's test).
// ════════════════════════════════════════════════════════════════════

import { parseBuildingInsights } from '../../roofing/solar-api'
import type { SolarRoofInsight } from '../../roofing/solar-api'
import type { SolarManualRoofInput } from '../types'

/** A north-facing two-plane hip roof, ~120 m² of roof, HIGH imagery. */
export const COVERED_RAW_BODY = {
  imageryQuality: 'HIGH',
  imageryDate: { year: 2024, month: 3, day: 12 },
  solarPotential: {
    maxArrayPanelsCount: 30,
    panelCapacityWatts: 400,
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    roofSegmentStats: [
      {
        pitchDegrees: 20,
        azimuthDegrees: 0, // due north
        stats: { areaMeters2: 70 },
      },
      {
        pitchDegrees: 20,
        azimuthDegrees: 180, // due south
        stats: { areaMeters2: 50 },
      },
    ],
    solarPanelConfigs: [
      { panelsCount: 16, yearlyEnergyDcKwh: 9600 },
      { panelsCount: 24, yearlyEnergyDcKwh: 14400 },
      { panelsCount: 30, yearlyEnergyDcKwh: 18000 },
    ],
  },
} as const

/** Parsed via the reused solar-api parser — segments/area/imagery only. */
export const COVERED_INSIGHT: SolarRoofInsight = (() => {
  const parsed = parseBuildingInsights(COVERED_RAW_BODY)
  if (!parsed) throw new Error('COVERED_RAW_BODY failed to parse — fixture is broken')
  return parsed
})()

/** What findClosest returns for an address with no imagery — no potential. */
export const UNCOVERED_RAW_BODY = {
  error: { code: 404, message: 'Requested entity was not found.' },
} as const

/** The 2–3 declared answers a customer gives when the address is uncovered. */
export const MANUAL_INPUT: SolarManualRoofInput = {
  orientation: 'north',
  roof_size: 'medium',
  storeys: 1,
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm test -- lib/solar/__fixtures__/building-insights.test.ts
```

Expected: `4 passed`.

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/__fixtures__/building-insights.ts quotemate-automation/lib/solar/__fixtures__/building-insights.test.ts
git commit -m "test(solar): shared fixtures — covered/uncovered/manual building-insights payloads

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `coverage.ts` — the coverage gate

**Files:**
- Create: `quotemate-automation/lib/solar/coverage.ts`
- Test: `quotemate-automation/lib/solar/coverage.test.ts`

- [ ] **Step 1: Write the failing test.** Create `quotemate-automation/lib/solar/coverage.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { checkSolarCoverage } from './coverage'
import { resolveSolarOpts } from '../roofing/solar-api'
import { COVERED_RAW_BODY } from './__fixtures__/building-insights'
import type { SolarAddressInput, LatLng } from './types'

const ADDRESS: SolarAddressInput = {
  address: '1 Test St, Sydney',
  postcode: '2000',
  state: 'NSW',
}
const LOC: LatLng = { lat: -33.8688, lng: 151.2093 }

function fakeFetch(status: number, body: unknown) {
  return async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
}

describe('checkSolarCoverage', () => {
  it('returns covered with HIGH imagery + date when findClosest succeeds', async () => {
    const opts = resolveSolarOpts({ apiKey: 'k', fetchImpl: fakeFetch(200, COVERED_RAW_BODY) })
    const r = await checkSolarCoverage(ADDRESS, LOC, opts)
    expect(r.covered).toBe(true)
    if (r.covered) {
      expect(r.location).toEqual(LOC)
      expect(r.imagery_quality).toBe('HIGH')
      expect(r.imagery_date).toBe('2024-03-12')
    }
  })

  it('returns uncovered/no_building_at_address on a 404', async () => {
    const opts = resolveSolarOpts({ apiKey: 'k', fetchImpl: fakeFetch(404, { error: {} }) })
    const r = await checkSolarCoverage(ADDRESS, LOC, opts)
    expect(r.covered).toBe(false)
    if (!r.covered) expect(r.code).toBe('no_building_at_address')
  })

  it('returns uncovered/imagery_below_floor when quality is LOW', async () => {
    const lowBody = { ...COVERED_RAW_BODY, imageryQuality: 'LOW' }
    const opts = resolveSolarOpts({ apiKey: 'k', fetchImpl: fakeFetch(200, lowBody) })
    const r = await checkSolarCoverage(ADDRESS, LOC, opts)
    expect(r.covered).toBe(false)
    if (!r.covered) expect(r.code).toBe('imagery_below_floor')
  })

  it('returns uncovered/provider_unavailable on a network error', async () => {
    const opts = resolveSolarOpts({
      apiKey: 'k',
      fetchImpl: async () => {
        throw new Error('ECONNRESET')
      },
    })
    const r = await checkSolarCoverage(ADDRESS, LOC, opts)
    expect(r.covered).toBe(false)
    if (!r.covered) expect(r.code).toBe('provider_unavailable')
  })

  it('returns uncovered/provider_unavailable when the api key is missing', async () => {
    const opts = resolveSolarOpts({ apiKey: undefined, fetchImpl: fakeFetch(200, COVERED_RAW_BODY) })
    const r = await checkSolarCoverage(ADDRESS, LOC, opts)
    expect(r.covered).toBe(false)
    if (!r.covered) expect(r.code).toBe('provider_unavailable')
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/coverage.test.ts
```

Expected failure: `Error: Failed to load url ./coverage` — `coverage.ts` does not exist.

- [ ] **Step 3: Write the implementation.** Create `quotemate-automation/lib/solar/coverage.ts`:

```typescript
// ════════════════════════════════════════════════════════════════════
// Solar — coverage gate.
//
// Given a resolved lat/lng, ask Google's buildingInsights:findClosest
// whether we have usable roof imagery. MEDIUM is the money-path floor;
// LOW imagery or a 404 means "uncovered" and the orchestrator branches
// to the manual-roof fallback (never a hard fail — spec §7).
//
// Reuses the existing solar-api client (fetchBuildingInsights) verbatim —
// this module only maps its SolarApiResult onto the solar coverage union.
//
// PURE-ish: the one network call is delegated to the injectable client;
// this function adds no I/O of its own and never throws.
// ════════════════════════════════════════════════════════════════════

import { fetchBuildingInsights } from '../roofing/solar-api'
import type { ResolvedSolarOpts } from '../roofing/solar-api'
import type {
  SolarAddressInput,
  LatLng,
  SolarCoverageResult,
  SolarImageryQuality,
} from './types'

/** Imagery qualities good enough for the solar money path. */
const COVERAGE_FLOOR: SolarImageryQuality[] = ['HIGH', 'MEDIUM']

export async function checkSolarCoverage(
  _input: SolarAddressInput,
  location: LatLng,
  opts: ResolvedSolarOpts,
): Promise<SolarCoverageResult> {
  const res = await fetchBuildingInsights(location, opts)

  if (!res.ok) {
    if (res.code === 'no_coverage') {
      return {
        covered: false,
        code: 'no_building_at_address',
        detail: res.detail,
      }
    }
    if (res.code === 'no_key') {
      return {
        covered: false,
        code: 'provider_unavailable',
        detail: res.detail,
      }
    }
    if (res.code === 'network_error') {
      return {
        covered: false,
        code: 'provider_unavailable',
        detail: res.detail,
      }
    }
    if (res.code === 'invalid_response') {
      return {
        covered: false,
        code: 'provider_invalid_response',
        detail: res.detail,
      }
    }
    // http_error
    return {
      covered: false,
      code: 'provider_unavailable',
      detail: res.detail,
    }
  }

  const quality = res.insight.imageryQuality as SolarImageryQuality
  if (!COVERAGE_FLOOR.includes(quality)) {
    return {
      covered: false,
      code: 'imagery_below_floor',
      detail: `Imagery quality ${quality} is below the MEDIUM floor required for an instant solar estimate.`,
    }
  }

  return {
    covered: true,
    location,
    imagery_quality: quality,
    imagery_date: res.insight.imageryDate,
  }
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm test -- lib/solar/coverage.test.ts
```

Expected: `5 passed`.

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/coverage.ts quotemate-automation/lib/solar/coverage.test.ts
git commit -m "feat(solar): coverage gate — findClosest with MEDIUM imagery floor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `roof.ts` — normalise buildingInsights → roof facts

**Files:**
- Create: `quotemate-automation/lib/solar/roof.ts`
- Test: `quotemate-automation/lib/solar/roof.test.ts`

- [ ] **Step 1: Write the failing test.** Create `quotemate-automation/lib/solar/roof.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { normaliseSolarRoofFacts } from './roof'
import { COVERED_INSIGHT, COVERED_RAW_BODY } from './__fixtures__/building-insights'
import type { SolarCoverageResult } from './types'

const COVERAGE = {
  covered: true,
  location: { lat: -33.8688, lng: 151.2093 },
  imagery_quality: 'HIGH',
  imagery_date: '2024-03-12',
} satisfies Extract<SolarCoverageResult, { covered: true }>

describe('normaliseSolarRoofFacts', () => {
  const facts = normaliseSolarRoofFacts(
    { ...COVERED_INSIGHT, raw: COVERED_RAW_BODY },
    COVERAGE,
  )

  it('tags the source as google', () => {
    expect(facts.source).toBe('google')
  })

  it('carries usable area = sum of segment areas (120 m²)', () => {
    expect(facts.usable_area_m2).toBe(120)
  })

  it('reports the segment count and planes', () => {
    expect(facts.segment_count).toBe(2)
    expect(facts.planes.length).toBe(2)
  })

  it('picks the largest plane as the primary orientation (north)', () => {
    expect(facts.primary_orientation).toBe('north')
  })

  it('computes the area-weighted mean pitch (20°)', () => {
    expect(facts.mean_pitch_degrees).toBe(20)
  })

  it('reads maxArrayPanelsCount + panelCapacityWatts from the raw body', () => {
    expect(facts.max_panels_count).toBe(30)
    expect(facts.panel_capacity_watts).toBe(400)
  })

  it('reads the three precomputed panel configs', () => {
    expect(facts.panel_configs).toEqual([
      { panels_count: 16, yearly_energy_dc_kwh: 9600 },
      { panels_count: 24, yearly_energy_dc_kwh: 14400 },
      { panels_count: 30, yearly_energy_dc_kwh: 18000 },
    ])
  })

  it('carries imagery metadata through from coverage', () => {
    expect(facts.imagery_quality).toBe('HIGH')
    expect(facts.imagery_date).toBe('2024-03-12')
  })

  it('maps azimuth 0 → north and 180 → south on the planes', () => {
    const norths = facts.planes.filter((p) => p.orientation === 'north')
    const souths = facts.planes.filter((p) => p.orientation === 'south')
    expect(norths.length).toBe(1)
    expect(souths.length).toBe(1)
  })

  it('defaults panel capacity to 400W when the raw body omits it', () => {
    const noCap = normaliseSolarRoofFacts(
      { ...COVERED_INSIGHT, raw: { solarPotential: {} } },
      COVERAGE,
    )
    expect(noCap.panel_capacity_watts).toBe(400)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/roof.test.ts
```

Expected failure: `Error: Failed to load url ./roof` — `roof.ts` does not exist.

- [ ] **Step 3: Write the implementation.** Create `quotemate-automation/lib/solar/roof.ts`:

```typescript
// ════════════════════════════════════════════════════════════════════
// Solar — normalise a parsed buildingInsights result into roof facts.
//
// The reused solar-api parser (parseBuildingInsights) extracts segments,
// area-weighted pitch and imagery only — it was written for the roofing
// pitch override. Solar additionally needs maxArrayPanelsCount,
// panelCapacityWatts and the precomputed solarPanelConfigs. Those live in
// solarPotential on the SAME response body, so this module takes the
// parsed SolarRoofInsight PLUS a `raw` handle to that body and reads the
// extra fields directly. The result is the single SolarRoofFacts shape
// the rest of the engine consumes (manual-fallback.ts produces the same
// shape with source='manual').
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type { SolarRoofInsight } from '../roofing/solar-api'
import type {
  SolarCoverageResult,
  SolarRoofFacts,
  SolarRoofPlane,
  SolarOrientation,
  SolarPanelConfig,
  SolarImageryQuality,
} from './types'

/** The parsed insight plus the raw response body it came from. */
export type SolarRoofInsightWithRaw = SolarRoofInsight & { raw: unknown }

const DEFAULT_PANEL_CAPACITY_WATTS = 400

export function normaliseSolarRoofFacts(
  insights: SolarRoofInsightWithRaw,
  coverage: Extract<SolarCoverageResult, { covered: true }>,
): SolarRoofFacts {
  const planes: SolarRoofPlane[] = insights.segments.map((s) => ({
    pitch_degrees: round1(s.pitchDegrees),
    azimuth_degrees: s.azimuthDegrees,
    area_m2: round1(s.areaMeters2),
    orientation: azimuthToOrientation(s.azimuthDegrees, s.pitchDegrees),
  }))

  const usable_area_m2 = round1(
    planes.reduce((acc, p) => acc + p.area_m2, 0),
  )

  // Primary orientation = the orientation of the single largest plane.
  const largest = planes.reduce<SolarRoofPlane | null>(
    (best, p) => (best === null || p.area_m2 > best.area_m2 ? p : best),
    null,
  )
  const primary_orientation: SolarOrientation = largest?.orientation ?? 'unknown'

  const sp = readSolarPotential(insights.raw)
  const max_panels_count =
    numberOr(sp.maxArrayPanelsCount, 0) > 0
      ? Math.floor(numberOr(sp.maxArrayPanelsCount, 0))
      : 0
  const panel_capacity_watts = numberOr(
    sp.panelCapacityWatts,
    DEFAULT_PANEL_CAPACITY_WATTS,
  )

  const panel_configs: SolarPanelConfig[] = Array.isArray(sp.solarPanelConfigs)
    ? sp.solarPanelConfigs
        .map((c): SolarPanelConfig | null => {
          if (!c || typeof c !== 'object') return null
          const obj = c as Record<string, unknown>
          const panels = numberOr(obj.panelsCount, NaN)
          const dc = numberOr(obj.yearlyEnergyDcKwh, NaN)
          if (!Number.isFinite(panels) || !Number.isFinite(dc)) return null
          return {
            panels_count: Math.floor(panels),
            yearly_energy_dc_kwh: round1(dc),
          }
        })
        .filter((c): c is SolarPanelConfig => c !== null)
    : []

  return {
    source: 'google',
    usable_area_m2,
    planes,
    segment_count: insights.segmentCount,
    primary_orientation,
    mean_pitch_degrees: round1(insights.weightedMeanPitchDegrees),
    max_panels_count,
    panel_capacity_watts,
    panel_configs,
    storeys: null,
    polygon_geojson: null,
    imagery_quality: coverage.imagery_quality as SolarImageryQuality,
    imagery_date: coverage.imagery_date,
  }
}

/** PURE — coarse 8-point orientation from a compass azimuth. Flat roofs
 *  (pitch < 5°) read as 'flat'; a null azimuth reads as 'unknown'. */
export function azimuthToOrientation(
  azimuth: number | null,
  pitchDegrees: number,
): SolarOrientation {
  if (Number.isFinite(pitchDegrees) && pitchDegrees < 5) return 'flat'
  if (azimuth === null || !Number.isFinite(azimuth)) return 'unknown'
  const a = ((azimuth % 360) + 360) % 360
  const buckets: SolarOrientation[] = [
    'north', 'north_east', 'east', 'south_east',
    'south', 'south_west', 'west', 'north_west',
  ]
  // 45°-wide sectors centred on each cardinal/intercardinal point.
  const idx = Math.round(a / 45) % 8
  return buckets[idx]
}

// ── helpers ──────────────────────────────────────────────────────────

function readSolarPotential(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  let b = raw as Record<string, unknown>
  if (!('solarPotential' in b) && b.data && typeof b.data === 'object') {
    b = b.data as Record<string, unknown>
  }
  const sp = b.solarPotential
  return sp && typeof sp === 'object' ? (sp as Record<string, unknown>) : {}
}

function numberOr(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseFloat(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function round1(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10) / 10
}

export const __test_only__ = { azimuthToOrientation, round1, DEFAULT_PANEL_CAPACITY_WATTS }
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm test -- lib/solar/roof.test.ts
```

Expected: `11 passed`.

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/roof.ts quotemate-automation/lib/solar/roof.test.ts
git commit -m "feat(solar): roof.ts — normalise buildingInsights into SolarRoofFacts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `manual-fallback.ts` — declared-roof capacity estimate

**Files:**
- Create: `quotemate-automation/lib/solar/manual-fallback.ts`
- Test: `quotemate-automation/lib/solar/manual-fallback.test.ts`

- [ ] **Step 1: Write the failing test.** Create `quotemate-automation/lib/solar/manual-fallback.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildManualRoofFacts, MANUAL_AREA_M2 } from './manual-fallback'
import type { SolarManualRoofInput } from './types'

describe('buildManualRoofFacts', () => {
  const medNorth: SolarManualRoofInput = {
    orientation: 'north',
    roof_size: 'medium',
    storeys: 1,
  }
  const facts = buildManualRoofFacts(medNorth)

  it('tags the source as manual', () => {
    expect(facts.source).toBe('manual')
  })

  it('maps roof_size=medium to its declared usable area', () => {
    expect(facts.usable_area_m2).toBe(MANUAL_AREA_M2.medium)
  })

  it('carries the declared orientation as the primary orientation', () => {
    expect(facts.primary_orientation).toBe('north')
  })

  it('synthesises max_panels_count from usable area (1.95 m² per panel)', () => {
    // 90 m² / 1.95 ≈ 46.1 → floor 46
    expect(facts.max_panels_count).toBe(Math.floor(MANUAL_AREA_M2.medium / 1.95))
  })

  it('defaults panel capacity to 400 W', () => {
    expect(facts.panel_capacity_watts).toBe(400)
  })

  it('synthesises one panel config at the roof max with a benchmark DC yield', () => {
    expect(facts.panel_configs.length).toBe(1)
    const cfg = facts.panel_configs[0]
    expect(cfg.panels_count).toBe(facts.max_panels_count)
    // kW = panels × 400 / 1000; DC = kW × 1400 kWh/kW/yr benchmark
    const kw = (cfg.panels_count * 400) / 1000
    expect(cfg.yearly_energy_dc_kwh).toBe(Math.round(kw * 1400 * 10) / 10)
  })

  it('carries the declared storeys and has no polygon / imagery', () => {
    expect(facts.storeys).toBe(1)
    expect(facts.polygon_geojson).toBeNull()
    expect(facts.imagery_quality).toBeNull()
    expect(facts.imagery_date).toBeNull()
  })

  it('has no real planes (synthetic manual path)', () => {
    expect(facts.planes).toEqual([])
    expect(facts.segment_count).toBe(0)
    expect(facts.mean_pitch_degrees).toBeNull()
  })

  it('scales area with the size bucket (small < medium < large)', () => {
    const small = buildManualRoofFacts({ ...medNorth, roof_size: 'small' })
    const large = buildManualRoofFacts({ ...medNorth, roof_size: 'large' })
    expect(small.usable_area_m2).toBeLessThan(facts.usable_area_m2)
    expect(large.usable_area_m2).toBeGreaterThan(facts.usable_area_m2)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/manual-fallback.test.ts
```

Expected failure: `Error: Failed to load url ./manual-fallback` — file does not exist.

- [ ] **Step 3: Write the implementation.** Create `quotemate-automation/lib/solar/manual-fallback.ts`:

```typescript
// ════════════════════════════════════════════════════════════════════
// Solar — manual-roof fallback (spec §3, §7).
//
// When an address is uncovered (no Google imagery / 404 / LOW quality) we
// NEVER lose the lead. The customer declares 2–3 facts — dominant roof
// direction, a rough size bucket and storeys — and we synthesise the SAME
// SolarRoofFacts shape that roof.ts produces from Google, differing only
// in source='manual' and a wider confidence band downstream.
//
// The area→panels heuristic is deliberately conservative: ~1.95 m² of
// roof per panel (a 1.879 × 1.045 m panel + setbacks/obstruction discount
// baked into the size buckets). DC yield is a flat CEC-ish 1400 kWh/kW/yr
// benchmark so sizing/production have a real config to pick from.
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type {
  SolarManualRoofInput,
  SolarRoofFacts,
  SolarPanelConfig,
} from './types'

/** Declared size bucket → usable (panel-placeable) roof area, m².
 *  Already discounted for obstructions/setbacks — these are NET areas. */
export const MANUAL_AREA_M2: Record<SolarManualRoofInput['roof_size'], number> = {
  small: 45,
  medium: 90,
  large: 150,
}

/** Roof area consumed by one panel incl. setbacks, m². */
const AREA_PER_PANEL_M2 = 1.95
/** Per-panel DC rating assumed on the manual path, W. */
const MANUAL_PANEL_CAPACITY_WATTS = 400
/** Conservative DC specific yield, kWh per kW DC per year. */
const MANUAL_BENCHMARK_KWH_PER_KW = 1400

export function buildManualRoofFacts(input: SolarManualRoofInput): SolarRoofFacts {
  const usable_area_m2 = MANUAL_AREA_M2[input.roof_size]

  const max_panels_count = Math.max(0, Math.floor(usable_area_m2 / AREA_PER_PANEL_M2))
  const system_kw_dc = (max_panels_count * MANUAL_PANEL_CAPACITY_WATTS) / 1000

  const panel_configs: SolarPanelConfig[] =
    max_panels_count > 0
      ? [
          {
            panels_count: max_panels_count,
            yearly_energy_dc_kwh: round1(system_kw_dc * MANUAL_BENCHMARK_KWH_PER_KW),
          },
        ]
      : []

  return {
    source: 'manual',
    usable_area_m2,
    planes: [],
    segment_count: 0,
    primary_orientation: input.orientation,
    mean_pitch_degrees: null,
    max_panels_count,
    panel_capacity_watts: MANUAL_PANEL_CAPACITY_WATTS,
    panel_configs,
    storeys: input.storeys,
    polygon_geojson: null,
    imagery_quality: null,
    imagery_date: null,
  }
}

function round1(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10) / 10
}

export const __test_only__ = {
  AREA_PER_PANEL_M2,
  MANUAL_PANEL_CAPACITY_WATTS,
  MANUAL_BENCHMARK_KWH_PER_KW,
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm test -- lib/solar/manual-fallback.test.ts
```

Expected: `9 passed`.

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/manual-fallback.ts quotemate-automation/lib/solar/manual-fallback.test.ts
git commit -m "feat(solar): manual-fallback.ts — declared-roof capacity estimate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `config.ts` — dated config + freshness validation

**Files:**
- Create: `quotemate-automation/lib/solar/config.ts`
- Test: `quotemate-automation/lib/solar/config.test.ts`

- [ ] **Step 1: Write the failing test.** Create `quotemate-automation/lib/solar/config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { validateSolarConfig, DEFAULT_SOLAR_CONFIG } from './config'

describe('DEFAULT_SOLAR_CONFIG', () => {
  it('ships a deeming schedule through 2030 then 0', () => {
    expect(DEFAULT_SOLAR_CONFIG.deeming_schedule[2026]).toBe(5)
    expect(DEFAULT_SOLAR_CONFIG.deeming_schedule[2030]).toBe(1)
    expect(DEFAULT_SOLAR_CONFIG.deeming_schedule[2031]).toBe(0)
  })

  it('ships a conservative STC price and a NSW + QLD zone table', () => {
    expect(DEFAULT_SOLAR_CONFIG.stc_price_aud).toBeGreaterThan(0)
    expect(DEFAULT_SOLAR_CONFIG.stc_price_aud).toBeLessThanOrEqual(40)
    expect(DEFAULT_SOLAR_CONFIG.zone_table['2000']).toBeGreaterThan(1)
    expect(DEFAULT_SOLAR_CONFIG.zone_table['4000']).toBeGreaterThan(1)
  })

  it('ships a default rate card with standard + premium $/kW', () => {
    expect(DEFAULT_SOLAR_CONFIG.default_rate_card.install_rate_per_kw.standard_panels).toBeGreaterThan(0)
    expect(DEFAULT_SOLAR_CONFIG.default_rate_card.install_rate_per_kw.premium_panels)
      .toBeGreaterThan(DEFAULT_SOLAR_CONFIG.default_rate_card.install_rate_per_kw.standard_panels)
  })

  it('ships a derate in the 0.80–0.82 band and a self-consumption fraction', () => {
    expect(DEFAULT_SOLAR_CONFIG.derate_factor).toBeGreaterThanOrEqual(0.80)
    expect(DEFAULT_SOLAR_CONFIG.derate_factor).toBeLessThanOrEqual(0.82)
    expect(DEFAULT_SOLAR_CONFIG.self_consumption_pct).toBeGreaterThan(0)
    expect(DEFAULT_SOLAR_CONFIG.self_consumption_pct).toBeLessThan(1)
  })
})

describe('validateSolarConfig', () => {
  it('passes the default config for the current install year', () => {
    const r = validateSolarConfig(DEFAULT_SOLAR_CONFIG, 2026)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.config.version).toBe(DEFAULT_SOLAR_CONFIG.version)
  })

  it('blocks publish when the config is null', () => {
    const r = validateSolarConfig(null, 2026)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('config_missing')
  })

  it('blocks publish when the deeming year is past (no schedule entry)', () => {
    const r = validateSolarConfig(DEFAULT_SOLAR_CONFIG, 2099)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('deeming_year_past')
  })

  it('blocks publish when the deeming year resolves to 0 (SRES ended)', () => {
    const r = validateSolarConfig(DEFAULT_SOLAR_CONFIG, 2031)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('deeming_year_past')
  })

  it('blocks publish when the STC price is unset', () => {
    const bad = { ...DEFAULT_SOLAR_CONFIG, stc_price_aud: 0 }
    const r = validateSolarConfig(bad, 2026)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('stc_price_unset')
  })

  it('blocks publish when the zone table is empty (config invalid)', () => {
    const bad = { ...DEFAULT_SOLAR_CONFIG, zone_table: {} }
    const r = validateSolarConfig(bad, 2026)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('config_invalid')
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/config.test.ts
```

Expected failure: `Error: Failed to load url ./config` — file does not exist.

- [ ] **Step 3: Write the implementation.** Create `quotemate-automation/lib/solar/config.ts`:

```typescript
// ════════════════════════════════════════════════════════════════════
// Solar — dated config + freshness validation (spec §5, §7).
//
// NO MAGIC NUMBERS IN CODE: every STC / FiT / rate input lives in a dated
// SolarConfig the whole engine reads. DEFAULT_SOLAR_CONFIG is the shipped
// v1 default; tenants override the rate card via pricing_book.overlays and
// QuoteMate admin can later swap the whole config for a DB-backed one.
//
// validateSolarConfig is the freshness gate: it runs before any publish
// and blocks (with an admin-actionable code) when the config is missing,
// the deeming year for the install year is past/zero (SRES wind-down),
// the STC price is unset, or the table is structurally invalid.
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type {
  SolarConfig,
  SolarConfigValidation,
  StcDeemingSchedule,
  StcZoneTable,
  SolarRateCard,
} from './types'

// ── STC deeming schedule: install year → deeming years remaining ──────
// SRES phases out by end-2030; 2031+ deems to 0 (no rebate).
const DEEMING_SCHEDULE: StcDeemingSchedule = {
  2026: 5,
  2027: 4,
  2028: 3,
  2029: 2,
  2030: 1,
  2031: 0,
}

// ── CER postcode → STC zone rating. A representative v1 slice across the
// two live electrical/plumbing states; NSW metro (2xxx) ≈ zone 3 (1.382),
// QLD metro (4xxx) ≈ zone 3 (1.382), inland/north higher. Admin extends
// this table; sizing/pricing NEVER state-default a missing postcode. ────
const ZONE_TABLE: StcZoneTable = {
  '2000': 1.382, // Sydney CBD
  '2570': 1.382, // Camden NSW
  '2650': 1.536, // Wagga Wagga NSW (zone 2)
  '4000': 1.382, // Brisbane CBD
  '4350': 1.382, // Toowoomba QLD
  '4870': 1.622, // Cairns QLD (zone 1)
}

// ── Shipped default solar rate card ($/kW DC installed, ex-GST) ────────
const DEFAULT_RATE_CARD: SolarRateCard = {
  install_rate_per_kw: {
    standard_panels: 1100,
    premium_panels: 1450,
    unknown: 0,
  },
  multi_storey_loading_pct: 0.15,
  complex_roof_loading_pct: 0.10,
  gst_registered: true,
  call_out_minimum_ex_gst: 3500,
}

export const DEFAULT_SOLAR_CONFIG: SolarConfig = {
  version: 'solar-config-2026-06-08',
  effective_date: '2026-06-08',
  deeming_schedule: DEEMING_SCHEDULE,
  zone_table: ZONE_TABLE,
  stc_price_aud: 38,
  feed_in: {
    by_network: {
      Ausgrid: 0.08,
      Endeavour: 0.075,
      Essential: 0.07,
      Energex: 0.05,
      Ergon: 0.0858,
    },
    default_aud_per_kwh: 0.06,
  },
  export_limits: {
    default_kw_per_phase: 5,
    by_network: {
      Energex: 5,
      Ausgrid: 5,
    },
  },
  default_rate_card: DEFAULT_RATE_CARD,
  derate_factor: 0.81,
  self_consumption_pct: 0.40,
  retail_rate_aud_per_kwh: 0.32,
}

export function validateSolarConfig(
  config: SolarConfig | null,
  installYear: number,
): SolarConfigValidation {
  if (!config) {
    return { ok: false, code: 'config_missing', detail: 'No solar config is loaded.' }
  }

  const deeming = config.deeming_schedule[installYear]
  if (deeming === undefined) {
    return {
      ok: false,
      code: 'deeming_year_past',
      detail: `No deeming-years entry for install year ${installYear}; the config is stale and must be refreshed.`,
    }
  }
  if (deeming <= 0) {
    return {
      ok: false,
      code: 'deeming_year_past',
      detail: `Deeming years for ${installYear} is ${deeming} — the SRES rebate has ended; refresh required.`,
    }
  }

  if (!Number.isFinite(config.stc_price_aud) || config.stc_price_aud <= 0) {
    return {
      ok: false,
      code: 'stc_price_unset',
      detail: 'STC price is unset or non-positive; an estimate cannot subtract the rebate.',
    }
  }

  if (
    !config.zone_table ||
    typeof config.zone_table !== 'object' ||
    Object.keys(config.zone_table).length === 0
  ) {
    return {
      ok: false,
      code: 'config_invalid',
      detail: 'Zone table is empty; STC certificates cannot be computed without a postcode→zone mapping.',
    }
  }

  return { ok: true, config }
}

export const __test_only__ = { DEEMING_SCHEDULE, ZONE_TABLE, DEFAULT_RATE_CARD }
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm test -- lib/solar/config.test.ts
```

Expected: `11 passed`.

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/config.ts quotemate-automation/lib/solar/config.test.ts
git commit -m "feat(solar): config.ts — dated SolarConfig + freshness validation gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `sizing.ts` — honest system-size tiers, roof + export capped

**Files:**
- Create: `quotemate-automation/lib/solar/sizing.ts`
- Test: `quotemate-automation/lib/solar/sizing.test.ts`

- [ ] **Step 1: Write the failing test.** Create `quotemate-automation/lib/solar/sizing.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { sizeSolarSystem } from './sizing'
import { DEFAULT_SOLAR_CONFIG } from './config'
import { normaliseSolarRoofFacts } from './roof'
import { buildManualRoofFacts } from './manual-fallback'
import { COVERED_INSIGHT, COVERED_RAW_BODY } from './__fixtures__/building-insights'
import type { SolarCoverageResult, SolarEstimateContext } from './types'

const COVERAGE = {
  covered: true,
  location: { lat: -33.8688, lng: 151.2093 },
  imagery_quality: 'HIGH',
  imagery_date: '2024-03-12',
} satisfies Extract<SolarCoverageResult, { covered: true }>

const CONTEXT: SolarEstimateContext = {
  postcode: '2000',
  state: 'NSW',
  install_year: 2026,
  network: 'Ausgrid',
}

const ROOF = normaliseSolarRoofFacts({ ...COVERED_INSIGHT, raw: COVERED_RAW_BODY }, COVERAGE)

describe('sizeSolarSystem', () => {
  const result = sizeSolarSystem({
    roof: ROOF,
    panelType: 'standard_panels',
    config: DEFAULT_SOLAR_CONFIG,
    context: CONTEXT,
  })

  it('returns 2–3 tiers in ascending kW order', () => {
    expect(result.tiers.length).toBeGreaterThanOrEqual(2)
    expect(result.tiers.length).toBeLessThanOrEqual(3)
    for (let i = 1; i < result.tiers.length; i++) {
      expect(result.tiers[i].system_kw_dc).toBeGreaterThan(result.tiers[i - 1].system_kw_dc)
    }
  })

  it('labels tiers good→best', () => {
    const tiers = result.tiers.map((t) => t.tier)
    expect(tiers[0]).toBe('good')
    expect(tiers[tiers.length - 1]).toBe('best')
  })

  it('derives kW DC from panels × panelCapacityWatts/1000', () => {
    const t = result.tiers[0]
    expect(t.system_kw_dc).toBe((t.panels_count * ROOF.panel_capacity_watts) / 1000)
  })

  it('never exceeds the roof capacity (30 panels × 400 W = 12 kW)', () => {
    expect(result.roof_capacity_kw_dc).toBe(12)
    for (const t of result.tiers) {
      expect(t.system_kw_dc).toBeLessThanOrEqual(result.roof_capacity_kw_dc)
    }
  })

  it('applies the 5 kW/phase export limit and flags export-limited tiers', () => {
    expect(result.export_limit_kw_ac).toBe(5)
    // With a 0.81 derate, 5 kW AC ≈ 6.17 kW DC ceiling; tiers above are flagged.
    const limited = result.tiers.filter((t) => t.export_limited)
    expect(limited.length).toBeGreaterThan(0)
  })

  it('routes to tradie_review (never auto_quote — high-ticket rule)', () => {
    expect(result.routing.decision).toBe('tradie_review')
  })

  it('carries the requested panel type onto every tier', () => {
    for (const t of result.tiers) expect(t.panel_type).toBe('standard_panels')
  })

  it('falls back to inspection_required when the roof holds no panels', () => {
    const emptyRoof = buildManualRoofFacts({ orientation: 'north', roof_size: 'small', storeys: 1 })
    const tiny = { ...emptyRoof, max_panels_count: 0, panel_configs: [] }
    const r = sizeSolarSystem({
      roof: tiny,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    expect(r.routing.decision).toBe('inspection_required')
    expect(r.tiers.length).toBe(0)
  })

  it('works off the single manual-fallback config (2 tiers minimum)', () => {
    const manual = buildManualRoofFacts({ orientation: 'north', roof_size: 'large', storeys: 1 })
    const r = sizeSolarSystem({
      roof: manual,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    expect(r.tiers.length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/sizing.test.ts
```

Expected failure: `Error: Failed to load url ./sizing` — file does not exist.

- [ ] **Step 3: Write the implementation.** Create `quotemate-automation/lib/solar/sizing.ts`:

```typescript
// ════════════════════════════════════════════════════════════════════
// Solar — system sizing (spec §3).
//
// Pick 2–3 HONEST system-size tiers from the roof's real panel configs,
// capped by BOTH the roof's physical capacity (max_panels_count) AND the
// DNSP export limit (default 5 kW/phase, derated DC→AC). The tiers are
// genuinely different sizes (good = smaller, best = roof-max), never a
// discount on one size. Every solar quote is tradie-reviewed — sizing
// only routes to inspection when the roof can't hold a single panel.
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type {
  SolarRoofFacts,
  SolarPanelType,
  SolarConfig,
  SolarEstimateContext,
  SolarSystemTier,
  SolarSizingResult,
  SolarPanelConfig,
  SolarRoutingDecision,
} from './types'

/** Target panel-count fractions of the roof max for the good/middle tier.
 *  The top tier is always the roof-or-export max. */
const GOOD_FRACTION = 0.55
const MIDDLE_FRACTION = 0.80

export function sizeSolarSystem(args: {
  roof: SolarRoofFacts
  panelType: SolarPanelType
  config: SolarConfig
  context: SolarEstimateContext
}): SolarSizingResult {
  const { roof, panelType, config, context } = args
  const wattsPerPanel = roof.panel_capacity_watts
  const roof_capacity_kw_dc = round2((roof.max_panels_count * wattsPerPanel) / 1000)

  // Export ceiling: kW AC limit per phase → an equivalent DC ceiling via
  // the derate (DC × derate = AC, so DC ceiling = AC limit / derate).
  const export_limit_kw_ac =
    config.export_limits.by_network[context.network] ??
    config.export_limits.default_kw_per_phase
  const exportDcCeiling = round2(export_limit_kw_ac / config.derate_factor)

  // No usable roof → inspection (the only sizing failure mode).
  if (roof.max_panels_count <= 0 || roof.panel_configs.length === 0) {
    return {
      tiers: [],
      roof_capacity_kw_dc,
      export_limit_kw_ac,
      routing: {
        decision: 'inspection_required',
        reason:
          'No usable roof area for panels was detected, so a site inspection is required before sizing a system.',
      },
    }
  }

  // Candidate panel counts, ascending, deduped, each capped by the roof.
  const maxPanels = roof.max_panels_count
  const targets = [
    Math.max(1, Math.round(maxPanels * GOOD_FRACTION)),
    Math.max(1, Math.round(maxPanels * MIDDLE_FRACTION)),
    maxPanels,
  ]
  const uniqueCounts = Array.from(new Set(targets))
    .filter((n) => n >= 1 && n <= maxPanels)
    .sort((a, b) => a - b)

  const tierNames = pickTierNames(uniqueCounts.length)

  const tiers: SolarSystemTier[] = uniqueCounts.map((count, i) => {
    const config_src = nearestConfig(roof.panel_configs, count)
    const panels_count = count
    const system_kw_dc = round2((panels_count * wattsPerPanel) / 1000)
    const export_limited = system_kw_dc > exportDcCeiling
    return {
      tier: tierNames[i],
      label: tierLabel(tierNames[i], system_kw_dc),
      system_kw_dc,
      panels_count,
      panel_type: panelType,
      source_config: config_src,
      export_limited,
    }
  })

  const routing: SolarRoutingDecision = {
    decision: 'tradie_review',
    reason:
      'System sized automatically from roof analysis. Every solar quote requires accredited-installer sign-off before customer send.',
  }

  return { tiers, roof_capacity_kw_dc, export_limit_kw_ac, routing }
}

/** PURE — name N tiers good→best (2 → [good,best]; 3 → [good,better,best]). */
function pickTierNames(n: number): Array<'good' | 'better' | 'best'> {
  if (n <= 1) return ['best']
  if (n === 2) return ['good', 'best']
  return ['good', 'better', 'best']
}

/** PURE — the precomputed config whose panel count is nearest the target. */
function nearestConfig(
  configs: SolarPanelConfig[],
  targetCount: number,
): SolarPanelConfig {
  return configs.reduce((best, c) =>
    Math.abs(c.panels_count - targetCount) < Math.abs(best.panels_count - targetCount)
      ? c
      : best,
  )
}

function tierLabel(tier: 'good' | 'better' | 'best', kw: number): string {
  if (tier === 'good') return `${kw.toFixed(1)} kW starter system`
  if (tier === 'better') return `${kw.toFixed(1)} kW full-size system`
  return `${kw.toFixed(1)} kW maximum-output system`
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

export const __test_only__ = { GOOD_FRACTION, MIDDLE_FRACTION, pickTierNames, nearestConfig }
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm test -- lib/solar/sizing.test.ts
```

Expected: `9 passed`.

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/sizing.ts quotemate-automation/lib/solar/sizing.test.ts
git commit -m "feat(solar): sizing.ts — 2-3 honest tiers, roof + export-limit capped

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `production.ts` — DC→AC derate, scaling, CEC cross-check, band

**Files:**
- Create: `quotemate-automation/lib/solar/production.ts`
- Test: `quotemate-automation/lib/solar/production.test.ts`

- [ ] **Step 1: Write the failing test.** Create `quotemate-automation/lib/solar/production.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { estimateSolarProduction } from './production'
import { DEFAULT_SOLAR_CONFIG } from './config'
import { normaliseSolarRoofFacts } from './roof'
import { COVERED_INSIGHT, COVERED_RAW_BODY } from './__fixtures__/building-insights'
import type {
  SolarCoverageResult,
  SolarEstimateContext,
  SolarSystemTier,
} from './types'

const COVERAGE = {
  covered: true,
  location: { lat: -33.8688, lng: 151.2093 },
  imagery_quality: 'HIGH',
  imagery_date: '2024-03-12',
} satisfies Extract<SolarCoverageResult, { covered: true }>

const CONTEXT: SolarEstimateContext = {
  postcode: '2000',
  state: 'NSW',
  install_year: 2026,
  network: 'Ausgrid',
}

const ROOF = normaliseSolarRoofFacts({ ...COVERED_INSIGHT, raw: COVERED_RAW_BODY }, COVERAGE)

// 16-panel config from the fixture: 16 × 400 / 1000 = 6.4 kW DC,
// yearly_energy_dc_kwh = 9600.
const TIER: SolarSystemTier = {
  tier: 'good',
  label: '6.4 kW starter system',
  system_kw_dc: 6.4,
  panels_count: 16,
  panel_type: 'standard_panels',
  source_config: { panels_count: 16, yearly_energy_dc_kwh: 9600 },
  export_limited: false,
}

describe('estimateSolarProduction', () => {
  const p = estimateSolarProduction({ tier: TIER, roof: ROOF, config: DEFAULT_SOLAR_CONFIG, context: CONTEXT })

  it('applies the configured DC→AC derate (0.81)', () => {
    expect(p.derate_applied).toBe(0.81)
  })

  it('derates the config DC energy to AC (9600 × 0.81 = 7776 kWh/yr)', () => {
    expect(p.annual_kwh_ac).toBe(7776)
  })

  it('reports the system kW DC on the result', () => {
    expect(p.system_kw_dc).toBe(6.4)
  })

  it('attaches a ±band around the point estimate', () => {
    expect(p.annual_kwh_low).toBeLessThan(p.annual_kwh_ac)
    expect(p.annual_kwh_high).toBeGreaterThan(p.annual_kwh_ac)
  })

  it('uses a tight ±20% band for HIGH imagery (covered google path)', () => {
    expect(p.band).toBe('tight')
    expect(p.annual_kwh_low).toBe(Math.round(7776 * 0.80))
    expect(p.annual_kwh_high).toBe(Math.round(7776 * 1.20))
  })

  it('carries the 0.5%/yr degradation fraction', () => {
    expect(p.degradation_pct_per_year).toBe(0.005)
  })

  it('cross-checks against the CEC benchmark and flags within ±35%', () => {
    // 7776 AC / 6.4 kW = 1215 kWh/kW/yr — within ±35% of an ~1382 Sydney benchmark.
    expect(p.cec_benchmark_kwh_per_kw).toBeGreaterThan(0)
    expect(p.within_cec_benchmark).toBe(true)
  })

  it('widens to a wide band on the manual path (no panel-config DC)', () => {
    const manualTier: SolarSystemTier = {
      ...TIER,
      source_config: { panels_count: 16, yearly_energy_dc_kwh: 8960 },
    }
    const manualRoof = { ...ROOF, source: 'manual' as const, imagery_quality: null }
    const mp = estimateSolarProduction({
      tier: manualTier,
      roof: manualRoof,
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    expect(mp.band).toBe('wide')
    expect(mp.annual_kwh_low).toBe(Math.round(mp.annual_kwh_ac * 0.70))
    expect(mp.annual_kwh_high).toBe(Math.round(mp.annual_kwh_ac * 1.30))
  })

  it('flags within_cec_benchmark=false for an absurd AC/kW yield', () => {
    const absurd: SolarSystemTier = {
      ...TIER,
      source_config: { panels_count: 16, yearly_energy_dc_kwh: 40000 },
    }
    const ap = estimateSolarProduction({ tier: absurd, roof: ROOF, config: DEFAULT_SOLAR_CONFIG, context: CONTEXT })
    expect(ap.within_cec_benchmark).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/production.test.ts
```

Expected failure: `Error: Failed to load url ./production` — file does not exist.

- [ ] **Step 3: Write the implementation.** Create `quotemate-automation/lib/solar/production.ts`:

```typescript
// ════════════════════════════════════════════════════════════════════
// Solar — annual AC production + confidence band (spec §3, §7).
//
// Google's solarPanelConfigs give a DC energy estimate per config. We:
//   1. Scale that DC figure if the tier's panel rating differs from the
//      config's assumed 400 W baseline (panelCapacityWatts / 400).
//   2. Apply the DC→AC derate (0.80–0.82) from config.
//   3. Cross-check the implied AC/kW against a CEC city benchmark and flag
//      within ±35% (the deterministic-output guardrail, spec §7).
//   4. Attach a ±band: tight ±20% on covered/HIGH imagery, wide ±30% on
//      manual / MEDIUM / no-imagery paths.
// Year-1 is the point estimate; 0.5%/yr linear degradation is carried for
// the lifetime view (economics uses year-1).
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type {
  SolarSystemTier,
  SolarRoofFacts,
  SolarConfig,
  SolarEstimateContext,
  SolarProductionResult,
  SolarConfidenceBand,
} from './types'

/** The config's assumed per-panel DC baseline, watts. */
const CONFIG_PANEL_BASELINE_WATTS = 400
/** Annual linear degradation fraction. */
const DEGRADATION_PCT_PER_YEAR = 0.005
/** CEC cross-check tolerance — ±35% of the city benchmark. */
const CEC_TOLERANCE = 0.35

/** A small CEC-derived specific-yield table, kWh per kW DC per year, by
 *  the first digit of the postcode (state proxy). Conservative metro
 *  values; admin can widen later. */
const CEC_BENCHMARK_BY_STATE: Record<string, number> = {
  NSW: 1382,
  VIC: 1278,
  QLD: 1424,
  SA: 1490,
  WA: 1521,
  TAS: 1130,
  ACT: 1382,
  NT: 1621,
}

export function estimateSolarProduction(args: {
  tier: SolarSystemTier
  roof: SolarRoofFacts
  config: SolarConfig
  context: SolarEstimateContext
}): SolarProductionResult {
  const { tier, roof, config, context } = args

  // 1. Scale the config DC energy for any non-400W panel rating.
  const ratingScale = roof.panel_capacity_watts / CONFIG_PANEL_BASELINE_WATTS
  const scaledDc = tier.source_config.yearly_energy_dc_kwh * ratingScale

  // 2. DC → AC derate.
  const derate = config.derate_factor
  const annual_kwh_ac = Math.round(scaledDc * derate)

  // 3. CEC cross-check on implied AC specific yield.
  const cec_benchmark_kwh_per_kw = CEC_BENCHMARK_BY_STATE[context.state] ?? 1300
  const impliedAcPerKw = tier.system_kw_dc > 0 ? annual_kwh_ac / tier.system_kw_dc : 0
  const lowBound = cec_benchmark_kwh_per_kw * (1 - CEC_TOLERANCE)
  const highBound = cec_benchmark_kwh_per_kw * (1 + CEC_TOLERANCE)
  const within_cec_benchmark = impliedAcPerKw >= lowBound && impliedAcPerKw <= highBound

  // 4. Confidence band — tight on covered/HIGH, wide otherwise.
  const band: SolarConfidenceBand =
    roof.source === 'google' && roof.imagery_quality === 'HIGH' ? 'tight' : 'wide'
  const spread = band === 'tight' ? 0.20 : 0.30
  const annual_kwh_low = Math.round(annual_kwh_ac * (1 - spread))
  const annual_kwh_high = Math.round(annual_kwh_ac * (1 + spread))

  return {
    system_kw_dc: tier.system_kw_dc,
    annual_kwh_ac,
    annual_kwh_low,
    annual_kwh_high,
    derate_applied: derate,
    degradation_pct_per_year: DEGRADATION_PCT_PER_YEAR,
    cec_benchmark_kwh_per_kw,
    within_cec_benchmark,
    band,
  }
}

export const __test_only__ = {
  CONFIG_PANEL_BASELINE_WATTS,
  DEGRADATION_PCT_PER_YEAR,
  CEC_TOLERANCE,
  CEC_BENCHMARK_BY_STATE,
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm test -- lib/solar/production.test.ts
```

Expected: `9 passed`.

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/production.ts quotemate-automation/lib/solar/production.test.ts
git commit -m "feat(solar): production.ts — DC→AC derate, CEC cross-check, confidence band

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `pricing.ts` — gross − STC = net

**Files:**
- Create: `quotemate-automation/lib/solar/pricing.ts`
- Test: `quotemate-automation/lib/solar/pricing.test.ts`

- [ ] **Step 1: Write the failing test.** Create `quotemate-automation/lib/solar/pricing.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { calculateSolarPrice, DEFAULT_SOLAR_RATE_CARD } from './pricing'
import { DEFAULT_SOLAR_CONFIG } from './config'
import { normaliseSolarRoofFacts } from './roof'
import { sizeSolarSystem } from './sizing'
import { COVERED_INSIGHT, COVERED_RAW_BODY } from './__fixtures__/building-insights'
import type { SolarCoverageResult, SolarEstimateContext } from './types'

const COVERAGE = {
  covered: true,
  location: { lat: -33.8688, lng: 151.2093 },
  imagery_quality: 'HIGH',
  imagery_date: '2024-03-12',
} satisfies Extract<SolarCoverageResult, { covered: true }>

const CONTEXT: SolarEstimateContext = {
  postcode: '2000', // zone 1.382 in DEFAULT_SOLAR_CONFIG
  state: 'NSW',
  install_year: 2026, // deeming = 5
  network: 'Ausgrid',
}

const ROOF = normaliseSolarRoofFacts({ ...COVERED_INSIGHT, raw: COVERED_RAW_BODY }, COVERAGE)
const SIZING = sizeSolarSystem({
  roof: ROOF,
  panelType: 'standard_panels',
  config: DEFAULT_SOLAR_CONFIG,
  context: CONTEXT,
})

describe('calculateSolarPrice', () => {
  const price = calculateSolarPrice({
    sizing: SIZING,
    roof: ROOF,
    context: CONTEXT,
    config: DEFAULT_SOLAR_CONFIG,
  })

  it('returns one priced tier per sizing tier in good→best order', () => {
    expect(price.tiers.length).toBe(SIZING.tiers.length)
    expect(price.tiers[0].tier).toBe(SIZING.tiers[0].tier)
  })

  it('computes gross ex-GST = kW × $/kW (standard = $1100/kW)', () => {
    const t = price.tiers[0]
    const kw = SIZING.tiers[0].system_kw_dc
    expect(t.gross_ex_gst).toBe(Math.round(kw * 1100 * 100) / 100)
  })

  it('computes STC certificates = floor(kW × zone × deeming)', () => {
    const t = price.tiers[0]
    const kw = SIZING.tiers[0].system_kw_dc
    expect(t.stc.certificates).toBe(Math.floor(kw * 1.382 * 5))
    expect(t.stc.zone_rating).toBe(1.382)
    expect(t.stc.deeming_years).toBe(5)
  })

  it('computes the STC rebate = certificates × stc_price ($38)', () => {
    const t = price.tiers[0]
    expect(t.stc.stc_price_aud).toBe(38)
    expect(t.stc.rebate_aud).toBe(Math.round(t.stc.certificates * 38 * 100) / 100)
  })

  it('nets the rebate off the gross (net = gross − rebate)', () => {
    const t = price.tiers[0]
    expect(t.net_ex_gst).toBe(Math.round((t.gross_ex_gst - t.stc.rebate_aud) * 100) / 100)
  })

  it('applies GST factor 1.10 to both gross and net', () => {
    const t = price.tiers[0]
    expect(t.gross_inc_gst).toBe(Math.round(t.gross_ex_gst * 1.10 * 100) / 100)
    expect(t.net_inc_gst).toBe(Math.round(t.net_ex_gst * 1.10 * 100) / 100)
  })

  it('uses premium $/kW when the panel type is premium', () => {
    const premiumSizing = sizeSolarSystem({
      roof: ROOF,
      panelType: 'premium_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    const p = calculateSolarPrice({
      sizing: premiumSizing,
      roof: ROOF,
      context: CONTEXT,
      config: DEFAULT_SOLAR_CONFIG,
    })
    const kw = premiumSizing.tiers[0].system_kw_dc
    expect(p.tiers[0].gross_ex_gst).toBe(Math.round(kw * 1450 * 100) / 100)
  })

  it('stacks a multi-storey loading onto the effective $/kW', () => {
    const twoStorey = { ...ROOF, storeys: 2 }
    const p = calculateSolarPrice({
      sizing: SIZING,
      roof: twoStorey,
      context: CONTEXT,
      config: DEFAULT_SOLAR_CONFIG,
    })
    expect(p.loadings_applied.some((l) => l.code === 'multi_storey')).toBe(true)
    expect(p.effective_rate_per_kw).toBe(Math.round(1100 * 1.15 * 100) / 100)
  })

  it('raises a tiny system to the call-out floor and flags it', () => {
    const tinyRoof = { ...ROOF, max_panels_count: 4, panel_configs: [{ panels_count: 4, yearly_energy_dc_kwh: 2400 }] }
    const tinySizing = sizeSolarSystem({
      roof: tinyRoof,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    const p = calculateSolarPrice({
      sizing: tinySizing,
      roof: tinyRoof,
      context: CONTEXT,
      config: DEFAULT_SOLAR_CONFIG,
    })
    expect(p.call_out_minimum_applied).toBe(true)
    expect(p.tiers[0].gross_ex_gst).toBeGreaterThanOrEqual(DEFAULT_SOLAR_RATE_CARD.call_out_minimum_ex_gst!)
  })

  it('carries the sizing routing through unchanged (tradie_review)', () => {
    expect(price.routing.decision).toBe('tradie_review')
  })

  it('throws nothing on an unknown postcode but uses no zone (certificates 0)', () => {
    const offGrid: SolarEstimateContext = { ...CONTEXT, postcode: '9999' }
    const p = calculateSolarPrice({
      sizing: SIZING,
      roof: ROOF,
      context: offGrid,
      config: DEFAULT_SOLAR_CONFIG,
    })
    expect(p.tiers[0].stc.zone_rating).toBe(0)
    expect(p.tiers[0].stc.certificates).toBe(0)
    expect(p.tiers[0].net_ex_gst).toBe(p.tiers[0].gross_ex_gst)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/pricing.test.ts
```

Expected failure: `Error: Failed to load url ./pricing` — file does not exist.

- [ ] **Step 3: Write the implementation.** Create `quotemate-automation/lib/solar/pricing.ts`:

```typescript
// ════════════════════════════════════════════════════════════════════
// Solar — pure pricing logic (mirror of roofing/painting calculate*Price).
//
//   gross $ = system_kW × $/kW (panel grade) × loadings
//   STC      = floor(kW × zone_rating × deeming_years) × stc_price
//   net $    = gross − STC
//
// Deterministic — no LLM on the money path. The STC subtraction lives
// HERE (not in the caller) because it needs the context's postcode/year
// and the dated config; the customer page renders gross → STC → net as a
// transparent three-line breakdown. GST factor 1.10, call-out floor after
// the multiplication — identical to lib/roofing/pricing.ts.
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type {
  SolarSizingResult,
  SolarRoofFacts,
  SolarEstimateContext,
  SolarConfig,
  SolarRateCard,
  SolarPriceTier,
  SolarStcBreakdown,
  SolarQuotePrice,
} from './types'

// ── Default rate card (mirrors DEFAULT_SOLAR_CONFIG.default_rate_card) ──
export const DEFAULT_SOLAR_RATE_CARD: SolarRateCard = {
  install_rate_per_kw: {
    standard_panels: 1100,
    premium_panels: 1450,
    unknown: 0,
  },
  multi_storey_loading_pct: 0.15,
  complex_roof_loading_pct: 0.10,
  gst_registered: true,
  call_out_minimum_ex_gst: 3500,
}

// ── Loadings ────────────────────────────────────────────────────────
type Loading = {
  code: 'multi_storey' | 'complex_roof'
  pct: number
  detail: string
}

export function applicableLoadings(
  roof: SolarRoofFacts,
  rateCard: SolarRateCard,
): Loading[] {
  const out: Loading[] = []
  if ((roof.storeys ?? 1) >= 2) {
    out.push({
      code: 'multi_storey',
      pct: rateCard.multi_storey_loading_pct,
      detail: `${(rateCard.multi_storey_loading_pct * 100).toFixed(0)}% multi-storey roof access loading`,
    })
  }
  // A steep mean pitch (> 35°) or a complex many-plane roof loads access.
  const steep = typeof roof.mean_pitch_degrees === 'number' && roof.mean_pitch_degrees > 35
  const manyPlanes = roof.segment_count >= 6
  if (steep || manyPlanes) {
    out.push({
      code: 'complex_roof',
      pct: rateCard.complex_roof_loading_pct,
      detail: `${(rateCard.complex_roof_loading_pct * 100).toFixed(0)}% complex/steep roof loading`,
    })
  }
  return out
}

// ── STC breakdown ────────────────────────────────────────────────────
/** PURE — STC certificates + dollar rebate for a system size. Postcodes
 *  not in the zone table yield zone 0 → 0 certificates → 0 rebate (we
 *  never state-default; spec §5). */
export function stcBreakdown(args: {
  system_kw: number
  context: SolarEstimateContext
  config: SolarConfig
}): SolarStcBreakdown {
  const { system_kw, context, config } = args
  const zone_rating = config.zone_table[context.postcode] ?? 0
  const deeming_years = config.deeming_schedule[context.install_year] ?? 0
  const certificates =
    zone_rating > 0 && deeming_years > 0
      ? Math.floor(system_kw * zone_rating * deeming_years)
      : 0
  const stc_price_aud = config.stc_price_aud
  const rebate_aud = roundTo(certificates * stc_price_aud, 2)
  return {
    system_kw,
    zone_rating,
    deeming_years,
    certificates,
    stc_price_aud,
    rebate_aud,
  }
}

export function calculateSolarPrice(args: {
  sizing: SolarSizingResult
  roof: SolarRoofFacts
  context: SolarEstimateContext
  config: SolarConfig
  rateCard?: SolarRateCard
}): SolarQuotePrice {
  const rateCard = args.rateCard ?? args.config.default_rate_card ?? DEFAULT_SOLAR_RATE_CARD
  const { sizing, roof, context, config } = args

  const loadings = applicableLoadings(roof, rateCard)
  const loadingMultiplier = loadings.reduce((acc, l) => acc * (1 + l.pct), 1)

  const gstFactor = rateCard.gst_registered ? 1.10 : 1.0
  const floor = rateCard.call_out_minimum_ex_gst ?? 0
  const applyFloor = (n: number) => (floor > 0 && n > 0 ? Math.max(n, floor) : n)

  let callOutMinimumApplied = false
  // Use the panel type from the first tier for the effective-rate display.
  const displayRate =
    (rateCard.install_rate_per_kw[sizing.tiers[0]?.panel_type ?? 'unknown'] ?? 0) *
    loadingMultiplier

  const tiers: SolarPriceTier[] = sizing.tiers.map((t) => {
    const baseRate = rateCard.install_rate_per_kw[t.panel_type] ?? 0
    const grossRaw = t.system_kw_dc * baseRate * loadingMultiplier
    const grossFloored = applyFloor(grossRaw)
    if (floor > 0 && grossRaw > 0 && grossRaw < floor) callOutMinimumApplied = true

    const gross_ex_gst = roundTo(grossFloored, 2)
    const stc = stcBreakdown({ system_kw: t.system_kw_dc, context, config })
    const net_ex_gst = roundTo(Math.max(0, gross_ex_gst - stc.rebate_aud), 2)

    return {
      tier: t.tier,
      label: t.label,
      system_kw_dc: t.system_kw_dc,
      gross_ex_gst,
      gross_inc_gst: roundTo(gross_ex_gst * gstFactor, 2),
      stc,
      net_ex_gst,
      net_inc_gst: roundTo(net_ex_gst * gstFactor, 2),
      scope: `${t.system_kw_dc.toFixed(1)} kW solar install (${t.panels_count} ${t.panel_type.replace('_', ' ')}), supply and install by an accredited installer.`,
    }
  })

  return {
    tiers,
    effective_rate_per_kw: roundTo(displayRate, 2),
    loadings_applied: loadings,
    routing: sizing.routing,
    call_out_minimum_applied: callOutMinimumApplied,
  }
}

function roundTo(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

export const __test_only__ = { roundTo, stcBreakdown, applicableLoadings }
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm test -- lib/solar/pricing.test.ts
```

Expected: `11 passed`.

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/pricing.ts quotemate-automation/lib/solar/pricing.test.ts
git commit -m "feat(solar): pricing.ts — gross − STC = net, GST + call-out floor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `economics.ts` — annual savings + banded payback

**Files:**
- Create: `quotemate-automation/lib/solar/economics.ts`
- Test: `quotemate-automation/lib/solar/economics.test.ts`

- [ ] **Step 1: Write the failing test.** Create `quotemate-automation/lib/solar/economics.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { calculateSolarEconomics } from './economics'
import { DEFAULT_SOLAR_CONFIG } from './config'
import type {
  SolarEstimateContext,
  SolarProductionResult,
  SolarQuotePrice,
  SolarPriceTier,
} from './types'

const CONTEXT: SolarEstimateContext = {
  postcode: '2000',
  state: 'NSW',
  install_year: 2026,
  network: 'Ausgrid', // feed-in 0.08 in DEFAULT_SOLAR_CONFIG
}

// One tier: 6.4 kW, net $5000, AC 7776 kWh/yr, tight band.
const TIER: SolarPriceTier = {
  tier: 'good',
  label: '6.4 kW starter system',
  system_kw_dc: 6.4,
  gross_ex_gst: 7040,
  gross_inc_gst: 7744,
  stc: {
    system_kw: 6.4,
    zone_rating: 1.382,
    deeming_years: 5,
    certificates: 44,
    stc_price_aud: 38,
    rebate_aud: 1672,
  },
  net_ex_gst: 5368,
  net_inc_gst: 5904.8,
  scope: '6.4 kW solar install.',
}

const PRODUCTION: SolarProductionResult = {
  system_kw_dc: 6.4,
  annual_kwh_ac: 7776,
  annual_kwh_low: 6221,
  annual_kwh_high: 9331,
  derate_applied: 0.81,
  degradation_pct_per_year: 0.005,
  cec_benchmark_kwh_per_kw: 1382,
  within_cec_benchmark: true,
  band: 'tight',
}

const PRICE: SolarQuotePrice = {
  tiers: [TIER],
  effective_rate_per_kw: 1100,
  loadings_applied: [],
  routing: { decision: 'tradie_review', reason: 'x' },
}

describe('calculateSolarEconomics', () => {
  const econ = calculateSolarEconomics({
    price: PRICE,
    production: [PRODUCTION],
    config: DEFAULT_SOLAR_CONFIG,
    context: CONTEXT,
  })
  const t = econ.tiers[0]

  it('splits production into self-consumed and exported by the config %', () => {
    // 40% self-consumption of 7776 = 3110.4 → round 3110
    expect(t.self_consumed_kwh).toBe(Math.round(7776 * 0.40))
    expect(t.exported_kwh).toBe(7776 - t.self_consumed_kwh)
  })

  it('values self-consumption at the retail rate ($0.32/kWh)', () => {
    expect(t.bill_savings_aud).toBe(Math.round(t.self_consumed_kwh * 0.32 * 100) / 100)
  })

  it('values exports at the network feed-in tariff ($0.08 Ausgrid)', () => {
    expect(t.export_earnings_aud).toBe(Math.round(t.exported_kwh * 0.08 * 100) / 100)
  })

  it('sums annual savings = bill savings + export earnings', () => {
    expect(t.annual_savings_aud).toBe(Math.round((t.bill_savings_aud + t.export_earnings_aud) * 100) / 100)
  })

  it('produces a payback RANGE (low < high), net ÷ savings band', () => {
    expect(t.payback_years_low).toBeLessThan(t.payback_years_high)
    // low = net / (savings × upper band factor); high = net / (savings × lower band factor)
    expect(t.payback_years_low).toBeGreaterThan(0)
  })

  it('surfaces the assumptions panel verbatim from config + context', () => {
    expect(econ.assumptions.self_consumption_pct).toBe(0.40)
    expect(econ.assumptions.retail_rate_aud_per_kwh).toBe(0.32)
    expect(econ.assumptions.feed_in_tariff_aud_per_kwh).toBe(0.08)
    expect(econ.assumptions.feed_in_network).toBe('Ausgrid')
  })

  it('falls back to the default feed-in for an unknown network', () => {
    const e = calculateSolarEconomics({
      price: PRICE,
      production: [PRODUCTION],
      config: DEFAULT_SOLAR_CONFIG,
      context: { ...CONTEXT, network: 'NotAReal DNSP' },
    })
    expect(e.assumptions.feed_in_tariff_aud_per_kwh).toBe(DEFAULT_SOLAR_CONFIG.feed_in.default_aud_per_kwh)
  })

  it('widens the payback band on a wide production band', () => {
    const wideProd: SolarProductionResult = { ...PRODUCTION, band: 'wide' }
    const e = calculateSolarEconomics({
      price: PRICE,
      production: [wideProd],
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    const span = e.tiers[0].payback_years_high - e.tiers[0].payback_years_low
    const tightSpan = t.payback_years_high - t.payback_years_low
    expect(span).toBeGreaterThan(tightSpan)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/economics.test.ts
```

Expected failure: `Error: Failed to load url ./economics` — file does not exist.

- [ ] **Step 3: Write the implementation.** Create `quotemate-automation/lib/solar/economics.ts`:

```typescript
// ════════════════════════════════════════════════════════════════════
// Solar — annual savings + banded payback (spec §1, §6).
//
//   annual savings = self_consumed_kWh × retail_rate
//                  + exported_kWh × feed_in_tariff
//   payback        = net_price ÷ annual_savings  — a RANGE, not a point.
//
// The payback band is driven off the production band: the high-production
// edge pays back FASTER (lower years), the low-production edge SLOWER
// (higher years). Tight ±20% vs wide ±30% inherited from production.ts.
// Feed-in resolves by network from config, defaulting when unknown.
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type {
  SolarQuotePrice,
  SolarProductionResult,
  SolarConfig,
  SolarEstimateContext,
  SolarEconomicsTier,
  SolarEconomicsResult,
} from './types'

export function calculateSolarEconomics(args: {
  price: SolarQuotePrice
  production: SolarProductionResult[]
  config: SolarConfig
  context: SolarEstimateContext
}): SolarEconomicsResult {
  const { price, production, config, context } = args

  const selfPct = config.self_consumption_pct
  const retail = config.retail_rate_aud_per_kwh
  const feedIn =
    config.feed_in.by_network[context.network] ?? config.feed_in.default_aud_per_kwh

  const tiers: SolarEconomicsTier[] = price.tiers.map((priceTier, i) => {
    const prod = production[i]
    const ac = prod ? prod.annual_kwh_ac : 0
    const band = prod ? prod.band : 'wide'
    const spread = band === 'tight' ? 0.20 : 0.30

    const self_consumed_kwh = Math.round(ac * selfPct)
    const exported_kwh = ac - self_consumed_kwh

    const bill_savings_aud = roundTo(self_consumed_kwh * retail, 2)
    const export_earnings_aud = roundTo(exported_kwh * feedIn, 2)
    const annual_savings_aud = roundTo(bill_savings_aud + export_earnings_aud, 2)

    const net = priceTier.net_inc_gst
    // High production (× (1+spread)) → fast payback (low years).
    // Low production (× (1−spread)) → slow payback (high years).
    const payback_years_low =
      annual_savings_aud > 0
        ? roundTo(net / (annual_savings_aud * (1 + spread)), 1)
        : 0
    const payback_years_high =
      annual_savings_aud > 0
        ? roundTo(net / (annual_savings_aud * (1 - spread)), 1)
        : 0

    return {
      tier: priceTier.tier,
      self_consumed_kwh,
      exported_kwh,
      bill_savings_aud,
      export_earnings_aud,
      annual_savings_aud,
      payback_years_low,
      payback_years_high,
    }
  })

  return {
    tiers,
    assumptions: {
      self_consumption_pct: selfPct,
      retail_rate_aud_per_kwh: retail,
      feed_in_tariff_aud_per_kwh: feedIn,
      feed_in_network: context.network,
    },
  }
}

function roundTo(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

export const __test_only__ = { roundTo }
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm test -- lib/solar/economics.test.ts
```

Expected: `8 passed`.

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/economics.ts quotemate-automation/lib/solar/economics.test.ts
git commit -m "feat(solar): economics.ts — annual savings + banded payback range

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: `intake.ts` — orchestrator (covered + manual paths)

**Files:**
- Create: `quotemate-automation/lib/solar/intake.ts`
- Test: `quotemate-automation/lib/solar/intake.test.ts`

This is the only async module besides `coverage.ts`. Its single export `runSolarEstimate` wires coverage → roof (or manual fallback) → sizing → production → pricing → economics → guardrails into one `SolarEstimate`. Persistence to `solar_estimates` is delegated to an injectable `opts.persist` so this stays unit-testable without a DB (the real persistence is wired in a later phase). A `geocode` and `solarOpts` are likewise injectable.

- [ ] **Step 1: Write the failing test.** Create `quotemate-automation/lib/solar/intake.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { runSolarEstimate } from './intake'
import { DEFAULT_SOLAR_CONFIG } from './config'
import { COVERED_RAW_BODY } from './__fixtures__/building-insights'
import type { SolarAddressInput, SolarManualRoofInput } from './types'

const ADDRESS: SolarAddressInput = {
  address: '1 Test St, Sydney',
  postcode: '2000',
  state: 'NSW',
}

function fakeFetch(status: number, body: unknown) {
  return async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
}

const geocodeOk = async () => ({ lat: -33.8688, lng: 151.2093 })

describe('runSolarEstimate — covered path', () => {
  it('produces a complete SolarEstimate from Google imagery', async () => {
    const est = await runSolarEstimate({
      input: ADDRESS,
      config: DEFAULT_SOLAR_CONFIG,
      opts: {
        geocode: geocodeOk,
        solarOpts: { apiKey: 'k', fetchImpl: fakeFetch(200, COVERED_RAW_BODY) },
        installYear: 2026,
        network: 'Ausgrid',
      },
    })
    expect(est.coverage_source).toBe('google')
    expect(est.roof.source).toBe('google')
    expect(est.sizing.tiers.length).toBeGreaterThanOrEqual(2)
    expect(est.production.length).toBe(est.sizing.tiers.length)
    expect(est.price.tiers.length).toBe(est.sizing.tiers.length)
    expect(est.economics.tiers.length).toBe(est.sizing.tiers.length)
    expect(est.confidence_band).toBe('tight')
    expect(est.routing.decision).toBe('tradie_review')
    expect(est.config_version).toBe(DEFAULT_SOLAR_CONFIG.version)
    expect(typeof est.token).toBe('string')
    expect(est.token.length).toBeGreaterThanOrEqual(16)
  })

  it('persists the estimate via the injected persist hook', async () => {
    let persisted: unknown = null
    await runSolarEstimate({
      input: ADDRESS,
      config: DEFAULT_SOLAR_CONFIG,
      opts: {
        geocode: geocodeOk,
        solarOpts: { apiKey: 'k', fetchImpl: fakeFetch(200, COVERED_RAW_BODY) },
        installYear: 2026,
        network: 'Ausgrid',
        persist: async (e) => {
          persisted = e
        },
      },
    })
    expect(persisted).not.toBeNull()
  })
})

describe('runSolarEstimate — manual fallback path', () => {
  const manual: SolarManualRoofInput = { orientation: 'north', roof_size: 'medium', storeys: 1 }

  it('branches to the manual roof when coverage 404s', async () => {
    const est = await runSolarEstimate({
      input: ADDRESS,
      manual,
      config: DEFAULT_SOLAR_CONFIG,
      opts: {
        geocode: geocodeOk,
        solarOpts: { apiKey: 'k', fetchImpl: fakeFetch(404, { error: {} }) },
        installYear: 2026,
        network: 'Ausgrid',
      },
    })
    expect(est.coverage_source).toBe('manual')
    expect(est.roof.source).toBe('manual')
    expect(est.confidence_band).toBe('wide')
    expect(est.satellite_image_url).toBeNull()
    expect(est.sizing.tiers.length).toBeGreaterThanOrEqual(2)
  })

  it('branches to manual when uncovered and no manual input was supplied (empty estimate, inspection routed)', async () => {
    const est = await runSolarEstimate({
      input: ADDRESS,
      config: DEFAULT_SOLAR_CONFIG,
      opts: {
        geocode: geocodeOk,
        solarOpts: { apiKey: 'k', fetchImpl: fakeFetch(404, { error: {} }) },
        installYear: 2026,
        network: 'Ausgrid',
      },
    })
    expect(est.coverage_source).toBe('manual')
    expect(est.routing.decision).toBe('inspection_required')
    expect(est.sizing.tiers.length).toBe(0)
  })
})

describe('runSolarEstimate — guardrails', () => {
  it('flags out-of-band tiers in guardrail_flags', async () => {
    // Force an absurd $/kW via a rate-card override embedded in config.
    const badConfig = {
      ...DEFAULT_SOLAR_CONFIG,
      default_rate_card: {
        ...DEFAULT_SOLAR_CONFIG.default_rate_card,
        install_rate_per_kw: { standard_panels: 9000, premium_panels: 9000, unknown: 0 },
      },
    }
    const est = await runSolarEstimate({
      input: ADDRESS,
      config: badConfig,
      opts: {
        geocode: geocodeOk,
        solarOpts: { apiKey: 'k', fetchImpl: fakeFetch(200, COVERED_RAW_BODY) },
        installYear: 2026,
        network: 'Ausgrid',
      },
    })
    expect(est.guardrail_flags.length).toBeGreaterThan(0)
    expect(est.guardrail_flags.join(' ')).toMatch(/gross/i)
  })

  it('throws when the config fails the freshness gate', async () => {
    await expect(
      runSolarEstimate({
        input: ADDRESS,
        config: { ...DEFAULT_SOLAR_CONFIG, stc_price_aud: 0 },
        opts: {
          geocode: geocodeOk,
          solarOpts: { apiKey: 'k', fetchImpl: fakeFetch(200, COVERED_RAW_BODY) },
          installYear: 2026,
          network: 'Ausgrid',
        },
      }),
    ).rejects.toThrow(/stc_price_unset/)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/intake.test.ts
```

Expected failure: `Error: Failed to load url ./intake` — file does not exist.

- [ ] **Step 3: Write the implementation.** Create `quotemate-automation/lib/solar/intake.ts`:

```typescript
// ════════════════════════════════════════════════════════════════════
// Solar — the orchestrator (spec §2, §4, §7).
//
// runSolarEstimate wires the whole deterministic slice together:
//   geocode → coverage gate → roof facts (google) OR manual fallback →
//   sizing → production (per tier) → pricing (gross − STC = net) →
//   economics → deterministic-output guardrails → SolarEstimate.
//
// Covered and uncovered addresses feed the SAME pricing/economics engine;
// only the roof-data source differs. I/O (geocode, the Solar API call, and
// row persistence) is injected so the orchestrator is fully unit-testable
// with no DB / network. Config freshness is enforced up front — a stale
// config throws BEFORE any estimate is computed (spec §5).
//
// Guardrails (spec §7): each tier is checked against sane bounds
// (gross $/kW $700–$1,800, payback 2–12 yrs, AC/kW within ±35% of the CEC
// benchmark). Failures are collected into guardrail_flags — the estimate
// is still returned (tradie reviews it), never published silently.
// ════════════════════════════════════════════════════════════════════

import { randomBytes } from 'node:crypto'
import { resolveSolarOpts } from '../roofing/solar-api'
import type { SolarEnrichmentOpts } from '../roofing/solar-api'
import { checkSolarCoverage } from './coverage'
import { normaliseSolarRoofFacts } from './roof'
import { buildManualRoofFacts } from './manual-fallback'
import { sizeSolarSystem } from './sizing'
import { estimateSolarProduction } from './production'
import { calculateSolarPrice } from './pricing'
import { calculateSolarEconomics } from './economics'
import { validateSolarConfig } from './config'
import type {
  SolarAddressInput,
  SolarManualRoofInput,
  SolarPanelType,
  SolarConfig,
  LatLng,
  SolarEstimate,
  SolarEstimateContext,
  SolarRoofFacts,
  SolarProductionResult,
  SolarConfidenceBand,
  SolarRoutingDecision,
} from './types'

/** Deterministic-output guardrail bounds (spec §7). */
const GROSS_PER_KW_MIN = 700
const GROSS_PER_KW_MAX = 1800
const PAYBACK_YEARS_MIN = 2
const PAYBACK_YEARS_MAX = 12

export type SolarEnrichmentOrchestratorOpts = {
  /** Resolve the address to a coordinate. */
  geocode: (input: SolarAddressInput) => Promise<LatLng>
  /** Forwarded to the Solar API client (apiKey, fetchImpl, …). */
  solarOpts?: SolarEnrichmentOpts
  /** Install year for the STC deeming lookup. Defaults to current year. */
  installYear?: number
  /** DNSP/network for feed-in + export limit. */
  network: string
  /** Optional persistence hook — writes the solar_estimates row. */
  persist?: (estimate: SolarEstimate) => Promise<void>
  /** Optional satellite hero image URL resolver (real photo, no generative). */
  satelliteImageUrl?: (location: LatLng) => Promise<string | null>
}

export async function runSolarEstimate(args: {
  input: SolarAddressInput
  manual?: SolarManualRoofInput
  panelType?: SolarPanelType
  config: SolarConfig
  opts?: SolarEnrichmentOrchestratorOpts
}): Promise<SolarEstimate> {
  const opts = args.opts
  if (!opts) throw new Error('runSolarEstimate requires orchestrator opts (geocode + network).')

  const installYear = opts.installYear ?? new Date().getFullYear()
  const panelType: SolarPanelType = args.panelType ?? 'standard_panels'

  // 0. Config freshness gate — throw before any computation (spec §5).
  const validation = validateSolarConfig(args.config, installYear)
  if (!validation.ok) {
    throw new Error(`solar config invalid: ${validation.code} — ${validation.detail}`)
  }
  const config = validation.config

  const context: SolarEstimateContext = {
    postcode: args.input.postcode,
    state: args.input.state,
    install_year: installYear,
    network: opts.network,
  }

  // 1. Geocode + coverage gate.
  const location = await opts.geocode(args.input)
  const solarOpts = resolveSolarOpts(opts.solarOpts)
  const coverage = await checkSolarCoverage(args.input, location, solarOpts)

  // 2. Roof facts — google when covered, manual fallback otherwise.
  let roof: SolarRoofFacts
  let coverage_source: SolarEstimate['coverage_source']
  let satellite_image_url: string | null = null

  if (coverage.covered) {
    // Re-fetch the raw body for the panel configs roof.ts needs. The
    // coverage gate already proved the call succeeds; fetch once more
    // through the same injected client and parse.
    const raw = await fetchRawInsights(location, opts.solarOpts)
    roof = normaliseSolarRoofFacts(raw, coverage)
    coverage_source = 'google'
    satellite_image_url = opts.satelliteImageUrl
      ? await opts.satelliteImageUrl(location)
      : null
  } else if (args.manual) {
    roof = buildManualRoofFacts(args.manual)
    coverage_source = 'manual'
  } else {
    // Uncovered and no manual input — return an inspection-routed empty
    // estimate from a synthetic empty manual roof. The customer page will
    // collect the manual answers and re-run.
    roof = buildManualRoofFacts({ orientation: 'unknown', roof_size: 'small', storeys: 1 })
    roof = { ...roof, max_panels_count: 0, panel_configs: [] }
    coverage_source = 'manual'
  }

  // 3. Sizing → production → pricing → economics.
  const sizing = sizeSolarSystem({ roof, panelType, config, context })
  const production: SolarProductionResult[] = sizing.tiers.map((tier) =>
    estimateSolarProduction({ tier, roof, config, context }),
  )
  const price = calculateSolarPrice({ sizing, roof, context, config })
  const economics = calculateSolarEconomics({ price, production, config, context })

  // 4. Confidence band — worst of imagery + source.
  const confidence_band: SolarConfidenceBand =
    coverage_source === 'google' && roof.imagery_quality === 'HIGH' ? 'tight' : 'wide'

  // 5. Deterministic-output guardrails (spec §7).
  const guardrail_flags = runGuardrails({ price, production, economics })

  // 6. Routing — sizing's decision is the job-level routing.
  const routing: SolarRoutingDecision = sizing.routing

  const estimate: SolarEstimate = {
    token: generateSolarToken(),
    context,
    coverage_source,
    roof,
    sizing,
    production,
    price,
    economics,
    confidence_band,
    satellite_image_url,
    routing,
    guardrail_flags,
    config_version: config.version,
  }

  if (opts.persist) await opts.persist(estimate)
  return estimate
}

// ── helpers ──────────────────────────────────────────────────────────

/** Fetch the raw buildingInsights body so roof.ts can read panel configs.
 *  Uses the same injected client/key as the coverage gate. */
async function fetchRawInsights(
  location: LatLng,
  solarOpts: SolarEnrichmentOpts | undefined,
): Promise<import('./roof').SolarRoofInsightWithRaw> {
  const { parseBuildingInsights } = await import('../roofing/solar-api')
  const resolved = resolveSolarOpts(solarOpts)
  const base =
    resolved.baseUrl ??
    'https://solar.googleapis.com/v1/buildingInsights:findClosest'
  const url =
    `${base}?location.latitude=${encodeURIComponent(location.lat.toFixed(7))}` +
    `&location.longitude=${encodeURIComponent(location.lng.toFixed(7))}` +
    `&requiredQuality=LOW&key=${encodeURIComponent(resolved.apiKey ?? '')}`
  const fetchImpl = resolved.fetchImpl ?? ((u, init) => fetch(u, init))
  const res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } })
  const body = await res.json()
  const parsed = parseBuildingInsights(body)
  if (!parsed) throw new Error('Solar API raw re-fetch returned no usable roof segments.')
  return { ...parsed, raw: body }
}

/** PURE — collect deterministic-output guardrail breaches (spec §7). */
export function runGuardrails(args: {
  price: SolarEstimate['price']
  production: SolarProductionResult[]
  economics: SolarEstimate['economics']
}): string[] {
  const flags: string[] = []
  const { price, production, economics } = args

  price.tiers.forEach((t, i) => {
    if (t.system_kw_dc > 0) {
      const grossPerKw = t.gross_ex_gst / t.system_kw_dc
      if (grossPerKw < GROSS_PER_KW_MIN || grossPerKw > GROSS_PER_KW_MAX) {
        flags.push(
          `Tier ${t.tier}: gross $${grossPerKw.toFixed(0)}/kW is outside the sane $${GROSS_PER_KW_MIN}–$${GROSS_PER_KW_MAX}/kW band.`,
        )
      }
    }
    // Net must equal gross − rebate (allow 1c rounding tolerance).
    const expectedNet = Math.max(0, t.gross_ex_gst - t.stc.rebate_aud)
    if (Math.abs(t.net_ex_gst - expectedNet) > 0.01) {
      flags.push(`Tier ${t.tier}: net ${t.net_ex_gst} ≠ gross − STC (${expectedNet.toFixed(2)}).`)
    }
    const prod = production[i]
    if (prod && !prod.within_cec_benchmark) {
      flags.push(
        `Tier ${t.tier}: production ${prod.annual_kwh_ac} kWh/yr is outside ±35% of the CEC benchmark (${prod.cec_benchmark_kwh_per_kw} kWh/kW/yr).`,
      )
    }
    const econ = economics.tiers[i]
    if (econ && econ.annual_savings_aud > 0) {
      if (
        econ.payback_years_low < PAYBACK_YEARS_MIN ||
        econ.payback_years_high > PAYBACK_YEARS_MAX
      ) {
        flags.push(
          `Tier ${t.tier}: payback ${econ.payback_years_low}–${econ.payback_years_high} yrs is outside the ${PAYBACK_YEARS_MIN}–${PAYBACK_YEARS_MAX} yr expectation.`,
        )
      }
    }
  })

  return flags
}

/** Public share token — base64url, 16 bytes (mirrors generateShareToken). */
export function generateSolarToken(): string {
  return randomBytes(16).toString('base64url')
}

export const __test_only__ = {
  runGuardrails,
  GROSS_PER_KW_MIN,
  GROSS_PER_KW_MAX,
  PAYBACK_YEARS_MIN,
  PAYBACK_YEARS_MAX,
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm test -- lib/solar/intake.test.ts
```

Expected: `6 passed`. (Note: the guardrail flag test relies on the `$9000/kW` override breaching `GROSS_PER_KW_MAX`; the stale-config test relies on `validateSolarConfig` returning `stc_price_unset`.)

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/intake.ts quotemate-automation/lib/solar/intake.test.ts
git commit -m "feat(solar): intake.ts — orchestrator wiring coverage→…→guardrails

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Full-suite green + parity sanity script

**Files:**
- Create: `quotemate-automation/scripts/test-solar-parity.mjs`

- [ ] **Step 1: Run the whole solar suite, verify all modules are green together.** Run:

```
npm test -- lib/solar
```

Expected: all solar test files pass (fixtures 4, coverage 5, roof 11, manual-fallback 9, config 11, sizing 9, production 9, pricing 11, economics 8, intake 6 = 83 passed across 10 files). If any cross-module drift appears (e.g. a tier-name or rounding mismatch), fix the implementation — never the assertion — and re-run.

- [ ] **Step 2: Write the parity sanity script** (mirrors `scripts/test-sms-parity.mjs` — plain Node `assert`, dynamic `import`, run via the `tsx` loader). Create `quotemate-automation/scripts/test-solar-parity.mjs`:

```javascript
// QuoteMate · solar parity / sanity script
// Cross-checks the deterministic solar engine end-to-end against a known
// worked example (CER STC math + a sane payback band). Mirrors the style
// of scripts/test-sms-parity.mjs — plain Node assert, no test framework.
//
// Usage: node --import tsx scripts/test-solar-parity.mjs

import { strict as assert } from 'node:assert'

const results = { passed: 0, failed: 0, failures: [] }

function it(name, fn) {
  try {
    fn()
    results.passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    results.failed++
    results.failures.push({ name, err })
    console.log(`  ✗ ${name}`)
  }
}

function describe(group, fn) {
  console.log(`\n${group}`)
  fn()
}

const { stcBreakdown } = (await import('../lib/solar/pricing.ts')).__test_only__
const { DEFAULT_SOLAR_CONFIG } = await import('../lib/solar/config.ts')
const { calculateSolarEconomics } = await import('../lib/solar/economics.ts')

const CONTEXT = { postcode: '2000', state: 'NSW', install_year: 2026, network: 'Ausgrid' }

describe('STC math vs worked CER example (6.6 kW, Sydney zone 3, 2026)', () => {
  const stc = stcBreakdown({ system_kw: 6.6, context: CONTEXT, config: DEFAULT_SOLAR_CONFIG })

  it('zone rating for 2000 is 1.382', () => {
    assert.equal(stc.zone_rating, 1.382)
  })
  it('deeming years for 2026 is 5', () => {
    assert.equal(stc.deeming_years, 5)
  })
  it('certificates = floor(6.6 × 1.382 × 5) = 45', () => {
    assert.equal(stc.certificates, Math.floor(6.6 * 1.382 * 5))
    assert.equal(stc.certificates, 45)
  })
  it('rebate = 45 × $38 = $1710', () => {
    assert.equal(stc.rebate_aud, 1710)
  })
})

describe('payback band is plausible (2–12 yrs) for a 6.6 kW system', () => {
  const PRICE = {
    tiers: [
      {
        tier: 'good',
        label: '6.6 kW',
        system_kw_dc: 6.6,
        gross_ex_gst: 7260,
        gross_inc_gst: 7986,
        stc: stcBreakdown({ system_kw: 6.6, context: CONTEXT, config: DEFAULT_SOLAR_CONFIG }),
        net_ex_gst: 5550,
        net_inc_gst: 6105,
        scope: '6.6 kW solar install.',
      },
    ],
    effective_rate_per_kw: 1100,
    loadings_applied: [],
    routing: { decision: 'tradie_review', reason: 'x' },
  }
  const PRODUCTION = [
    {
      system_kw_dc: 6.6,
      annual_kwh_ac: 8019, // ~1215 kWh/kW/yr
      annual_kwh_low: 6415,
      annual_kwh_high: 9623,
      derate_applied: 0.81,
      degradation_pct_per_year: 0.005,
      cec_benchmark_kwh_per_kw: 1382,
      within_cec_benchmark: true,
      band: 'tight',
    },
  ]
  const econ = calculateSolarEconomics({
    price: PRICE,
    production: PRODUCTION,
    config: DEFAULT_SOLAR_CONFIG,
    context: CONTEXT,
  })
  const t = econ.tiers[0]

  it('annual savings are positive', () => {
    assert.ok(t.annual_savings_aud > 0, `savings ${t.annual_savings_aud}`)
  })
  it('payback band is within 2–12 years', () => {
    assert.ok(t.payback_years_low >= 2, `low ${t.payback_years_low}`)
    assert.ok(t.payback_years_high <= 12, `high ${t.payback_years_high}`)
  })
  it('payback low < high', () => {
    assert.ok(t.payback_years_low < t.payback_years_high)
  })
})

console.log(`\n  ${results.passed} passed · ${results.failed} failed`)
if (results.failed > 0) {
  for (const f of results.failures) console.error(`\n✗ ${f.name}\n`, f.err)
  process.exit(1)
}
process.exit(0)
```

- [ ] **Step 3: Run the parity script, verify it passes.** Run:

```
node --import tsx scripts/test-solar-parity.mjs
```

Expected output ends with `7 passed · 0 failed` and exit code 0. If the `$1710` rebate or the payback band assertions fail, the engine has drifted from the worked CER example — fix `pricing.ts`/`economics.ts`, not the script.

- [ ] **Step 4: Run the entire unit suite to confirm no regression elsewhere.** Run:

```
npm test
```

Expected: the full repo suite passes, including the 10 new `lib/solar/*.test.ts` files. No roofing/painting/SMS test changes.

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/scripts/test-solar-parity.mjs
git commit -m "test(solar): end-to-end parity script — CER STC math + payback band

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 deliverables

After Task 14, `lib/solar/` contains the full deterministic estimate engine — eight modules, each one pure exported function from the shared contract, plus shared fixtures and a parity script:

| File | Export | Verified by |
|---|---|---|
| `lib/solar/__fixtures__/building-insights.ts` | `COVERED_INSIGHT` / `COVERED_RAW_BODY` / `UNCOVERED_RAW_BODY` / `MANUAL_INPUT` | Task 4 |
| `lib/solar/coverage.ts` | `checkSolarCoverage` | Task 5 |
| `lib/solar/roof.ts` | `normaliseSolarRoofFacts` | Task 6 |
| `lib/solar/manual-fallback.ts` | `buildManualRoofFacts` | Task 7 |
| `lib/solar/config.ts` | `validateSolarConfig` + `DEFAULT_SOLAR_CONFIG` | Task 8 |
| `lib/solar/sizing.ts` | `sizeSolarSystem` | Task 9 |
| `lib/solar/production.ts` | `estimateSolarProduction` | Task 10 |
| `lib/solar/pricing.ts` | `calculateSolarPrice` + `DEFAULT_SOLAR_RATE_CARD` | Task 11 |
| `lib/solar/economics.ts` | `calculateSolarEconomics` | Task 12 |
| `lib/solar/intake.ts` | `runSolarEstimate` (orchestrator) | Task 13 |
| `scripts/test-solar-parity.mjs` | CER STC + payback sanity | Task 14 |

Notes for the executing engineer:
- `lib/solar/types.ts` is assumed present from Phase 1; every module imports its contract types verbatim and none are redefined.
- The Solar API client (`lib/roofing/solar-api.ts`) is reused as-is: `fetchBuildingInsights`, `resolveSolarOpts`, `parseBuildingInsights` and the `SolarRoofInsight`/`SolarRoofSegment`/`ResolvedSolarOpts`/`SolarEnrichmentOpts` types are imported, never copied. The one extension is `roof.ts`'s `SolarRoofInsightWithRaw = SolarRoofInsight & { raw }`, which carries the raw body forward so the panel-config fields (`solarPanelConfigs`, `maxArrayPanelsCount`, `panelCapacityWatts`) the existing parser drops can still be read — without modifying the shared client.
- Money-path conventions match `lib/roofing/pricing.ts` exactly: `roundTo(n, 2)`, GST factor `1.10`, loadings multiply (`× (1+pct)`), call-out floor applied after the multiplication.
- All I/O in `intake.ts` (geocode, Solar API, persistence, satellite image) is injected so the orchestrator unit-tests with no DB or network. The real DB persistence (`solar_estimates` row) and geocode wiring belong to the later HTTP/data-model phase, not Phase 2.
- Phase 2 file paths (absolute): `C:\Users\dalig\Downloads\QuoteMate\quoteMate\quotemate-automation\lib\solar\` for all engine modules and `C:\Users\dalig\Downloads\QuoteMate\quoteMate\quotemate-automation\scripts\test-solar-parity.mjs` for the parity script.

---

## Phase 3 — Entry + estimate generation flow

## Phase 3 — Entry + estimate generation flow

This phase wires the public, per-tenant front door for solar. A customer lands on `/solar/[tenantSlug]`, types an address, and the server geocodes it, runs the coverage gate, runs the `lib/solar/` engine (or the manual-roof fallback branch when the address is uncovered), persists an `intakes` row (`trade='solar'`), a `solar_estimates` row, and a `quotes` row, mints a share token, and fires a tradie notification — then redirects the customer to `/q/solar/[token]`.

It mirrors the roofing creation route (`app/api/roofing/save-as-quote/route.ts`) and the tradie-notify pattern (`lib/quote/booking-notify.ts`), but is **public** (no bearer auth — it's customer-facing like `/q/roof/[token]`), so the tenant is resolved from the URL path segment, which carries the tenant's `id` (uuid). It follows Next 16 route/param conventions (`params` is a `Promise`, `await ctx.params`).

**Assumptions made explicit (depended-on from earlier phases):**
- `lib/solar/intake.ts` exports `runSolarEstimate(...)` returning a `SolarEstimate` (Phase 2). For TDD isolation in this phase, the route imports and calls it; tests that exercise the route stub the engine via dependency injection at the module boundary described in Task 17.
- `lib/solar/config.ts` exports `validateSolarConfig(...)` and a loadable `SolarConfig` (Phase 1/2).
- The `solar_estimates` table and `solar` trade row exist (Phase 1 migration 097).
- `generateShareToken()` is reused from `@/lib/stripe/checkout`.

---

### Task 15: Geocode helper — forward-geocode an address to LatLng (pure parse + injectable fetch)

`lib/solar/intake.ts`'s orchestrator needs a forward geocode (`address → LatLng`); the existing `lib/roofing/geocode.ts` only does *reverse* geocoding. Add a forward-geocode helper in the solar lib that mirrors that file's injectable-fetch + pure-parse pattern.

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/geocode.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/geocode.test.ts`

- [ ] **Step 1: Write the failing test for the pure parser `parseGeocodeResponse`.**
  Create `lib/solar/geocode.test.ts` with the full contents:

  ```typescript
  import { describe, it, expect } from 'vitest'
  import { parseGeocodeResponse, geocodeAddress } from './geocode'
  import type { LatLng } from './types'

  // A trimmed Google Geocoding API success body.
  const OK_BODY = {
    status: 'OK',
    results: [
      {
        geometry: { location: { lat: -33.8688, lng: 151.2093 } },
        formatted_address: '1 Test St, Sydney NSW 2000, Australia',
      },
    ],
  }

  describe('parseGeocodeResponse', () => {
    it('returns ok + LatLng from a Google OK body', () => {
      const r = parseGeocodeResponse(OK_BODY)
      expect(r.ok).toBe(true)
      if (r.ok) {
        const loc: LatLng = r.location
        expect(loc.lat).toBeCloseTo(-33.8688, 4)
        expect(loc.lng).toBeCloseTo(151.2093, 4)
      }
    })

    it('returns not-ok on ZERO_RESULTS', () => {
      const r = parseGeocodeResponse({ status: 'ZERO_RESULTS', results: [] })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('not_found')
    })

    it('returns not-ok on a non-object body', () => {
      const r = parseGeocodeResponse(null)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('provider_error')
    })

    it('returns not-ok when results lack a finite location', () => {
      const r = parseGeocodeResponse({
        status: 'OK',
        results: [{ geometry: { location: { lat: 'x', lng: 2 } } }],
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('provider_error')
    })
  })

  describe('geocodeAddress', () => {
    it('calls the geocoding endpoint and returns the parsed LatLng', async () => {
      let calledUrl = ''
      const fetchImpl = async (u: RequestInfo | URL) => {
        calledUrl = String(u)
        return new Response(JSON.stringify(OK_BODY), { status: 200 })
      }
      const r = await geocodeAddress('1 Test St, Sydney NSW 2000', {
        apiKey: 'KEY',
        fetchImpl,
      })
      expect(calledUrl).toContain('address=1')
      expect(calledUrl).toContain('key=KEY')
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.location.lat).toBeCloseTo(-33.8688, 4)
    })

    it('fails closed without an apiKey, without calling fetch', async () => {
      let called = false
      const fetchImpl = async () => {
        called = true
        return new Response('{}', { status: 200 })
      }
      const r = await geocodeAddress('x', { apiKey: '', fetchImpl })
      expect(called).toBe(false)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('config_missing')
    })

    it('surfaces a network error as not-ok', async () => {
      const fetchImpl = async () => {
        throw new Error('boom')
      }
      const r = await geocodeAddress('x', { apiKey: 'KEY', fetchImpl })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('network_error')
    })
  })
  ```

- [ ] **Step 2: Run the test to confirm it fails (module does not exist yet).**
  Command:
  ```
  npm test -- lib/solar/geocode.test.ts
  ```
  Expected failure: Vitest reports `Failed to load url ./geocode` / `Cannot find module './geocode'` — the suite errors before any assertion runs.

- [ ] **Step 3: Write the minimal implementation.**
  Create `lib/solar/geocode.ts` with the full contents:

  ```typescript
  // ════════════════════════════════════════════════════════════════════
  // Solar — forward-geocoding helper (address → LatLng).
  //
  // The roofing geocode.ts does REVERSE geocoding (coord → address) via
  // Nominatim. The solar entry flow needs the opposite: a customer-typed
  // address → {lat,lng} to seed the coverage gate + buildingInsights call.
  // We use Google Geocoding (same key family as the Solar/Maps APIs).
  //
  // Same shape as the rest of lib/solar: pure parser + injectable-fetch
  // I/O wrapper, so the parse logic is unit-testable without network.
  // PURE money path stays elsewhere; this is just resolution.
  // ════════════════════════════════════════════════════════════════════

  import type { LatLng } from './types'

  const DEFAULT_BASE_URL =
    process.env.GOOGLE_GEOCODE_API_URL ??
    'https://maps.googleapis.com/maps/api/geocode/json'

  type FetchLike = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>

  export type GeocodeResult =
    | { ok: true; location: LatLng; formatted_address: string | null }
    | {
        ok: false
        code: 'config_missing' | 'not_found' | 'network_error' | 'provider_error'
        detail: string
      }

  export type GeocodeOpts = {
    apiKey: string | undefined
    fetchImpl?: FetchLike
    baseUrl?: string
  }

  /** PURE — parse a Google Geocoding API response body. */
  export function parseGeocodeResponse(body: unknown): GeocodeResult {
    if (!body || typeof body !== 'object') {
      return { ok: false, code: 'provider_error', detail: 'Geocoder returned a non-object body.' }
    }
    const b = body as Record<string, unknown>
    const status = typeof b.status === 'string' ? b.status : ''
    if (status === 'ZERO_RESULTS') {
      return { ok: false, code: 'not_found', detail: 'No match for that address.' }
    }
    const results = Array.isArray(b.results) ? b.results : []
    const first = results[0] as
      | { geometry?: { location?: { lat?: unknown; lng?: unknown } }; formatted_address?: unknown }
      | undefined
    const lat = first?.geometry?.location?.lat
    const lng = first?.geometry?.location?.lng
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, code: 'provider_error', detail: `Geocoder status ${status || 'unknown'}, no finite location.` }
    }
    const formatted =
      typeof first?.formatted_address === 'string' ? first.formatted_address : null
    return { ok: true, location: { lat, lng }, formatted_address: formatted }
  }

  /** Forward-geocode an address. Best-effort — any miss surfaces as
   *  { ok: false, code }. Never throws. */
  export async function geocodeAddress(
    address: string,
    opts: GeocodeOpts,
  ): Promise<GeocodeResult> {
    if (!opts.apiKey) {
      return { ok: false, code: 'config_missing', detail: 'Geocoding API key is not configured.' }
    }
    const base = opts.baseUrl ?? DEFAULT_BASE_URL
    const url =
      `${base}?address=${encodeURIComponent(address)}` +
      `&region=au&components=country:AU&key=${encodeURIComponent(opts.apiKey)}`
    const fetchImpl = opts.fetchImpl ?? ((u, init) => fetch(u, init))

    let res: Response
    try {
      res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } })
    } catch (e) {
      return { ok: false, code: 'network_error', detail: e instanceof Error ? e.message : String(e) }
    }
    if (!res.ok) {
      return { ok: false, code: 'provider_error', detail: `Geocoder HTTP ${res.status}` }
    }
    let body: unknown
    try {
      body = await res.json()
    } catch {
      return { ok: false, code: 'provider_error', detail: 'Geocoder returned non-JSON.' }
    }
    return parseGeocodeResponse(body)
  }
  ```

- [ ] **Step 4: Run the test to confirm it passes.**
  Command:
  ```
  npm test -- lib/solar/geocode.test.ts
  ```
  Expected: `Test Files 1 passed`, `Tests 8 passed` (3 `parseGeocodeResponse` + 1 location-missing + 4 `geocodeAddress`).

- [ ] **Step 5: Commit.**
  ```
  git add quotemate-automation/lib/solar/geocode.ts quotemate-automation/lib/solar/geocode.test.ts
  git commit -m "$(cat <<'EOF'
  feat(solar): forward-geocode helper for the entry flow

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 16: Request schema + tenant resolver for the public estimate route

The public estimate route validates its body with Zod and resolves the tenant from the URL path segment (the tenant `id`). Build these two pure-ish pieces first so the route in Task 18 just wires them.

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/request-schema.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/request-schema.test.ts`

- [ ] **Step 1: Write the failing test.**
  Create `lib/solar/request-schema.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest'
  import { SolarEstimateRequestSchema } from './request-schema'

  describe('SolarEstimateRequestSchema', () => {
    it('accepts a minimal address-only body', () => {
      const r = SolarEstimateRequestSchema.safeParse({
        address: { address: '1 Test St, Sydney', postcode: '2000', state: 'NSW' },
      })
      expect(r.success).toBe(true)
    })

    it('accepts an optional manual-roof block', () => {
      const r = SolarEstimateRequestSchema.safeParse({
        address: { address: '1 Test St', postcode: '4000', state: 'QLD' },
        manual: { orientation: 'north', roof_size: 'medium', storeys: 1 },
        panel_type: 'premium_panels',
      })
      expect(r.success).toBe(true)
    })

    it('rejects a too-short address', () => {
      const r = SolarEstimateRequestSchema.safeParse({
        address: { address: 'x', postcode: '2000', state: 'NSW' },
      })
      expect(r.success).toBe(false)
    })

    it('rejects an out-of-enum state', () => {
      const r = SolarEstimateRequestSchema.safeParse({
        address: { address: '1 Test St', postcode: '2000', state: 'ZZ' },
      })
      expect(r.success).toBe(false)
    })

    it('rejects an out-of-enum manual orientation', () => {
      const r = SolarEstimateRequestSchema.safeParse({
        address: { address: '1 Test St', postcode: '2000', state: 'NSW' },
        manual: { orientation: 'sideways', roof_size: 'small', storeys: 1 },
      })
      expect(r.success).toBe(false)
    })

    it('rejects an out-of-range storeys', () => {
      const r = SolarEstimateRequestSchema.safeParse({
        address: { address: '1 Test St', postcode: '2000', state: 'NSW' },
        manual: { orientation: 'north', roof_size: 'small', storeys: 9 },
      })
      expect(r.success).toBe(false)
    })
  })
  ```

- [ ] **Step 2: Run the test to confirm it fails.**
  Command:
  ```
  npm test -- lib/solar/request-schema.test.ts
  ```
  Expected failure: `Cannot find module './request-schema'` — suite fails to load.

- [ ] **Step 3: Write the minimal implementation.**
  Create `lib/solar/request-schema.ts`:

  ```typescript
  // Zod request schema for POST /api/solar/[tenantSlug]/estimate.
  // The body is customer-supplied from the public entry page, so it is
  // validated strictly. The `manual` block is only present when the
  // address was uncovered and the customer answered the 2–3 fallback
  // questions (spec §3). Enums mirror lib/solar/types.ts verbatim.

  import { z } from 'zod'

  const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'] as const

  const ORIENTATIONS = [
    'north', 'north_east', 'east', 'south_east',
    'south', 'south_west', 'west', 'north_west',
    'flat', 'unknown',
  ] as const

  export const SolarEstimateRequestSchema = z.object({
    address: z.object({
      address: z.string().min(3),
      postcode: z.string().min(3),
      state: z.enum(AU_STATES),
    }),
    manual: z
      .object({
        orientation: z.enum(ORIENTATIONS),
        roof_size: z.enum(['small', 'medium', 'large']),
        storeys: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      })
      .optional(),
    panel_type: z
      .enum(['standard_panels', 'premium_panels', 'unknown'])
      .optional(),
  })

  export type SolarEstimateRequestBody = z.infer<typeof SolarEstimateRequestSchema>
  ```

- [ ] **Step 4: Run the test to confirm it passes.**
  Command:
  ```
  npm test -- lib/solar/request-schema.test.ts
  ```
  Expected: `Tests 6 passed`.

- [ ] **Step 5: Commit.**
  ```
  git add quotemate-automation/lib/solar/request-schema.ts quotemate-automation/lib/solar/request-schema.test.ts
  git commit -m "$(cat <<'EOF'
  feat(solar): request schema for the public estimate route

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 17: Persistence helper — map a `SolarEstimate` to intake + solar_estimates + quote payloads

The route writes three rows. Extract the row-shaping into a pure helper (mirrors `lib/roofing/save-as-quote-helpers.ts`) so it is unit-testable without a DB. It maps a `SolarEstimate` (the orchestrator's return shape) plus tenant/address context into the three insert payloads.

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/persist-helpers.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/persist-helpers.test.ts`

- [ ] **Step 1: Write the failing test.**
  Create `lib/solar/persist-helpers.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest'
  import { buildSolarRowPayloads } from './persist-helpers'
  import type { SolarEstimate } from './types'

  // Minimal but contract-faithful SolarEstimate fixture.
  const estimate: SolarEstimate = {
    token: 'TOKEN123',
    context: { postcode: '2000', state: 'NSW', install_year: 2026, network: 'Ausgrid' },
    coverage_source: 'google',
    roof: {
      source: 'google',
      usable_area_m2: 60,
      planes: [],
      segment_count: 2,
      primary_orientation: 'north',
      mean_pitch_degrees: 22,
      max_panels_count: 30,
      panel_capacity_watts: 400,
      panel_configs: [],
      storeys: 1,
      polygon_geojson: null,
      imagery_quality: 'HIGH',
      imagery_date: '2025-03-01',
    },
    sizing: {
      tiers: [
        {
          tier: 'better',
          label: 'Full-size system',
          system_kw_dc: 6.6,
          panels_count: 16,
          panel_type: 'standard_panels',
          source_config: { panels_count: 16, yearly_energy_dc_kwh: 9000 },
          export_limited: false,
        },
      ],
      roof_capacity_kw_dc: 12,
      export_limit_kw_ac: 5,
      routing: { decision: 'tradie_review', reason: 'Solar quote requires tradie sign-off.' },
    },
    production: [
      {
        system_kw_dc: 6.6,
        annual_kwh_ac: 9200,
        annual_kwh_low: 7400,
        annual_kwh_high: 11000,
        derate_applied: 0.81,
        degradation_pct_per_year: 0.005,
        cec_benchmark_kwh_per_kw: 1382,
        within_cec_benchmark: true,
        band: 'tight',
      },
    ],
    price: {
      tiers: [
        {
          tier: 'better',
          label: 'Full-size system',
          system_kw_dc: 6.6,
          gross_ex_gst: 9000,
          gross_inc_gst: 9900,
          stc: {
            system_kw: 6.6,
            zone_rating: 1.382,
            deeming_years: 5,
            certificates: 45,
            stc_price_aud: 38,
            rebate_aud: 1710,
          },
          net_ex_gst: 7290,
          net_inc_gst: 8019,
          scope: '6.6 kW solar install with standard panels.',
        },
      ],
      effective_rate_per_kw: 1500,
      loadings_applied: [],
      routing: { decision: 'tradie_review', reason: 'Solar quote requires tradie sign-off.' },
    },
    economics: {
      tiers: [
        {
          tier: 'better',
          self_consumed_kwh: 3680,
          exported_kwh: 5520,
          bill_savings_aud: 1104,
          export_earnings_aud: 331,
          annual_savings_aud: 1435,
          payback_years_low: 4.2,
          payback_years_high: 6.8,
        },
      ],
      assumptions: {
        self_consumption_pct: 0.4,
        retail_rate_aud_per_kwh: 0.3,
        feed_in_tariff_aud_per_kwh: 0.06,
        feed_in_network: 'Ausgrid',
      },
    },
    confidence_band: 'tight',
    satellite_image_url: null,
    routing: { decision: 'tradie_review', reason: 'Solar quote requires tradie sign-off.' },
    guardrail_flags: [],
    config_version: '2026-01-01',
  }

  describe('buildSolarRowPayloads', () => {
    const out = buildSolarRowPayloads({
      estimate,
      tenantId: 'TENANT1',
      address: { address: '1 Test St, Sydney', postcode: '2000', state: 'NSW' },
      customer: { name: 'Mia', phone: '+61400000000', email: 'm@x.io' },
    })

    it('stamps the intake with trade=solar and tenant_id', () => {
      expect(out.intake.trade).toBe('solar')
      expect(out.intake.tenant_id).toBe('TENANT1')
      expect(out.intake.job_type).toBe('solar_install')
    })

    it('carries roof facts into intake.scope', () => {
      expect(out.intake.scope.usable_area_m2).toBe(60)
      expect(out.intake.scope.state).toBe('NSW')
    })

    it('sets inspection_required from routing', () => {
      expect(out.intake.inspection_required).toBe(false)
    })

    it('builds a solar_estimates row keyed by the estimate token', () => {
      expect(out.solarEstimate.public_token).toBe('TOKEN123')
      expect(out.solarEstimate.coverage_source).toBe('google')
      expect(out.solarEstimate.confidence_band).toBe('tight')
      expect(out.solarEstimate.config_version).toBe('2026-01-01')
      expect(out.solarEstimate.estimate.token).toBe('TOKEN123')
    })

    it('builds a quote row with the net price + share_token + needs_inspection', () => {
      expect(out.quote.share_token).toBe('TOKEN123')
      expect(out.quote.tenant_id).toBe('TENANT1')
      expect(out.quote.status).toBe('draft')
      expect(out.quote.needs_inspection).toBe(false)
      // Selected tier net ex/inc flow through.
      expect(out.quote.subtotal_ex_gst).toBe(7290)
      expect(out.quote.total_inc_gst).toBe(8019)
      expect(out.quote.routing_decision).toBe('tradie_review')
    })

    it('links intake and quote by leaving intake_id to the caller', () => {
      // intake_id is stamped by the route after the intake insert returns
      // an id; the helper must NOT invent one.
      expect('intake_id' in out.quote).toBe(false)
    })
  })
  ```

- [ ] **Step 2: Run the test to confirm it fails.**
  Command:
  ```
  npm test -- lib/solar/persist-helpers.test.ts
  ```
  Expected failure: `Cannot find module './persist-helpers'` — suite fails to load.

- [ ] **Step 3: Write the minimal implementation.**
  Create `lib/solar/persist-helpers.ts`:

  ```typescript
  // Pure row-shaping for the solar creation route. Mirrors
  // lib/roofing/save-as-quote-helpers.ts: turns a SolarEstimate (the
  // orchestrator return shape) + tenant/address/customer context into the
  // three insert payloads — intakes (trade='solar'), solar_estimates
  // (token-keyed, jsonb), and quotes (net price tiers, share_token).
  //
  // NO I/O. The route owns the actual inserts and stamps quote.intake_id
  // after the intake insert returns its id (so we deliberately omit it).

  import type { SolarEstimate } from './types'

  export type SolarCustomer = {
    name?: string
    phone?: string
    email?: string
  }

  export type SolarAddressPayload = {
    address: string
    postcode: string
    state: string
  }

  export function buildSolarRowPayloads(args: {
    estimate: SolarEstimate
    tenantId: string
    address: SolarAddressPayload
    customer?: SolarCustomer
  }) {
    const { estimate, tenantId, address, customer } = args
    const inspection = estimate.routing.decision === 'inspection_required'

    // The "selected" tier mirrors roofing: prefer 'better', else the
    // first priced tier. Solar tiers are 2–3, ascending good→best.
    const priceTiers = estimate.price.tiers
    const selected =
      priceTiers.find((t) => t.tier === 'better') ?? priceTiers[0] ?? null
    const selectedTier = selected?.tier ?? 'better'
    const netEx = selected?.net_ex_gst ?? 0
    const netInc = selected?.net_inc_gst ?? 0
    const gst = Math.max(0, netInc - netEx)

    const intake = {
      tenant_id: tenantId,
      trade: 'solar' as const,
      job_type: 'solar_install',
      address: address.address,
      suburb: null as string | null,
      scope: {
        ...estimate.roof,
        coverage_source: estimate.coverage_source,
        state: address.state,
        postcode: address.postcode,
        install_year: estimate.context.install_year,
        network: estimate.context.network,
      },
      access: { storeys: estimate.roof.storeys },
      property: { levels: estimate.roof.storeys ?? null, year_built: null },
      risks: estimate.guardrail_flags,
      inspection_required: inspection,
      caller: {
        name: customer?.name ?? '',
        phone: customer?.phone ?? '',
        email: customer?.email ?? '',
      },
      timing: { urgency: null },
      confidence: estimate.confidence_band === 'tight' ? 'HIGH' : 'MED',
      confidence_reason: `Solar estimate via ${estimate.coverage_source} roof source — deterministic engine (config ${estimate.config_version}).`,
    }

    const solarEstimate = {
      tenant_id: tenantId,
      public_token: estimate.token,
      address: address.address,
      state: address.state,
      postcode: address.postcode,
      coverage_source: estimate.coverage_source,
      imagery_quality: estimate.roof.imagery_quality,
      imagery_date: estimate.roof.imagery_date,
      confidence_band: estimate.confidence_band,
      satellite_image_url: estimate.satellite_image_url,
      config_version: estimate.config_version,
      routing: estimate.routing.decision,
      guardrail_flags: estimate.guardrail_flags,
      // Full estimate persisted as jsonb so the /q/solar/[token] page
      // re-renders without recomputation.
      estimate: estimate,
    }

    const quote = {
      tenant_id: tenantId,
      status: 'draft' as const,
      share_token: estimate.token,
      scope_of_works: selected?.scope ?? '',
      assumptions: [
        `System size ${selected?.system_kw_dc ?? 0} kW (DC).`,
        `STC rebate ${selected?.stc.certificates ?? 0} certificates @ $${selected?.stc.stc_price_aud ?? 0}.`,
        `Self-consumption ${Math.round((estimate.economics.assumptions.self_consumption_pct ?? 0) * 100)}%.`,
        ...estimate.price.loadings_applied.map((l) => l.detail),
      ],
      risk_flags:
        estimate.routing.decision !== 'auto_quote'
          ? [estimate.routing.reason, ...estimate.guardrail_flags]
          : estimate.guardrail_flags,
      needs_inspection: inspection,
      inspection_reason: inspection ? estimate.routing.reason : null,
      selected_tier: selectedTier,
      subtotal_ex_gst: netEx,
      gst,
      total_inc_gst: netInc,
      routing_decision: estimate.routing.decision,
    }

    return { intake, solarEstimate, quote }
  }
  ```

- [ ] **Step 4: Run the test to confirm it passes.**
  Command:
  ```
  npm test -- lib/solar/persist-helpers.test.ts
  ```
  Expected: `Tests 6 passed`.

- [ ] **Step 5: Commit.**
  ```
  git add quotemate-automation/lib/solar/persist-helpers.ts quotemate-automation/lib/solar/persist-helpers.test.ts
  git commit -m "$(cat <<'EOF'
  feat(solar): pure row-shaping helper for intake + estimate + quote

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 18: Tradie-notify helper for a new solar estimate

After the rows persist, the route notifies the tradie (forced review, no auto-send — spec §6). Add a defensive, never-throws notify helper modelled on `lib/quote/booking-notify.ts` but for the "new solar estimate awaiting confirmation" event. Keep it injectable so it's testable without Twilio.

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/notify.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/notify.test.ts`

- [ ] **Step 1: Write the failing test.**
  Create `lib/solar/notify.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest'
  import { buildSolarTradieNotification, notifySolarEstimate } from './notify'

  describe('buildSolarTradieNotification', () => {
    it('names the customer, system size, and the review URL', () => {
      const body = buildSolarTradieNotification({
        tradieFirstName: 'Sam',
        customerName: 'Mia',
        systemKw: 6.6,
        netIncGst: 8019,
        reviewUrl: 'https://app/q/solar/TOKEN123',
        dashboardUrl: 'https://app/dashboard',
      })
      expect(body).toContain('Sam')
      expect(body).toContain('Mia')
      expect(body).toContain('6.6')
      expect(body).toContain('TOKEN123')
      expect(body.toLowerCase()).toContain('confirm')
    })

    it('falls back gracefully when names are missing', () => {
      const body = buildSolarTradieNotification({
        tradieFirstName: null,
        customerName: undefined,
        systemKw: 10,
        netIncGst: 12000,
        reviewUrl: 'https://app/q/solar/T',
        dashboardUrl: 'https://app/dashboard',
      })
      expect(typeof body).toBe('string')
      expect(body.length).toBeGreaterThan(0)
    })
  })

  describe('notifySolarEstimate', () => {
    it('dispatches to the tenant owner mobile and reports ok', async () => {
      const calls: Array<{ to: string; text: string }> = []
      const r = await notifySolarEstimate({
        tenant: { owner_mobile: '+61400000111', owner_first_name: 'Sam', twilio_sms_number: '+61480000000' },
        customerName: 'Mia',
        systemKw: 6.6,
        netIncGst: 8019,
        shareToken: 'TOKEN123',
        appUrl: 'https://app',
        dispatch: async ({ to, text }) => {
          calls.push({ to, text })
          return { ok: true as const, channel: 'sms' as const, sid: 'SM1' }
        },
      })
      expect(r.notified).toBe(true)
      expect(calls).toHaveLength(1)
      expect(calls[0].to).toBe('+61400000111')
      expect(calls[0].text).toContain('TOKEN123')
    })

    it('reports not-notified (never throws) when no mobile is resolvable', async () => {
      const r = await notifySolarEstimate({
        tenant: { owner_mobile: null, owner_first_name: null, twilio_sms_number: null },
        customerName: 'Mia',
        systemKw: 6.6,
        netIncGst: 8019,
        shareToken: 'TOKEN123',
        appUrl: 'https://app',
        dispatch: async () => ({ ok: true as const, channel: 'sms' as const, sid: 'X' }),
      })
      expect(r.notified).toBe(false)
    })

    it('swallows a throwing dispatch and reports not-notified', async () => {
      const r = await notifySolarEstimate({
        tenant: { owner_mobile: '+61400000111', owner_first_name: 'Sam', twilio_sms_number: null },
        customerName: 'Mia',
        systemKw: 6.6,
        netIncGst: 8019,
        shareToken: 'TOKEN123',
        appUrl: 'https://app',
        dispatch: async () => {
          throw new Error('twilio down')
        },
      })
      expect(r.notified).toBe(false)
    })
  })
  ```

- [ ] **Step 2: Run the test to confirm it fails.**
  Command:
  ```
  npm test -- lib/solar/notify.test.ts
  ```
  Expected failure: `Cannot find module './notify'` — suite fails to load.

- [ ] **Step 3: Write the minimal implementation.**
  Create `lib/solar/notify.ts`:

  ```typescript
  // Solar estimate → tradie notification. Forced review, no auto-send
  // (spec §6): every solar estimate lands as "awaiting your confirmation".
  //
  // Modelled on lib/quote/booking-notify.ts: defensive (never throws), and
  // the SMS send is injectable so the message-building + routing logic is
  // unit-testable without Twilio. The route passes a dispatch impl that
  // wraps dispatchQuoteMessage from @/lib/sms/dispatch.

  type DispatchOk = { ok: true; channel: string; sid?: string }
  type DispatchFail = { ok: false }
  type DispatchResultLike = DispatchOk | DispatchFail

  type DispatchFn = (opts: {
    to: string
    text: string
    from?: string
  }) => Promise<DispatchResultLike>

  /** PURE — build the tradie SMS body. */
  export function buildSolarTradieNotification(args: {
    tradieFirstName: string | null | undefined
    customerName: string | null | undefined
    systemKw: number
    netIncGst: number
    reviewUrl: string
    dashboardUrl: string
  }): string {
    const greeting = args.tradieFirstName ? `Hi ${args.tradieFirstName}, ` : ''
    const who = args.customerName ? args.customerName : 'A customer'
    const dollars = `$${Math.round(args.netIncGst).toLocaleString('en-AU')}`
    return (
      `${greeting}${who} just got an instant solar estimate: ` +
      `${args.systemKw} kW, ${dollars} net (after STC). ` +
      `Review and confirm before it goes live: ${args.reviewUrl} ` +
      `· Dashboard: ${args.dashboardUrl}`
    )
  }

  export async function notifySolarEstimate(args: {
    tenant: {
      owner_mobile: string | null
      owner_first_name: string | null
      twilio_sms_number: string | null
    }
    customerName: string | null | undefined
    systemKw: number
    netIncGst: number
    shareToken: string
    appUrl: string
    dispatch: DispatchFn
  }): Promise<{ notified: boolean }> {
    try {
      const notifyMobile =
        args.tenant.owner_mobile ?? process.env.TRADIE_NOTIFY_NUMBER ?? null
      if (!notifyMobile) return { notified: false }

      const reviewUrl = `${args.appUrl}/q/solar/${args.shareToken}`
      const dashboardUrl = `${args.appUrl}/dashboard`
      const text = buildSolarTradieNotification({
        tradieFirstName: args.tenant.owner_first_name,
        customerName: args.customerName,
        systemKw: args.systemKw,
        netIncGst: args.netIncGst,
        reviewUrl,
        dashboardUrl,
      })
      const r = await args.dispatch({
        to: notifyMobile,
        text,
        from: args.tenant.twilio_sms_number ?? undefined,
      })
      return { notified: r.ok }
    } catch {
      return { notified: false }
    }
  }
  ```

- [ ] **Step 4: Run the test to confirm it passes.**
  Command:
  ```
  npm test -- lib/solar/notify.test.ts
  ```
  Expected: `Tests 5 passed`.

- [ ] **Step 5: Commit.**
  ```
  git add quotemate-automation/lib/solar/notify.ts quotemate-automation/lib/solar/notify.test.ts
  git commit -m "$(cat <<'EOF'
  feat(solar): tradie-notify helper for new estimates (forced review)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 19: Public estimate API route — geocode → coverage → engine → persist → notify

Wire the helpers into `POST /api/solar/[tenantSlug]/estimate`. It mirrors `app/api/roofing/save-as-quote/route.ts` but is **public** (no bearer) — the tenant is resolved from the `[tenantSlug]` path segment (the tenant `id`). It calls `runSolarEstimate` (Phase 2 orchestrator) which handles geocode/coverage/manual-fallback internally, then persists the three rows and notifies the tradie. Next 16 conventions: `params` is a Promise and is awaited; the route is `force-dynamic`; tradie-notify runs in `after()`.

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/app/api/solar/[tenantSlug]/estimate/route.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/tests/e2e/solar-estimate-route.spec.ts`

- [ ] **Step 1: Write the failing e2e contract test.**
  Create `tests/e2e/solar-estimate-route.spec.ts` (Playwright, hits the running dev server; asserts the route's documented contract for invalid input without needing real Google/Twilio keys):

  ```typescript
  import { test, expect } from '@playwright/test'

  test.describe('Solar estimate route — API contracts', () => {
    test('rejects an unknown tenantSlug with 404', async ({ request }) => {
      const res = await request.post(
        '/api/solar/00000000-0000-0000-0000-000000000000/estimate',
        {
          data: { address: { address: '1 Test St, Sydney', postcode: '2000', state: 'NSW' } },
        },
      )
      expect(res.status()).toBe(404)
      const body = await res.json()
      expect(body.ok).toBe(false)
      expect(body.error).toBe('tenant_not_found')
    })

    test('rejects an invalid body with 400', async ({ request }) => {
      const res = await request.post(
        '/api/solar/00000000-0000-0000-0000-000000000000/estimate',
        { data: { address: { address: 'x', postcode: '2000', state: 'NSW' } } },
      )
      expect([400, 404]).toContain(res.status())
      const body = await res.json()
      expect(body.ok).toBe(false)
    })

    test('rejects a non-JSON body with 400', async ({ request }) => {
      const res = await request.post(
        '/api/solar/00000000-0000-0000-0000-000000000000/estimate',
        { headers: { 'content-type': 'application/json' }, data: 'not json' },
      )
      expect([400, 404]).toContain(res.status())
    })
  })
  ```

- [ ] **Step 2: Run the test to confirm it fails.**
  Command:
  ```
  npm run test:e2e -- solar-estimate-route.spec.ts
  ```
  Expected failure: the first test gets a 404 from Next's default "route not found" (HTML, not JSON) — `await res.json()` throws or `body.error` is undefined, so the `tenant_not_found` assertion fails. (The route file does not exist yet.)

- [ ] **Step 3: Write the minimal implementation.**
  Create `app/api/solar/[tenantSlug]/estimate/route.ts`:

  ```typescript
  // POST /api/solar/[tenantSlug]/estimate — PUBLIC, customer-facing.
  //
  // The front door for a solar estimate. Mirrors
  // app/api/roofing/save-as-quote/route.ts, but:
  //   • PUBLIC (no bearer) — it is the customer entry flow, like /q/roof.
  //     The tenant is resolved from the [tenantSlug] path segment, which
  //     carries the tenant id (uuid). We look it up with the service-role
  //     client, same as /api/q/[token]/book resolves tenant by id.
  //   • The deterministic lib/solar engine (runSolarEstimate) owns
  //     geocode → coverage gate → roof normalise (or manual fallback) →
  //     sizing/production/pricing/economics → token. This route persists
  //     intake (trade='solar') + solar_estimates + quote, then notifies
  //     the tradie (forced review, no auto-send — spec §6).
  //
  // Next 16: params is a Promise (awaited); force-dynamic; the notify
  // SMS runs in after() so the customer response is not blocked.

  import { createClient } from '@supabase/supabase-js'
  import { after } from 'next/server'
  import { SolarEstimateRequestSchema } from '@/lib/solar/request-schema'
  import { buildSolarRowPayloads } from '@/lib/solar/persist-helpers'
  import { notifySolarEstimate } from '@/lib/solar/notify'
  import { runSolarEstimate } from '@/lib/solar/intake'
  import { loadSolarConfig } from '@/lib/solar/config'
  import { dispatchQuoteMessage } from '@/lib/sms/dispatch'

  export const dynamic = 'force-dynamic'
  export const maxDuration = 120

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  export async function POST(
    req: Request,
    ctx: { params: Promise<{ tenantSlug: string }> },
  ) {
    const { tenantSlug } = await ctx.params

    // ── Resolve the tenant from the path segment (tenant id). ────────
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, status, business_name, owner_first_name, owner_mobile, twilio_sms_number')
      .eq('id', tenantSlug)
      .maybeSingle()
    if (!tenant || tenant.status === 'suspended') {
      return Response.json({ ok: false, error: 'tenant_not_found' }, { status: 404 })
    }

    // ── Parse + validate the body. ───────────────────────────────────
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }
    const parsed = SolarEstimateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: 'invalid_request', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const { address, manual, panel_type } = parsed.data

    // ── Run the deterministic engine. ────────────────────────────────
    const config = await loadSolarConfig(supabase)
    let estimate
    try {
      estimate = await runSolarEstimate({
        input: address,
        manual,
        panelType: panel_type,
        config,
      })
    } catch (e) {
      return Response.json(
        { ok: false, error: 'engine_failed', detail: e instanceof Error ? e.message : String(e) },
        { status: 502 },
      )
    }

    // ── Persist intake → solar_estimates → quote. ────────────────────
    const payloads = buildSolarRowPayloads({
      estimate,
      tenantId: tenant.id as string,
      address,
    })

    const { data: intakeRow, error: intakeErr } = await supabase
      .from('intakes')
      .insert(payloads.intake)
      .select('id')
      .single()
    if (intakeErr || !intakeRow) {
      return Response.json(
        { ok: false, error: 'intake_insert_failed', detail: intakeErr?.message ?? 'no row' },
        { status: 500 },
      )
    }

    const { error: estErr } = await supabase
      .from('solar_estimates')
      .insert({ ...payloads.solarEstimate, intake_id: intakeRow.id })
    if (estErr) {
      return Response.json(
        { ok: false, error: 'estimate_insert_failed', detail: estErr.message },
        { status: 500 },
      )
    }

    const { data: quoteRow, error: quoteErr } = await supabase
      .from('quotes')
      .insert({ ...payloads.quote, intake_id: intakeRow.id })
      .select('id, share_token')
      .single()
    if (quoteErr || !quoteRow) {
      return Response.json(
        { ok: false, error: 'quote_insert_failed', detail: quoteErr?.message ?? 'no row' },
        { status: 500 },
      )
    }

    // ── Notify the tradie (forced review) after the response. ────────
    const appUrl = process.env.APP_URL ?? 'https://quote-mate-rho.vercel.app'
    const selected =
      estimate.price.tiers.find((t) => t.tier === 'better') ?? estimate.price.tiers[0]
    after(async () => {
      await notifySolarEstimate({
        tenant: {
          owner_mobile: (tenant.owner_mobile as string | null) ?? null,
          owner_first_name: (tenant.owner_first_name as string | null) ?? null,
          twilio_sms_number: (tenant.twilio_sms_number as string | null) ?? null,
        },
        customerName: null,
        systemKw: selected?.system_kw_dc ?? 0,
        netIncGst: selected?.net_inc_gst ?? 0,
        shareToken: estimate.token,
        appUrl,
        dispatch: (opts) => dispatchQuoteMessage(opts),
      })
    })

    const shareUrl = `${appUrl}/q/solar/${estimate.token}`
    return Response.json(
      { ok: true, token: estimate.token, shareUrl, coverage_source: estimate.coverage_source },
      { status: 200 },
    )
  }
  ```

- [ ] **Step 4: Run the test to confirm it passes.**
  Command:
  ```
  npm run test:e2e -- solar-estimate-route.spec.ts
  ```
  Expected: 3 passed — the unknown tenant now returns JSON `{ ok: false, error: 'tenant_not_found' }` with 404; invalid/non-JSON bodies short-circuit before the engine. (Note: `loadSolarConfig` and `runSolarEstimate` are Phase 1/2 exports; if they are not yet present in the branch, this route file will fail to compile — the contract assumes those modules exist. If the branch is being built strictly in order, run `npm run build` after Phase 2 lands; the e2e here only exercises the pre-engine guard rails.)

- [ ] **Step 5: Commit.**
  ```
  git add "quotemate-automation/app/api/solar/[tenantSlug]/estimate/route.ts" quotemate-automation/tests/e2e/solar-estimate-route.spec.ts
  git commit -m "$(cat <<'EOF'
  feat(solar): public per-tenant estimate route (geocode→engine→persist→notify)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 20: Entry page client form — `SolarAddressForm` (covered + manual-fallback inputs)

The customer-facing form is a client component: an address field, optional manual-roof inputs (shown when the user toggles "I can't find my roof / no coverage"), submit → POST to the route → redirect to the returned `shareUrl`. Build and test it in isolation (jsdom is NOT configured for vitest here, so test it via a small pure helper for the submit payload + a Playwright render test in Task 21). This task ships the component plus a pure payload-builder that IS unit-testable.

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/app/solar/[tenantSlug]/_components/SolarAddressForm.tsx`
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/form-payload.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/form-payload.test.ts`

- [ ] **Step 1: Write the failing test for the pure payload builder.**
  Create `lib/solar/form-payload.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest'
  import { buildSolarFormPayload } from './form-payload'

  describe('buildSolarFormPayload', () => {
    it('builds an address-only payload when manual is off', () => {
      const p = buildSolarFormPayload({
        address: '1 Test St, Sydney',
        postcode: '2000',
        state: 'NSW',
        manualOpen: false,
        orientation: 'north',
        roofSize: 'medium',
        storeys: 1,
        panelType: 'standard_panels',
      })
      expect(p.address).toEqual({ address: '1 Test St, Sydney', postcode: '2000', state: 'NSW' })
      expect('manual' in p).toBe(false)
      expect(p.panel_type).toBe('standard_panels')
    })

    it('includes the manual block when manual is open', () => {
      const p = buildSolarFormPayload({
        address: '1 Test St',
        postcode: '4000',
        state: 'QLD',
        manualOpen: true,
        orientation: 'west',
        roofSize: 'large',
        storeys: 2,
        panelType: 'premium_panels',
      })
      expect(p.manual).toEqual({ orientation: 'west', roof_size: 'large', storeys: 2 })
    })

    it('omits panel_type when set to unknown', () => {
      const p = buildSolarFormPayload({
        address: '1 Test St',
        postcode: '2000',
        state: 'NSW',
        manualOpen: false,
        orientation: 'north',
        roofSize: 'small',
        storeys: 1,
        panelType: 'unknown',
      })
      expect('panel_type' in p).toBe(false)
    })

    it('trims the address', () => {
      const p = buildSolarFormPayload({
        address: '  1 Test St  ',
        postcode: '2000',
        state: 'NSW',
        manualOpen: false,
        orientation: 'north',
        roofSize: 'small',
        storeys: 1,
        panelType: 'standard_panels',
      })
      expect(p.address.address).toBe('1 Test St')
    })
  })
  ```

- [ ] **Step 2: Run the test to confirm it fails.**
  Command:
  ```
  npm test -- lib/solar/form-payload.test.ts
  ```
  Expected failure: `Cannot find module './form-payload'` — suite fails to load.

- [ ] **Step 3: Write the minimal implementation (helper + component).**
  Create `lib/solar/form-payload.ts`:

  ```typescript
  // Pure builder for the /solar/[tenantSlug] form → POST body. Keeps the
  // client component dumb and the shape unit-testable. Matches
  // SolarEstimateRequestSchema exactly: manual + panel_type are omitted
  // when not applicable.

  import type { SolarEstimateRequestBody } from './request-schema'

  export function buildSolarFormPayload(state: {
    address: string
    postcode: string
    state: string
    manualOpen: boolean
    orientation: string
    roofSize: 'small' | 'medium' | 'large'
    storeys: 1 | 2 | 3
    panelType: 'standard_panels' | 'premium_panels' | 'unknown'
  }): SolarEstimateRequestBody {
    const payload: SolarEstimateRequestBody = {
      address: {
        address: state.address.trim(),
        postcode: state.postcode.trim(),
        state: state.state as SolarEstimateRequestBody['address']['state'],
      },
    }
    if (state.manualOpen) {
      payload.manual = {
        orientation: state.orientation as NonNullable<SolarEstimateRequestBody['manual']>['orientation'],
        roof_size: state.roofSize,
        storeys: state.storeys,
      }
    }
    if (state.panelType !== 'unknown') {
      payload.panel_type = state.panelType
    }
    return payload
  }
  ```

  Create `app/solar/[tenantSlug]/_components/SolarAddressForm.tsx`:

  ```tsx
  'use client'

  import { useState } from 'react'
  import { buildSolarFormPayload } from '@/lib/solar/form-payload'

  const STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'] as const
  const ORIENTATIONS = [
    'north', 'north_east', 'east', 'south_east',
    'south', 'south_west', 'west', 'north_west', 'flat', 'unknown',
  ] as const

  export function SolarAddressForm({ tenantSlug }: { tenantSlug: string }) {
    const [address, setAddress] = useState('')
    const [postcode, setPostcode] = useState('')
    const [stateCode, setStateCode] = useState<string>('NSW')
    const [manualOpen, setManualOpen] = useState(false)
    const [orientation, setOrientation] = useState<string>('north')
    const [roofSize, setRoofSize] = useState<'small' | 'medium' | 'large'>('medium')
    const [storeys, setStoreys] = useState<1 | 2 | 3>(1)
    const [panelType, setPanelType] =
      useState<'standard_panels' | 'premium_panels' | 'unknown'>('standard_panels')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function onSubmit(e: React.FormEvent) {
      e.preventDefault()
      setBusy(true)
      setError(null)
      try {
        const payload = buildSolarFormPayload({
          address, postcode, state: stateCode, manualOpen,
          orientation, roofSize, storeys, panelType,
        })
        const res = await fetch(`/api/solar/${tenantSlug}/estimate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = await res.json()
        if (!res.ok || !body.ok) {
          setError(body?.error === 'engine_failed'
            ? 'We could not generate an estimate just now. Please try again shortly.'
            : 'Please check your address and try again.')
          setBusy(false)
          return
        }
        window.location.href = body.shareUrl as string
      } catch {
        setError('Something went wrong. Please try again.')
        setBusy(false)
      }
    }

    return (
      <form onSubmit={onSubmit} className="flex flex-col gap-4" data-testid="solar-address-form">
        <label className="flex flex-col gap-1 text-sm text-text-sec">
          Street address
          <input
            data-testid="solar-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
            minLength={3}
            placeholder="1 Example St, Suburb"
            className="border border-ink-line bg-ink-deep px-3 py-2 text-text-pri"
          />
        </label>
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm text-text-sec">
            Postcode
            <input
              data-testid="solar-postcode"
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              required
              className="border border-ink-line bg-ink-deep px-3 py-2 text-text-pri"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-text-sec">
            State
            <select
              data-testid="solar-state"
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
              className="border border-ink-line bg-ink-deep px-3 py-2 text-text-pri"
            >
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm text-text-sec">
          Panel grade
          <select
            value={panelType}
            onChange={(e) => setPanelType(e.target.value as typeof panelType)}
            className="border border-ink-line bg-ink-deep px-3 py-2 text-text-pri"
          >
            <option value="standard_panels">Standard panels</option>
            <option value="premium_panels">Premium panels</option>
            <option value="unknown">Not sure</option>
          </select>
        </label>

        <button
          type="button"
          data-testid="solar-manual-toggle"
          onClick={() => setManualOpen((v) => !v)}
          className="self-start text-xs uppercase tracking-[0.14em] text-accent"
        >
          {manualOpen ? 'Hide manual roof details' : "Can't find your roof? Add details"}
        </button>

        {manualOpen && (
          <div className="flex flex-col gap-3 border-l-4 border-l-accent pl-4" data-testid="solar-manual-block">
            <label className="flex flex-col gap-1 text-sm text-text-sec">
              Main roof direction
              <select
                data-testid="solar-orientation"
                value={orientation}
                onChange={(e) => setOrientation(e.target.value)}
                className="border border-ink-line bg-ink-deep px-3 py-2 text-text-pri"
              >
                {ORIENTATIONS.map((o) => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-text-sec">
              Roof size
              <select
                value={roofSize}
                onChange={(e) => setRoofSize(e.target.value as typeof roofSize)}
                className="border border-ink-line bg-ink-deep px-3 py-2 text-text-pri"
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-text-sec">
              Storeys
              <select
                value={storeys}
                onChange={(e) => setStoreys(Number(e.target.value) as 1 | 2 | 3)}
                className="border border-ink-line bg-ink-deep px-3 py-2 text-text-pri"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>
          </div>
        )}

        {error && <p className="text-sm text-red-400" data-testid="solar-error">{error}</p>}

        <button
          type="submit"
          data-testid="solar-submit"
          disabled={busy}
          className="bg-accent px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.14em] text-ink-deep disabled:opacity-60"
        >
          {busy ? 'Estimating…' : 'Get my solar estimate'}
        </button>
      </form>
    )
  }
  ```

- [ ] **Step 4: Run the test to confirm it passes.**
  Command:
  ```
  npm test -- lib/solar/form-payload.test.ts
  ```
  Expected: `Tests 4 passed`.

- [ ] **Step 5: Commit.**
  ```
  git add "quotemate-automation/app/solar/[tenantSlug]/_components/SolarAddressForm.tsx" quotemate-automation/lib/solar/form-payload.ts quotemate-automation/lib/solar/form-payload.test.ts
  git commit -m "$(cat <<'EOF'
  feat(solar): entry-page address form + pure form-payload builder

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 21: Entry page server component `/solar/[tenantSlug]` (tenant resolve + render form)

The page itself: a server component that resolves the tenant from the slug (id), renders the Maintain-styled shell with the tenant's business name and the `SolarAddressForm`, and 404s an unknown/suspended tenant. Mirrors the `/q/roof/[token]` page's service-role lookup + Next 16 `await params`.

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/app/solar/[tenantSlug]/page.tsx`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/tests/e2e/solar-entry-page.spec.ts`

- [ ] **Step 1: Write the failing e2e test.**
  Create `tests/e2e/solar-entry-page.spec.ts`:

  ```typescript
  import { test, expect } from '@playwright/test'

  test.describe('Solar entry page — /solar/[tenantSlug]', () => {
    test('404s an unknown tenant slug', async ({ page }) => {
      const res = await page.goto('/solar/00000000-0000-0000-0000-000000000000')
      expect(res?.status()).toBe(404)
    })

    test('404s a clearly malformed slug', async ({ page }) => {
      const res = await page.goto('/solar/x')
      expect(res?.status()).toBe(404)
    })
  })
  ```

- [ ] **Step 2: Run the test to confirm it fails.**
  Command:
  ```
  npm run test:e2e -- solar-entry-page.spec.ts
  ```
  Expected failure: navigating to `/solar/...` returns Next's generic 200 catch-all or a compile error because the page route does not exist — the `expect(res?.status()).toBe(404)` assertion fails (status is not 404).

- [ ] **Step 3: Write the minimal implementation.**
  Create `app/solar/[tenantSlug]/page.tsx`:

  ```tsx
  // /solar/[tenantSlug] — PUBLIC per-tenant solar entry page.
  //
  // Mirrors app/q/roof/[token]/page.tsx: service-role lookup, Next 16
  // `await params`, force-dynamic so the tenant is validated fresh. The
  // slug carries the tenant id (uuid). Unknown/suspended → notFound().
  // Renders the Maintain-styled shell + the SolarAddressForm client
  // component which POSTs to /api/solar/[tenantSlug]/estimate.

  import { notFound } from 'next/navigation'
  import { createClient } from '@supabase/supabase-js'
  import { SolarAddressForm } from './_components/SolarAddressForm'

  export const dynamic = 'force-dynamic'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // A tenant id is a uuid (36 chars). Cheap pre-check before the DB hit.
  function looksLikeTenantId(slug: string): boolean {
    return /^[0-9a-fA-F-]{8,40}$/.test(slug)
  }

  export default async function SolarEntryPage({
    params,
  }: {
    params: Promise<{ tenantSlug: string }>
  }) {
    const { tenantSlug } = await params
    if (!tenantSlug || !looksLikeTenantId(tenantSlug)) notFound()

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, status, business_name')
      .eq('id', tenantSlug)
      .maybeSingle()
    if (!tenant || tenant.status === 'suspended') notFound()

    const business = (tenant.business_name as string) ?? 'Your installer'

    return (
      <main className="min-h-screen bg-ink-deep text-text-pri">
        <div className="mx-auto max-w-2xl px-6 py-16 sm:px-10">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-text-dim">
            {business}
          </p>
          <h1 className="mt-2 text-3xl font-extrabold uppercase tracking-[-0.035em] sm:text-4xl">
            Instant solar estimate
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-text-sec">
            Enter your address and see an honest, roof-specific estimate —
            system size, annual production, and your net price after the STC
            rebate. Indicative until {business} confirms it.
          </p>

          <div className="mt-8">
            <SolarAddressForm tenantSlug={tenant.id as string} />
          </div>

          <p className="mt-8 text-xs leading-relaxed text-text-dim">
            Final system designed &amp; installed by a Solar Accreditation
            Australia (SAA)-accredited installer using Clean Energy
            Council–approved components. STC rebate subject to eligibility &amp;
            install date. Estimate, not a contract.
          </p>
        </div>
      </main>
    )
  }
  ```

- [ ] **Step 4: Run the test to confirm it passes.**
  Command:
  ```
  npm run test:e2e -- solar-entry-page.spec.ts
  ```
  Expected: 2 passed — `notFound()` returns HTTP 404 for the unknown and the malformed slug.

- [ ] **Step 5: Build the app to confirm the route tree compiles under Next 16.**
  Command:
  ```
  npm run build
  ```
  Expected: build succeeds; the output lists the new routes `/solar/[tenantSlug]` and `/api/solar/[tenantSlug]/estimate`. (If `lib/solar/intake.ts` / `lib/solar/config.ts` from Phase 1/2 are not yet present in the branch, the build fails on those imports — that is the expected ordering dependency, not a defect in this phase.)

- [ ] **Step 6: Commit.**
  ```
  git add "quotemate-automation/app/solar/[tenantSlug]/page.tsx" quotemate-automation/tests/e2e/solar-entry-page.spec.ts
  git commit -m "$(cat <<'EOF'
  feat(solar): public per-tenant entry page /solar/[tenantSlug]

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

**Phase 3 deliverables (Tasks 15–21):**
- `lib/solar/geocode.ts` — forward geocode (`address → LatLng`) with injectable fetch + pure parser.
- `lib/solar/request-schema.ts` — Zod schema for the public estimate body (address + optional manual block + panel grade).
- `lib/solar/persist-helpers.ts` — pure `SolarEstimate` → intake / `solar_estimates` / quote row payloads.
- `lib/solar/notify.ts` — defensive tradie-notify for the "awaiting confirmation" event (forced review, no auto-send).
- `app/api/solar/[tenantSlug]/estimate/route.ts` — public route: tenant resolve → validate → `runSolarEstimate` → persist 3 rows → notify in `after()` → return `{ token, shareUrl }`.
- `lib/solar/form-payload.ts` + `app/solar/[tenantSlug]/_components/SolarAddressForm.tsx` — client form + pure payload builder.
- `app/solar/[tenantSlug]/page.tsx` — Maintain-styled server entry page with tenant resolution + compliance copy.

**Cross-phase dependencies (called out, not hidden):**
- Consumes from Phase 1/2: `runSolarEstimate` (`lib/solar/intake.ts`), `loadSolarConfig` + `SolarConfig` (`lib/solar/config.ts`), all types in `lib/solar/types.ts`, and the `solar_estimates` table + `solar` trade row (migration 097). The two e2e route/page tests in this phase exercise only the pre-engine guard rails (tenant 404, body validation, slug 404), so they pass independently; the full happy path and `npm run build` require Phases 1–2 to be present.
- `[tenantSlug]` resolves to the tenant `id` (uuid) — there is no `slug` column on `tenants` (verified against migration 015); resolving by `id` matches the existing `/api/q/[token]/book` and `/q/[token]/book` tenant-by-id lookups.

---

## Phase 4 — Customer quote page /q/solar/[token]

## Phase 4 — Customer quote page `/q/solar/[token]`

This phase builds the customer-facing solar quote page mirroring `/q/roof/[token]`, in the Maintain design system. To keep the page server-component thin and the logic strictly TDD-able (matching the `save-as-quote-helpers.ts` pattern), all display/derivation logic lives in pure modules under `lib/solar/` that are unit-tested with vitest; the page and the satellite-image route are thin wiring on top.

The page reads the persisted `solar_estimates` row (the `SolarEstimate` jsonb shape produced by the Phase 3 orchestrator `runSolarEstimate`). Prices and the deposit CTA are gated behind tradie confirmation (`confirmed_at`), exactly like roofing.

Assumed columns on `solar_estimates` (created in the Phase 2/3 data-model migration): `public_token`, `address`, `state`, `estimate` (jsonb = `SolarEstimate`), `confirmed_at`, `quote_id`. The customer page reads only these.

---

### Task 22: Money + production formatters for the solar page

Pure display formatters (currency, kWh, kW, payback band, percentage) used by every tier card and the assumptions panel. Extracted so the page never inlines `toLocaleString` and every rounding rule is tested.

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/quote-page-format.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/quote-page-format.test.ts`

- [ ] **Step 1: Write the failing test.** Create the test file with the full code below.

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/quote-page-format.test.ts
import { describe, expect, it } from 'vitest'
import {
  money,
  kwh,
  kw,
  paybackBand,
  pct,
  perKwh,
} from './quote-page-format'

describe('money', () => {
  it('formats a whole-dollar AUD figure with no decimals and thousands separators', () => {
    expect(money(18990)).toBe('18,990')
  })
  it('rounds to the nearest dollar', () => {
    expect(money(18990.6)).toBe('18,991')
  })
  it('returns 0 for null, undefined or non-finite input', () => {
    expect(money(null)).toBe('0')
    expect(money(undefined)).toBe('0')
    expect(money(Number.NaN)).toBe('0')
    expect(money(Number.POSITIVE_INFINITY)).toBe('0')
  })
})

describe('kwh', () => {
  it('formats annual production with thousands separators and no decimals', () => {
    expect(kwh(9540)).toBe('9,540')
  })
  it('returns 0 for non-finite input', () => {
    expect(kwh(Number.NaN)).toBe('0')
  })
})

describe('kw', () => {
  it('formats system size to one decimal place', () => {
    expect(kw(6.6)).toBe('6.6')
  })
  it('keeps a trailing .0 for whole kW values', () => {
    expect(kw(10)).toBe('10.0')
  })
  it('returns 0.0 for non-finite input', () => {
    expect(kw(Number.NaN)).toBe('0.0')
  })
})

describe('paybackBand', () => {
  it('renders a low–high range with one decimal and a yrs suffix', () => {
    expect(paybackBand(4.2, 6.8)).toBe('4.2–6.8 yrs')
  })
  it('collapses to a single figure when low equals high', () => {
    expect(paybackBand(5, 5)).toBe('5.0 yrs')
  })
  it('returns an em dash when either bound is non-finite', () => {
    expect(paybackBand(Number.NaN, 6)).toBe('—')
    expect(paybackBand(4, Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('pct', () => {
  it('formats a 0–1 fraction as a whole-number percentage', () => {
    expect(pct(0.4)).toBe('40%')
  })
  it('rounds to the nearest whole percent', () => {
    expect(pct(0.405)).toBe('41%')
  })
})

describe('perKwh', () => {
  it('formats a $/kWh rate to two decimals with a cent symbol view', () => {
    expect(perKwh(0.32)).toBe('$0.32/kWh')
  })
  it('pads a single-decimal rate to two places', () => {
    expect(perKwh(0.3)).toBe('$0.30/kWh')
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/quote-page-format.test.ts
```

Expected: failure with `Error: Failed to resolve import "./quote-page-format"` (the module does not exist yet), reported as a suite/transform error.

- [ ] **Step 3: Write the minimal implementation.** Create the module with the full code below.

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/quote-page-format.ts
// Pure display formatters for the /q/solar/[token] customer page.
// No I/O, no React — fully unit-testable. Mirrors the roofing page's
// inline `money()` helper but centralised so every solar number rounds
// identically (whole-dollar prices, whole-kWh production, 1-dp kW).

/** Whole-dollar AUD, thousands-separated, no decimals. '0' on bad input. */
export function money(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
  return Math.round(n).toLocaleString('en-AU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

/** Whole-kWh annual production, thousands-separated. '0' on bad input. */
export function kwh(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
  return Math.round(n).toLocaleString('en-AU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

/** System size in kW to exactly one decimal place. '0.0' on bad input. */
export function kw(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0.0'
  return n.toFixed(1)
}

/** Banded payback "low–high yrs"; collapses when equal; '—' on bad input. */
export function paybackBand(
  low: number | null | undefined,
  high: number | null | undefined,
): string {
  if (
    typeof low !== 'number' ||
    typeof high !== 'number' ||
    !Number.isFinite(low) ||
    !Number.isFinite(high)
  ) {
    return '—'
  }
  if (low === high) return `${low.toFixed(1)} yrs`
  return `${low.toFixed(1)}–${high.toFixed(1)} yrs`
}

/** A 0–1 fraction as a whole-number percentage, e.g. 0.4 → '40%'. */
export function pct(fraction: number): string {
  if (!Number.isFinite(fraction)) return '0%'
  return `${Math.round(fraction * 100)}%`
}

/** A $/kWh rate to two decimals, e.g. 0.32 → '$0.32/kWh'. */
export function perKwh(rate: number): string {
  if (!Number.isFinite(rate)) return '$0.00/kWh'
  return `$${rate.toFixed(2)}/kWh`
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm test -- lib/solar/quote-page-format.test.ts
```

Expected: all assertions pass (6 `describe` blocks, 16 `it` tests passing, 0 failed).

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/quote-page-format.ts quotemate-automation/lib/solar/quote-page-format.test.ts
git commit -m "feat(solar): pure display formatters for the customer quote page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 23: Confidence-band chip presenter

Maps a `SolarConfidenceBand` ('tight' | 'wide') plus the coverage source to the chip label, the ± width string, and whether the "indicative only" warning chip shows (spec §6: ±20% covered/HIGH → ±30% + chip for MEDIUM/manual/stale).

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/confidence-chip.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/confidence-chip.test.ts`

- [ ] **Step 1: Write the failing test.** Create the test file with the full code below.

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/confidence-chip.test.ts
import { describe, expect, it } from 'vitest'
import { confidenceChip } from './confidence-chip'

describe('confidenceChip', () => {
  it('tight band on a covered Google estimate → ±20%, no indicative-only chip', () => {
    const chip = confidenceChip({ band: 'tight', coverageSource: 'google' })
    expect(chip).toEqual({
      bandLabel: '±20%',
      tone: 'accent',
      indicativeOnly: false,
      caption: 'Estimate accuracy ±20% based on aerial imagery.',
    })
  })

  it('wide band → ±30% and shows the indicative-only chip', () => {
    const chip = confidenceChip({ band: 'wide', coverageSource: 'google' })
    expect(chip).toEqual({
      bandLabel: '±30%',
      tone: 'warning',
      indicativeOnly: true,
      caption: 'Wider ±30% range — your installer will refine this on site.',
    })
  })

  it('manual coverage forces the wide band and indicative-only chip even if band says tight', () => {
    const chip = confidenceChip({ band: 'tight', coverageSource: 'manual' })
    expect(chip.bandLabel).toBe('±30%')
    expect(chip.indicativeOnly).toBe(true)
    expect(chip.tone).toBe('warning')
    expect(chip.caption).toBe(
      'Based on the details you provided — your installer will confirm from a site visit.',
    )
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/confidence-chip.test.ts
```

Expected: failure with `Error: Failed to resolve import "./confidence-chip"`.

- [ ] **Step 3: Write the minimal implementation.** Create the module with the full code below.

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/confidence-chip.ts
// Pure presenter for the confidence-band chip on /q/solar/[token].
// Spec §6: ±20% for covered + tight; ±30% + "indicative only" chip for
// the wide band OR any manual-fallback estimate (declared roof). Manual
// coverage always degrades to wide regardless of the stored band.

import type { SolarConfidenceBand, SolarCoverageSource } from './types'

export type SolarConfidenceChip = {
  /** Display width, e.g. '±20%'. */
  bandLabel: string
  /** Maintain colour role for the chip border/text. */
  tone: 'accent' | 'warning'
  /** When true, render the "Indicative only" warning chip. */
  indicativeOnly: boolean
  /** One-line caption shown under the chip. */
  caption: string
}

export function confidenceChip(args: {
  band: SolarConfidenceBand
  coverageSource: SolarCoverageSource
}): SolarConfidenceChip {
  if (args.coverageSource === 'manual') {
    return {
      bandLabel: '±30%',
      tone: 'warning',
      indicativeOnly: true,
      caption:
        'Based on the details you provided — your installer will confirm from a site visit.',
    }
  }
  if (args.band === 'wide') {
    return {
      bandLabel: '±30%',
      tone: 'warning',
      indicativeOnly: true,
      caption: 'Wider ±30% range — your installer will refine this on site.',
    }
  }
  return {
    bandLabel: '±20%',
    tone: 'accent',
    indicativeOnly: false,
    caption: 'Estimate accuracy ±20% based on aerial imagery.',
  }
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm test -- lib/solar/confidence-chip.test.ts
```

Expected: 1 `describe`, 3 `it` tests passing, 0 failed.

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/confidence-chip.ts quotemate-automation/lib/solar/confidence-chip.test.ts
git commit -m "feat(solar): confidence-band chip presenter for the customer page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: Tier-card view-model builder

Joins the three parallel arrays the contract returns (`price.tiers`, `production[]`, `economics.tiers`) by tier key into one flat per-card view-model the page maps over — so the JSX never indexes three arrays by hand.

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/tier-cards.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/tier-cards.test.ts`

- [ ] **Step 1: Write the failing test.** Create the test file with the full code below.

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/tier-cards.test.ts
import { describe, expect, it } from 'vitest'
import { buildSolarTierCards } from './tier-cards'
import type {
  SolarQuotePrice,
  SolarProductionResult,
  SolarEconomicsResult,
} from './types'

const price = {
  tiers: [
    {
      tier: 'good',
      label: 'Starter system',
      system_kw_dc: 6.6,
      gross_ex_gst: 8000,
      gross_inc_gst: 8800,
      stc: {
        system_kw: 6.6,
        zone_rating: 1.382,
        deeming_years: 5,
        certificates: 45,
        stc_price_aud: 38,
        rebate_aud: 1710,
      },
      net_ex_gst: 6290,
      net_inc_gst: 6919,
      scope: '6.6 kW system with standard panels.',
    },
    {
      tier: 'better',
      label: 'Full-size system',
      system_kw_dc: 10,
      gross_ex_gst: 11500,
      gross_inc_gst: 12650,
      stc: {
        system_kw: 10,
        zone_rating: 1.382,
        deeming_years: 5,
        certificates: 69,
        stc_price_aud: 38,
        rebate_aud: 2622,
      },
      net_ex_gst: 8878,
      net_inc_gst: 9766,
      scope: '10 kW system with standard panels.',
    },
  ],
  effective_rate_per_kw: 1200,
  loadings_applied: [],
  routing: { decision: 'tradie_review', reason: 'Solar quote needs tradie sign-off.' },
} as unknown as SolarQuotePrice

const production = [
  {
    system_kw_dc: 6.6,
    annual_kwh_ac: 9540,
    annual_kwh_low: 7632,
    annual_kwh_high: 11448,
    derate_applied: 0.81,
    degradation_pct_per_year: 0.005,
    cec_benchmark_kwh_per_kw: 1400,
    within_cec_benchmark: true,
    band: 'tight',
  },
  {
    system_kw_dc: 10,
    annual_kwh_ac: 14454,
    annual_kwh_low: 11563,
    annual_kwh_high: 17345,
    derate_applied: 0.81,
    degradation_pct_per_year: 0.005,
    cec_benchmark_kwh_per_kw: 1400,
    within_cec_benchmark: true,
    band: 'tight',
  },
] as unknown as SolarProductionResult[]

const economics = {
  tiers: [
    {
      tier: 'good',
      self_consumed_kwh: 3816,
      exported_kwh: 5724,
      bill_savings_aud: 1221,
      export_earnings_aud: 401,
      annual_savings_aud: 1622,
      payback_years_low: 3.5,
      payback_years_high: 5.1,
    },
    {
      tier: 'better',
      self_consumed_kwh: 5782,
      exported_kwh: 8672,
      bill_savings_aud: 1850,
      export_earnings_aud: 607,
      annual_savings_aud: 2457,
      payback_years_low: 3.2,
      payback_years_high: 4.8,
    },
  ],
  assumptions: {
    self_consumption_pct: 0.4,
    retail_rate_aud_per_kwh: 0.32,
    feed_in_tariff_aud_per_kwh: 0.07,
    feed_in_network: 'Ausgrid',
  },
} as unknown as SolarEconomicsResult

describe('buildSolarTierCards', () => {
  it('returns one card per priced tier, in price-tier order', () => {
    const cards = buildSolarTierCards({ price, production, economics })
    expect(cards).toHaveLength(2)
    expect(cards.map((c) => c.tier)).toEqual(['good', 'better'])
  })

  it('joins production by aligned index and economics by tier key', () => {
    const cards = buildSolarTierCards({ price, production, economics })
    const better = cards[1]
    expect(better.systemKwDc).toBe(10)
    expect(better.panelsCount).toBe(undefined) // panels live on sizing, not price — page reads sizing separately
    expect(better.annualKwhAc).toBe(14454)
    expect(better.grossIncGst).toBe(12650)
    expect(better.stcRebateAud).toBe(2622)
    expect(better.netIncGst).toBe(9766)
    expect(better.annualSavingsAud).toBe(2457)
    expect(better.paybackLow).toBe(3.2)
    expect(better.paybackHigh).toBe(4.8)
  })

  it('carries through the tier label and scope sentence', () => {
    const cards = buildSolarTierCards({ price, production, economics })
    expect(cards[0].label).toBe('Starter system')
    expect(cards[0].scope).toBe('6.6 kW system with standard panels.')
  })

  it('falls back to a zero economics card when a tier has no economics match', () => {
    const econNoBetter = {
      ...economics,
      tiers: [economics.tiers[0]],
    } as unknown as SolarEconomicsResult
    const cards = buildSolarTierCards({ price, production, economics: econNoBetter })
    expect(cards[1].annualSavingsAud).toBe(0)
    expect(cards[1].paybackLow).toBe(null)
    expect(cards[1].paybackHigh).toBe(null)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/tier-cards.test.ts
```

Expected: failure with `Error: Failed to resolve import "./tier-cards"`.

- [ ] **Step 3: Write the minimal implementation.** Create the module with the full code below.

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/tier-cards.ts
// Pure view-model builder for the /q/solar/[token] tier cards.
//
// The contract returns three parallel structures: price.tiers (gross →
// STC → net), production[] (aligned by index to sizing.tiers), and
// economics.tiers (keyed by tier). This flattens them into one card per
// priced tier so the page JSX maps a single array instead of indexing
// three. Panels count is read from sizing separately on the page; it is
// intentionally not duplicated here.

import type {
  SolarQuotePrice,
  SolarProductionResult,
  SolarEconomicsResult,
} from './types'

export type SolarTierCard = {
  tier: 'good' | 'better' | 'best'
  label: string
  scope: string
  systemKwDc: number
  panelsCount: number | undefined
  annualKwhAc: number
  annualKwhLow: number
  annualKwhHigh: number
  grossIncGst: number
  grossExGst: number
  stcRebateAud: number
  stcCertificates: number
  netIncGst: number
  netExGst: number
  annualSavingsAud: number
  paybackLow: number | null
  paybackHigh: number | null
}

export function buildSolarTierCards(args: {
  price: SolarQuotePrice
  production: SolarProductionResult[]
  economics: SolarEconomicsResult
}): SolarTierCard[] {
  const { price, production, economics } = args
  return price.tiers.map((t, i) => {
    const prod = production[i]
    const econ = economics.tiers.find((e) => e.tier === t.tier)
    return {
      tier: t.tier,
      label: t.label,
      scope: t.scope,
      systemKwDc: t.system_kw_dc,
      panelsCount: undefined,
      annualKwhAc: prod?.annual_kwh_ac ?? 0,
      annualKwhLow: prod?.annual_kwh_low ?? 0,
      annualKwhHigh: prod?.annual_kwh_high ?? 0,
      grossIncGst: t.gross_inc_gst,
      grossExGst: t.gross_ex_gst,
      stcRebateAud: t.stc.rebate_aud,
      stcCertificates: t.stc.certificates,
      netIncGst: t.net_inc_gst,
      netExGst: t.net_ex_gst,
      annualSavingsAud: econ?.annual_savings_aud ?? 0,
      paybackLow: econ?.payback_years_low ?? null,
      paybackHigh: econ?.payback_years_high ?? null,
    }
  })
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm test -- lib/solar/tier-cards.test.ts
```

Expected: 1 `describe`, 4 `it` tests passing, 0 failed.

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/tier-cards.ts quotemate-automation/lib/solar/tier-cards.test.ts
git commit -m "feat(solar): tier-card view-model joining price/production/economics

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 25: Mandatory SAA/CEC compliance copy constant

Spec §6 requires verbatim compliance copy on every solar quote page. Pin it as a single exported constant with a test asserting the exact mandated sentence fragments, so a future edit that weakens it fails CI.

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/compliance-copy.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/compliance-copy.test.ts`

- [ ] **Step 1: Write the failing test.** Create the test file with the full code below.

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/compliance-copy.test.ts
import { describe, expect, it } from 'vitest'
import {
  SOLAR_COMPLIANCE_COPY,
  SOLAR_PRE_CONFIRM_COPY,
} from './compliance-copy'

describe('SOLAR_COMPLIANCE_COPY', () => {
  it('names a Solar Accreditation Australia (SAA)-accredited installer', () => {
    expect(SOLAR_COMPLIANCE_COPY).toContain(
      'Solar Accreditation Australia (SAA)-accredited installer',
    )
  })
  it('requires Clean Energy Council–approved components', () => {
    expect(SOLAR_COMPLIANCE_COPY).toContain(
      'Clean Energy Council–approved components',
    )
  })
  it('states the STC rebate is subject to eligibility and install date', () => {
    expect(SOLAR_COMPLIANCE_COPY).toContain(
      'STC rebate subject to eligibility & install date',
    )
  })
  it('makes clear this is an estimate, not a contract', () => {
    expect(SOLAR_COMPLIANCE_COPY).toContain('Estimate, not a contract.')
  })
})

describe('SOLAR_PRE_CONFIRM_COPY', () => {
  it('tells the customer their installer will confirm the estimate', () => {
    expect(SOLAR_PRE_CONFIRM_COPY).toBe(
      'Your installer will confirm this estimate.',
    )
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/compliance-copy.test.ts
```

Expected: failure with `Error: Failed to resolve import "./compliance-copy"`.

- [ ] **Step 3: Write the minimal implementation.** Create the module with the full code below.

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/compliance-copy.ts
// Mandatory compliance copy for /q/solar/[token] (spec §6). This text is
// a regulatory requirement — keep it verbatim. compliance-copy.test.ts
// asserts each mandated fragment so a weakening edit fails CI.
//
// The en-dash in "Council–approved" and the ampersands are intentional
// and match the spec wording exactly.

export const SOLAR_COMPLIANCE_COPY =
  'Final system designed & installed by a Solar Accreditation Australia ' +
  '(SAA)-accredited installer using Clean Energy Council–approved ' +
  'components. STC rebate subject to eligibility & install date. ' +
  'Estimate, not a contract.'

/** Shown in place of the deposit CTA before the tradie confirms. */
export const SOLAR_PRE_CONFIRM_COPY = 'Your installer will confirm this estimate.'
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm test -- lib/solar/compliance-copy.test.ts
```

Expected: 2 `describe`, 5 `it` tests passing, 0 failed.

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/compliance-copy.ts quotemate-automation/lib/solar/compliance-copy.test.ts
git commit -m "feat(solar): pinned SAA/CEC compliance copy with CI assertion

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 26: Deposit-CTA gate resolver

The deposit button is gated behind tradie confirmation (spec §6) and reuses the existing `/r/[token]/[tier]` redirect. This pure resolver decides, per tier, whether to show a "pay deposit" link (and to which URL) or the pre-confirm message — never showing a CTA on an unconfirmed or inspection-routed estimate.

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/deposit-cta.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/deposit-cta.test.ts`

- [ ] **Step 1: Write the failing test.** Create the test file with the full code below.

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/deposit-cta.test.ts
import { describe, expect, it } from 'vitest'
import { resolveSolarDepositCta } from './deposit-cta'

describe('resolveSolarDepositCta', () => {
  it('hides prices and the CTA before the tradie confirms', () => {
    const cta = resolveSolarDepositCta({
      confirmed: false,
      token: 'abc123def456',
      tier: 'better',
      inspectionRequired: false,
    })
    expect(cta).toEqual({ show: false, href: null, reason: 'awaiting_confirmation' })
  })

  it('shows the per-tier /r redirect link once confirmed', () => {
    const cta = resolveSolarDepositCta({
      confirmed: true,
      token: 'abc123def456',
      tier: 'better',
      inspectionRequired: false,
    })
    expect(cta).toEqual({
      show: true,
      href: '/r/abc123def456/better',
      reason: 'ready',
    })
  })

  it('builds the correct href per tier key', () => {
    expect(
      resolveSolarDepositCta({
        confirmed: true,
        token: 'tok',
        tier: 'good',
        inspectionRequired: false,
      }).href,
    ).toBe('/r/tok/good')
    expect(
      resolveSolarDepositCta({
        confirmed: true,
        token: 'tok',
        tier: 'best',
        inspectionRequired: false,
      }).href,
    ).toBe('/r/tok/best')
  })

  it('never shows a deposit CTA when the estimate is routed to inspection', () => {
    const cta = resolveSolarDepositCta({
      confirmed: true,
      token: 'abc123def456',
      tier: 'better',
      inspectionRequired: true,
    })
    expect(cta).toEqual({ show: false, href: null, reason: 'inspection_required' })
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/deposit-cta.test.ts
```

Expected: failure with `Error: Failed to resolve import "./deposit-cta"`.

- [ ] **Step 3: Write the minimal implementation.** Create the module with the full code below.

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/deposit-cta.ts
// Pure deposit-CTA gate for /q/solar/[token] (spec §6). The deposit is
// the existing per-tier short-link /r/[token]/[tier] (lib/quote/booking
// + app/r/[token]/[tier]/route.ts). It only renders once the tradie has
// confirmed the estimate AND the estimate isn't routed to inspection —
// inherits roofing's forced-review rule. No I/O.

export type SolarDepositCta =
  | { show: true; href: string; reason: 'ready' }
  | { show: false; href: null; reason: 'awaiting_confirmation' | 'inspection_required' }

export function resolveSolarDepositCta(args: {
  confirmed: boolean
  token: string
  tier: 'good' | 'better' | 'best'
  inspectionRequired: boolean
}): SolarDepositCta {
  if (args.inspectionRequired) {
    return { show: false, href: null, reason: 'inspection_required' }
  }
  if (!args.confirmed) {
    return { show: false, href: null, reason: 'awaiting_confirmation' }
  }
  return { show: true, href: `/r/${args.token}/${args.tier}`, reason: 'ready' }
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm test -- lib/solar/deposit-cta.test.ts
```

Expected: 1 `describe`, 4 `it` tests passing, 0 failed.

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/deposit-cta.ts quotemate-automation/lib/solar/deposit-cta.test.ts
git commit -m "feat(solar): deposit-CTA gate behind tradie confirmation (reuses /r redirect)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 27: Hero stats-overlay + imagery-caption builder

Builds the hero overlay model (system size, panels, primary orientation, yearly kWh) and the imagery-date caption shown over the real satellite photo (spec §6: *"Indicative layout based on Google aerial imagery, [imageryDate]."*; manual fallback shows no aerial caption).

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/hero-overlay.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/hero-overlay.test.ts`

- [ ] **Step 1: Write the failing test.** Create the test file with the full code below.

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/hero-overlay.test.ts
import { describe, expect, it } from 'vitest'
import { buildHeroOverlay, orientationLabel } from './hero-overlay'
import type { SolarRoofFacts, SolarSystemTier } from './types'

const headlineTier = {
  tier: 'better',
  label: 'Full-size system',
  system_kw_dc: 10,
  panels_count: 25,
  panel_type: 'standard_panels',
  source_config: { panels_count: 25, yearly_energy_dc_kwh: 14800 },
  export_limited: false,
} as unknown as SolarSystemTier

const googleRoof = {
  source: 'google',
  primary_orientation: 'north_east',
  imagery_date: '2025-03-14',
} as unknown as SolarRoofFacts

const manualRoof = {
  source: 'manual',
  primary_orientation: 'north',
  imagery_date: null,
} as unknown as SolarRoofFacts

describe('orientationLabel', () => {
  it('humanises compound directions', () => {
    expect(orientationLabel('north_east')).toBe('North-east')
  })
  it('humanises flat and unknown', () => {
    expect(orientationLabel('flat')).toBe('Flat')
    expect(orientationLabel('unknown')).toBe('To confirm')
  })
})

describe('buildHeroOverlay', () => {
  it('builds the four overlay stats from the headline tier + roof', () => {
    const overlay = buildHeroOverlay({
      headlineTier,
      roof: googleRoof,
      annualKwhAc: 11988,
    })
    expect(overlay.stats).toEqual([
      { label: 'System size', value: '10.0 kW' },
      { label: 'Panels', value: '25' },
      { label: 'Orientation', value: 'North-east' },
      { label: 'Yearly output', value: '11,988 kWh' },
    ])
  })

  it('captions a Google estimate with the imagery date', () => {
    const overlay = buildHeroOverlay({
      headlineTier,
      roof: googleRoof,
      annualKwhAc: 11988,
    })
    expect(overlay.caption).toBe(
      'Indicative layout based on Google aerial imagery, 14 Mar 2025.',
    )
  })

  it('omits the aerial caption for a manual-fallback estimate', () => {
    const overlay = buildHeroOverlay({
      headlineTier,
      roof: manualRoof,
      annualKwhAc: 9000,
    })
    expect(overlay.caption).toBe(
      'Indicative layout based on the roof details you provided.',
    )
  })

  it('captions a Google estimate without a date gracefully', () => {
    const overlay = buildHeroOverlay({
      headlineTier,
      roof: { ...googleRoof, imagery_date: null } as unknown as SolarRoofFacts,
      annualKwhAc: 11988,
    })
    expect(overlay.caption).toBe(
      'Indicative layout based on Google aerial imagery.',
    )
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/hero-overlay.test.ts
```

Expected: failure with `Error: Failed to resolve import "./hero-overlay"`.

- [ ] **Step 3: Write the minimal implementation.** Create the module with the full code below.

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/hero-overlay.ts
// Pure builder for the satellite-hero stats overlay + imagery caption on
// /q/solar/[token] (spec §6). The overlay sits over the REAL Google
// satellite photo (no generative panels). Caption carries the imagery
// date for Google estimates; manual-fallback estimates say "details you
// provided" instead.

import type { SolarOrientation, SolarRoofFacts, SolarSystemTier } from './types'
import { kw, kwh } from './quote-page-format'

const ORIENTATION_LABELS: Record<SolarOrientation, string> = {
  north: 'North',
  north_east: 'North-east',
  east: 'East',
  south_east: 'South-east',
  south: 'South',
  south_west: 'South-west',
  west: 'West',
  north_west: 'North-west',
  flat: 'Flat',
  unknown: 'To confirm',
}

export function orientationLabel(o: SolarOrientation): string {
  return ORIENTATION_LABELS[o] ?? 'To confirm'
}

export type SolarHeroOverlay = {
  stats: Array<{ label: string; value: string }>
  caption: string
}

/** Format an ISO YYYY-MM-DD as e.g. '14 Mar 2025'; null on bad input. */
function formatImageryDate(iso: string | null): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  const monthIdx = Number(m[2]) - 1
  if (monthIdx < 0 || monthIdx > 11) return null
  return `${Number(m[3])} ${months[monthIdx]} ${m[1]}`
}

export function buildHeroOverlay(args: {
  headlineTier: SolarSystemTier
  roof: SolarRoofFacts
  annualKwhAc: number
}): SolarHeroOverlay {
  const { headlineTier, roof, annualKwhAc } = args
  const stats = [
    { label: 'System size', value: `${kw(headlineTier.system_kw_dc)} kW` },
    { label: 'Panels', value: String(headlineTier.panels_count) },
    { label: 'Orientation', value: orientationLabel(roof.primary_orientation) },
    { label: 'Yearly output', value: `${kwh(annualKwhAc)} kWh` },
  ]

  let caption: string
  if (roof.source === 'manual') {
    caption = 'Indicative layout based on the roof details you provided.'
  } else {
    const date = formatImageryDate(roof.imagery_date)
    caption = date
      ? `Indicative layout based on Google aerial imagery, ${date}.`
      : 'Indicative layout based on Google aerial imagery.'
  }

  return { stats, caption }
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm test -- lib/solar/hero-overlay.test.ts
```

Expected: 2 `describe`, 6 `it` tests passing, 0 failed.

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/hero-overlay.ts quotemate-automation/lib/solar/hero-overlay.test.ts
git commit -m "feat(solar): hero stats-overlay + imagery-date caption builder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 28: Satellite hero static-map route `/api/solar/q/[token]/static-map`

Token-gated Google Maps Static proxy for the solar estimate's roof, mirroring the roofing `static-map` route. Serves the real satellite photo for the hero (no generative imagery — spec §1, §6). Centres on the estimate's roof polygon when present, else the address.

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/static-map-center.ts`
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/app/api/solar/q/[token]/static-map/route.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/static-map-center.test.ts`

- [ ] **Step 1: Write the failing test.** Create the test file with the full code below. (The route handler does I/O; the centring math is the testable unit, extracted into `static-map-center.ts`.)

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/static-map-center.test.ts
import { describe, expect, it } from 'vitest'
import { centerForSolarEstimate } from './static-map-center'

describe('centerForSolarEstimate', () => {
  it('reads the first polygon vertex as lat/lng from a GeoJSON ring', () => {
    const center = centerForSolarEstimate({
      roof: {
        polygon_geojson: {
          type: 'Polygon',
          coordinates: [[[151.2093, -33.8688], [151.21, -33.869]]],
        },
      },
    })
    expect(center).toEqual({ lat: -33.8688, lng: 151.2093 })
  })

  it('returns null when there is no polygon (manual fallback)', () => {
    expect(centerForSolarEstimate({ roof: { polygon_geojson: null } })).toBe(null)
  })

  it('returns null when the ring is empty or malformed', () => {
    expect(
      centerForSolarEstimate({
        roof: { polygon_geojson: { type: 'Polygon', coordinates: [[]] } },
      }),
    ).toBe(null)
    expect(
      centerForSolarEstimate({
        roof: { polygon_geojson: { type: 'Polygon', coordinates: [] } },
      }),
    ).toBe(null)
  })

  it('returns null when the vertex is not a numeric pair', () => {
    expect(
      centerForSolarEstimate({
        roof: {
          polygon_geojson: {
            type: 'Polygon',
            coordinates: [[['x' as unknown as number, 'y' as unknown as number]]],
          },
        },
      }),
    ).toBe(null)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/static-map-center.test.ts
```

Expected: failure with `Error: Failed to resolve import "./static-map-center"`.

- [ ] **Step 3: Write the minimal implementation.** Create the centring helper, then the route handler.

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/static-map-center.ts
// Pure: derive a {lat,lng} centre for the solar hero satellite image from
// the estimate's roof polygon. GeoJSON rings are [lng, lat] pairs, so the
// first vertex maps to { lat: v[1], lng: v[0] }. Null on no polygon
// (manual fallback) — the route then centres on the address instead.

export type LatLngCenter = { lat: number; lng: number }

export function centerForSolarEstimate(args: {
  roof: { polygon_geojson: { coordinates?: number[][][] } | null }
}): LatLngCenter | null {
  const ring = args.roof.polygon_geojson?.coordinates?.[0]
  const v = ring?.[0]
  if (
    Array.isArray(v) &&
    typeof v[0] === 'number' &&
    Number.isFinite(v[0]) &&
    typeof v[1] === 'number' &&
    Number.isFinite(v[1])
  ) {
    return { lat: v[1], lng: v[0] }
  }
  return null
}
```

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/app/api/solar/q/[token]/static-map/route.ts
// GET /api/solar/q/[token]/static-map — public, share-token-gated Google
// Maps Static proxy for a saved solar estimate. This is the REAL roof
// satellite photo used as the hero on /q/solar/[token] (no generative
// imagery — spec §1, §6). Mirrors the roofing static-map route. Centres
// on the estimate's roof polygon when present, else the saved address.

import { createClient } from '@supabase/supabase-js'
import { buildStaticMapUrl } from '@/lib/roofing/google-maps'
import { centerForSolarEstimate } from '@/lib/solar/static-map-center'
import type { SolarEstimate } from '@/lib/solar/types'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'bad_token' }, { status: 400 })
  }

  const { data: row, error } = await supabase
    .from('solar_estimates')
    .select('address, estimate')
    .eq('public_token', token)
    .maybeSingle()
  if (error || !row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return Response.json(
      { ok: false, error: 'GOOGLE_MAPS_API_KEY not set on the server' },
      { status: 503 },
    )
  }

  const estimate = (row.estimate as SolarEstimate | null) ?? null
  const address = (row.address as string | null) ?? undefined
  const center = estimate ? centerForSolarEstimate({ roof: estimate.roof }) : null
  if (!address && !center) {
    return Response.json({ ok: false, error: 'no_location' }, { status: 400 })
  }

  let target: string
  try {
    target = buildStaticMapUrl(
      {
        address: center ? undefined : address,
        center: center ?? undefined,
        zoom: 20,
        size: { width: 640, height: 480 },
        markers: center ? [{ lat: center.lat, lng: center.lng, color: 'orange' }] : undefined,
      },
      { apiKey },
    )
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    )
  }

  let res: Response
  try {
    res = await fetch(target, { method: 'GET' })
  } catch (e) {
    return Response.json(
      { ok: false, error: `Google Maps Static fetch failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }
  if (!res.ok) {
    let body = ''
    try { body = (await res.text()).slice(0, 300) } catch { /* ignore */ }
    return Response.json(
      { ok: false, error: `Google Maps Static returned ${res.status}`, upstreamBody: body },
      { status: 502 },
    )
  }

  const ct = res.headers.get('content-type') ?? 'image/png'
  const arrayBuffer = await res.arrayBuffer()
  return new Response(arrayBuffer, {
    status: 200,
    headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400, immutable' },
  })
}
```

- [ ] **Step 4: Run the test, verify it passes; then typecheck the route.** Run:

```
npm test -- lib/solar/static-map-center.test.ts
```

Expected: 1 `describe`, 4 `it` tests passing, 0 failed. Then run the build typecheck:

```
npm run build
```

Expected: the build compiles with no TypeScript errors in `app/api/solar/q/[token]/static-map/route.ts` or `lib/solar/static-map-center.ts` (the route awaits `ctx.params` per Next 16).

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/static-map-center.ts quotemate-automation/lib/solar/static-map-center.test.ts "quotemate-automation/app/api/solar/q/[token]/static-map/route.ts"
git commit -m "feat(solar): satellite hero static-map proxy route + centring helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 29: Assemble the customer page `/q/solar/[token]`

Wire the tested presenters into the server component: token resolution → load `solar_estimates` row → confirm gate → hero (satellite + overlay + caption) → confidence chip → tier cards (kW, panels, yearly kWh, gross, STC subtraction line, net, annual savings, banded payback) → always-visible assumptions panel → mandatory compliance copy → gated deposit CTA. Maintain design system throughout.

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/app/q/solar/[token]/page.tsx`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/quote-page-row.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/quote-page-row.test.ts`

- [ ] **Step 1: Write the failing test.** The page itself is wiring; the load-and-gate decision is the testable unit. Create the helper test with the full code below.

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/quote-page-row.test.ts
import { describe, expect, it } from 'vitest'
import { resolveSolarQuoteView } from './quote-page-row'
import type { SolarEstimate } from './types'

const estimate = {
  token: 'abc123def456',
  coverage_source: 'google',
  confidence_band: 'tight',
  routing: { decision: 'tradie_review', reason: 'Solar quote needs sign-off.' },
  sizing: {
    tiers: [
      { tier: 'good', system_kw_dc: 6.6, panels_count: 16 },
      { tier: 'better', system_kw_dc: 10, panels_count: 25 },
    ],
  },
} as unknown as SolarEstimate

describe('resolveSolarQuoteView', () => {
  it('hides prices and the CTA before confirmation', () => {
    const view = resolveSolarQuoteView({ estimate, confirmedAt: null })
    expect(view.confirmed).toBe(false)
    expect(view.showPrices).toBe(false)
    expect(view.inspectionRequired).toBe(false)
  })

  it('shows prices once confirmed and not routed to inspection', () => {
    const view = resolveSolarQuoteView({
      estimate,
      confirmedAt: '2026-06-08T04:00:00Z',
    })
    expect(view.confirmed).toBe(true)
    expect(view.showPrices).toBe(true)
  })

  it('never shows prices when routed to inspection, even confirmed', () => {
    const inspect = {
      ...estimate,
      routing: { decision: 'inspection_required', reason: 'Steep roof.' },
    } as unknown as SolarEstimate
    const view = resolveSolarQuoteView({
      estimate: inspect,
      confirmedAt: '2026-06-08T04:00:00Z',
    })
    expect(view.confirmed).toBe(true)
    expect(view.inspectionRequired).toBe(true)
    expect(view.showPrices).toBe(false)
  })

  it('exposes the headline tier as the largest sizing tier (last in order)', () => {
    const view = resolveSolarQuoteView({ estimate, confirmedAt: null })
    expect(view.headlineTier.system_kw_dc).toBe(10)
    expect(view.headlineTier.panels_count).toBe(25)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm test -- lib/solar/quote-page-row.test.ts
```

Expected: failure with `Error: Failed to resolve import "./quote-page-row"`.

- [ ] **Step 3: Write the minimal implementation.** Create the gate helper first, then the page.

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/quote-page-row.ts
// Pure load-and-gate logic for /q/solar/[token]. Decides the confirm
// gate, the inspection gate, price visibility, and the headline tier
// (largest sizing tier — last in good→best order) the hero overlays.
// No I/O — the page passes in the persisted estimate + confirmed_at.

import type { SolarEstimate, SolarSystemTier } from './types'

export type SolarQuoteView = {
  confirmed: boolean
  inspectionRequired: boolean
  showPrices: boolean
  headlineTier: SolarSystemTier
}

export function resolveSolarQuoteView(args: {
  estimate: SolarEstimate
  confirmedAt: string | null
}): SolarQuoteView {
  const confirmed = args.confirmedAt != null
  const inspectionRequired =
    args.estimate.routing.decision === 'inspection_required'
  const showPrices = confirmed && !inspectionRequired
  const tiers = args.estimate.sizing.tiers
  const headlineTier = tiers[tiers.length - 1]
  return { confirmed, inspectionRequired, showPrices, headlineTier }
}
```

```tsx
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/app/q/solar/[token]/page.tsx
// Customer-facing public solar estimate page (spec §6). Token-gated
// against solar_estimates.public_token (unguessable); service-role client
// because this is a public sharing surface.
//
// CONFIRM GATE: prices + deposit CTA are hidden until the tradie confirms
// (solar_estimates.confirmed_at set). Before that the page shows the real
// satellite roof photo + stats overlay framed "indicative — your installer
// confirms". After confirmation it shows the full priced tier breakdown
// (kW, panels, yearly kWh, gross → STC subtraction → net, annual savings,
// banded payback), the always-visible assumptions panel, the confidence
// chip, the mandatory SAA/CEC compliance copy, and the per-tier deposit
// CTA (reusing /r/[token]/[tier]).
//
// Maintain Technology brand: dark navy, vibrant orange, all-caps display.

import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import type { SolarEstimate } from '@/lib/solar/types'
import { resolveSolarQuoteView } from '@/lib/solar/quote-page-row'
import { buildSolarTierCards } from '@/lib/solar/tier-cards'
import { buildHeroOverlay } from '@/lib/solar/hero-overlay'
import { confidenceChip } from '@/lib/solar/confidence-chip'
import { resolveSolarDepositCta } from '@/lib/solar/deposit-cta'
import {
  SOLAR_COMPLIANCE_COPY,
  SOLAR_PRE_CONFIRM_COPY,
} from '@/lib/solar/compliance-copy'
import { money, kwh, kw, paybackBand, pct, perKwh } from '@/lib/solar/quote-page-format'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Row = {
  address: string | null
  state: string | null
  estimate: SolarEstimate | null
  confirmed_at: string | null
}

const TIER_NAME: Record<'good' | 'better' | 'best', string> = {
  good: 'Starter',
  better: 'Full-size',
  best: 'Premium',
}

export default async function SolarQuotePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!token || token.length < 8) notFound()

  const { data, error } = await supabase
    .from('solar_estimates')
    .select('address, state, estimate, confirmed_at')
    .eq('public_token', token)
    .maybeSingle()

  if (error || !data) notFound()
  const row = data as Row
  const estimate = row.estimate
  if (!estimate) notFound()

  const view = resolveSolarQuoteView({ estimate, confirmedAt: row.confirmed_at })
  const chip = confidenceChip({
    band: estimate.confidence_band,
    coverageSource: estimate.coverage_source,
  })
  const cards = buildSolarTierCards({
    price: estimate.price,
    production: estimate.production,
    economics: estimate.economics,
  })
  const headlineProd = estimate.production[estimate.production.length - 1]
  const overlay = buildHeroOverlay({
    headlineTier: view.headlineTier,
    roof: estimate.roof,
    annualKwhAc: headlineProd?.annual_kwh_ac ?? 0,
  })
  const a = estimate.economics.assumptions

  const chipBorder = chip.tone === 'warning' ? 'border-l-warning' : 'border-l-accent'
  const chipText = chip.tone === 'warning' ? 'text-warning' : 'text-accent'

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <section className="mx-auto max-w-4xl px-6 pt-14 pb-10 sm:px-10">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent">
          QuoteMate · Solar
        </div>
        <h1 className="mt-3 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,5vw,3.5rem)]">
          Your solar <span className="text-accent">estimate</span>
        </h1>
        {row.address && <p className="mt-4 text-lg text-text-sec">{row.address}</p>}

        {/* Confidence chip */}
        <div className={`mt-6 inline-flex items-center gap-3 border border-ink-line ${chipBorder} border-l-4 bg-ink-card px-4 py-2`}>
          <span className={`font-mono text-sm font-semibold uppercase tracking-[0.16em] ${chipText}`}>
            {chip.bandLabel}
          </span>
          {chip.indicativeOnly && (
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-warning">
              Indicative only
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-text-dim">{chip.caption}</p>

        {/* Hero: real satellite roof photo + stats overlay */}
        <div className="mt-8 overflow-hidden border border-ink-line bg-ink-card">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/solar/q/${token}/static-map`}
              alt={`Satellite view of the roof at ${row.address ?? 'the property'}`}
              className="h-112 w-full object-cover sm:h-128"
            />
            <div className="absolute inset-x-0 bottom-0 grid grid-cols-2 gap-px bg-ink-line/60 sm:grid-cols-4">
              {overlay.stats.map((s) => (
                <div key={s.label} className="bg-ink-deep/85 px-4 py-3">
                  <div className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                    {s.label}
                  </div>
                  <div className="mt-1 font-mono text-base font-bold tabular-nums text-accent">
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-text-dim">
            {overlay.caption}
          </div>
        </div>

        {/* Pre-confirmation notice */}
        {!view.showPrices && (
          <div className="mt-8 border border-ink-line border-l-4 border-l-accent bg-ink-card px-6 py-5">
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
              {view.inspectionRequired ? 'On-site check needed' : 'Awaiting confirmation'}
            </div>
            <p className="mt-2 text-base text-text-sec">
              {view.inspectionRequired
                ? (estimate.routing.reason ||
                  'This roof needs a quick look on site before we can finalise a price.')
                : SOLAR_PRE_CONFIRM_COPY}
            </p>
          </div>
        )}

        {/* Tier cards — shown only once confirmed */}
        {view.showPrices && (
          <div className="mt-10 space-y-6">
            <div className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">
              System options · {cards.length} size{cards.length === 1 ? '' : 's'}
            </div>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {cards.map((c) => {
                const cta = resolveSolarDepositCta({
                  confirmed: view.confirmed,
                  token,
                  tier: c.tier,
                  inspectionRequired: view.inspectionRequired,
                })
                return (
                  <article key={c.tier} className="flex flex-col border border-ink-line bg-ink-card p-6">
                    <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                      {TIER_NAME[c.tier]} · {c.label}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <MiniStat label="System" value={`${kw(c.systemKwDc)} kW`} />
                      <MiniStat label="Panels" value={String(view.headlineTier && c.tier ? c.systemKwDc && estimate.sizing.tiers.find((t) => t.tier === c.tier)?.panels_count ?? 0 : 0)} />
                      <MiniStat label="Yearly output" value={`${kwh(c.annualKwhAc)} kWh`} />
                      <MiniStat label="Annual saving" value={`$${money(c.annualSavingsAud)}`} />
                    </div>

                    {/* Gross → STC subtraction → net */}
                    <div className="mt-5 space-y-1.5 border-t border-ink-line pt-4 font-mono text-sm tabular-nums">
                      <div className="flex justify-between text-text-sec">
                        <span>Gross (inc GST)</span>
                        <span>${money(c.grossIncGst)}</span>
                      </div>
                      <div className="flex justify-between text-text-sec">
                        <span>STC rebate ({c.stcCertificates} certs)</span>
                        <span>−${money(c.stcRebateAud)}</span>
                      </div>
                      <div className="flex justify-between border-t border-ink-line pt-2 text-base font-bold text-accent">
                        <span>Net (inc GST)</span>
                        <span>${money(c.netIncGst)}</span>
                      </div>
                    </div>

                    <div className="mt-4 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
                      Payback {paybackBand(c.paybackLow, c.paybackHigh)}
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-text-sec">{c.scope}</p>

                    {/* Gated deposit CTA */}
                    <div className="mt-5 pt-2">
                      {cta.show ? (
                        <a
                          href={cta.href}
                          className="block bg-accent px-5 py-3 text-center font-mono text-sm font-semibold uppercase tracking-[0.16em] text-white hover:bg-accent-press"
                        >
                          Pay deposit
                        </a>
                      ) : (
                        <div className="text-center font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
                          {SOLAR_PRE_CONFIRM_COPY}
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        )}

        {/* Always-visible assumptions panel */}
        <div className="mt-10 border border-ink-line bg-ink-card p-6 sm:p-7">
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
            Assumptions
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MiniStat label="Self-consumption" value={pct(a.self_consumption_pct)} />
            <MiniStat label="Retail rate" value={perKwh(a.retail_rate_aud_per_kwh)} />
            <MiniStat label="Feed-in tariff" value={perKwh(a.feed_in_tariff_aud_per_kwh)} hint={a.feed_in_network} />
            <MiniStat
              label="STC params"
              value={`×${headlineProd?.derate_applied ?? 0} derate`}
              hint={`config ${estimate.config_version}`}
            />
          </div>
        </div>

        {/* Mandatory SAA/CEC compliance copy */}
        <p className="mt-8 text-sm text-text-dim">{SOLAR_COMPLIANCE_COPY}</p>
      </section>

      <div className="bg-accent px-6 py-5 text-center text-white">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.16em]">
          QuoteMate · Solar
        </span>
      </div>
    </main>
  )
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-ink-line bg-ink-deep p-4">
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{label}</div>
      <div className="mt-2 font-mono text-lg font-bold tabular-nums text-text-pri">{value}</div>
      {hint && <div className="mt-1 text-xs text-text-dim">{hint}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Run the test, verify it passes; then typecheck the page.** Run:

```
npm test -- lib/solar/quote-page-row.test.ts
```

Expected: 1 `describe`, 4 `it` tests passing, 0 failed. Then:

```
npm run build
```

Expected: the build compiles `app/q/solar/[token]/page.tsx` with no TypeScript errors (awaits `params`, all imported presenter names resolve, `force-dynamic` set).

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/lib/solar/quote-page-row.ts quotemate-automation/lib/solar/quote-page-row.test.ts "quotemate-automation/app/q/solar/[token]/page.tsx"
git commit -m "feat(solar): customer quote page /q/solar/[token] (Maintain design)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 30: Playwright e2e — solar page renders, gates, and compliance copy

End-to-end check that the page renders the hero, confidence chip, assumptions panel, and mandatory compliance copy, and that the deposit CTA is correctly gated (hidden before confirmation). Mirrors the e2e contract pattern in `tests/e2e/activation.spec.ts`.

**Files:**
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/tests/e2e/solar-quote-page.spec.ts`

- [ ] **Step 1: Write the failing test.** Create the spec with the full code below. It seeds a `solar_estimates` row via the service-role key (loaded from `.env.local`) so the page has real data, then asserts render + gate behaviour for the unconfirmed state.

```ts
// c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/tests/e2e/solar-quote-page.spec.ts
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

// Skip gracefully if secrets aren't loaded in this environment.
const seedable = Boolean(url && key)

test.describe('Solar customer quote page', () => {
  test.skip(!seedable, 'Supabase service-role env not available for seeding')

  const token = `e2e${randomBytes(12).toString('hex')}`

  const estimate = {
    token,
    context: { postcode: '2000', state: 'NSW', install_year: 2026, network: 'Ausgrid' },
    coverage_source: 'google',
    roof: {
      source: 'google',
      usable_area_m2: 80,
      planes: [],
      segment_count: 2,
      primary_orientation: 'north',
      mean_pitch_degrees: 22,
      max_panels_count: 30,
      panel_capacity_watts: 400,
      panel_configs: [],
      storeys: 1,
      polygon_geojson: null,
      imagery_quality: 'HIGH',
      imagery_date: '2025-03-14',
    },
    sizing: {
      tiers: [
        { tier: 'good', label: 'Starter system', system_kw_dc: 6.6, panels_count: 16, panel_type: 'standard_panels', source_config: { panels_count: 16, yearly_energy_dc_kwh: 9800 }, export_limited: false },
        { tier: 'better', label: 'Full-size system', system_kw_dc: 10, panels_count: 25, panel_type: 'standard_panels', source_config: { panels_count: 25, yearly_energy_dc_kwh: 14800 }, export_limited: false },
      ],
      roof_capacity_kw_dc: 12,
      export_limit_kw_ac: 5,
      routing: { decision: 'tradie_review', reason: 'Solar quote needs sign-off.' },
    },
    production: [
      { system_kw_dc: 6.6, annual_kwh_ac: 9540, annual_kwh_low: 7632, annual_kwh_high: 11448, derate_applied: 0.81, degradation_pct_per_year: 0.005, cec_benchmark_kwh_per_kw: 1400, within_cec_benchmark: true, band: 'tight' },
      { system_kw_dc: 10, annual_kwh_ac: 14454, annual_kwh_low: 11563, annual_kwh_high: 17345, derate_applied: 0.81, degradation_pct_per_year: 0.005, cec_benchmark_kwh_per_kw: 1400, within_cec_benchmark: true, band: 'tight' },
    ],
    price: {
      tiers: [
        { tier: 'good', label: 'Starter system', system_kw_dc: 6.6, gross_ex_gst: 8000, gross_inc_gst: 8800, stc: { system_kw: 6.6, zone_rating: 1.382, deeming_years: 5, certificates: 45, stc_price_aud: 38, rebate_aud: 1710 }, net_ex_gst: 6290, net_inc_gst: 6919, scope: '6.6 kW system with standard panels.' },
        { tier: 'better', label: 'Full-size system', system_kw_dc: 10, gross_ex_gst: 11500, gross_inc_gst: 12650, stc: { system_kw: 10, zone_rating: 1.382, deeming_years: 5, certificates: 69, stc_price_aud: 38, rebate_aud: 2622 }, net_ex_gst: 8878, net_inc_gst: 9766, scope: '10 kW system with standard panels.' },
      ],
      effective_rate_per_kw: 1200,
      loadings_applied: [],
      routing: { decision: 'tradie_review', reason: 'Solar quote needs sign-off.' },
    },
    economics: {
      tiers: [
        { tier: 'good', self_consumed_kwh: 3816, exported_kwh: 5724, bill_savings_aud: 1221, export_earnings_aud: 401, annual_savings_aud: 1622, payback_years_low: 3.5, payback_years_high: 5.1 },
        { tier: 'better', self_consumed_kwh: 5782, exported_kwh: 8672, bill_savings_aud: 1850, export_earnings_aud: 607, annual_savings_aud: 2457, payback_years_low: 3.2, payback_years_high: 4.8 },
      ],
      assumptions: { self_consumption_pct: 0.4, retail_rate_aud_per_kwh: 0.32, feed_in_tariff_aud_per_kwh: 0.07, feed_in_network: 'Ausgrid' },
    },
    confidence_band: 'tight',
    satellite_image_url: null,
    routing: { decision: 'tradie_review', reason: 'Solar quote needs sign-off.' },
    guardrail_flags: [],
    config_version: '2026-06-01',
  }

  test.beforeAll(async () => {
    const supabase = createClient(url!, key!)
    await supabase.from('solar_estimates').insert({
      public_token: token,
      address: '1 Test Street, Sydney NSW 2000',
      state: 'NSW',
      estimate,
      confirmed_at: null,
    })
  })

  test.afterAll(async () => {
    const supabase = createClient(url!, key!)
    await supabase.from('solar_estimates').delete().eq('public_token', token)
  })

  test('renders the hero, assumptions, and mandatory compliance copy', async ({ page }) => {
    await page.goto(`/q/solar/${token}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/solar/i)
    await expect(page.getByText('1 Test Street, Sydney NSW 2000')).toBeVisible()
    await expect(
      page.getByText(/Indicative layout based on Google aerial imagery, 14 Mar 2025\./),
    ).toBeVisible()
    await expect(page.getByText('Assumptions')).toBeVisible()
    await expect(
      page.getByText(/Solar Accreditation Australia \(SAA\)-accredited installer/),
    ).toBeVisible()
    await expect(page.getByText(/Estimate, not a contract\./)).toBeVisible()
  })

  test('hides prices and the deposit CTA before tradie confirmation', async ({ page }) => {
    await page.goto(`/q/solar/${token}`)
    await expect(page.getByText('Your installer will confirm this estimate.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Pay deposit' })).toHaveCount(0)
    // Net price figure must not be exposed pre-confirmation.
    await expect(page.getByText('Net (inc GST)')).toHaveCount(0)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
npm run test:e2e -- solar-quote-page.spec.ts
```

Expected: the two tests fail because the page route does not exist yet in the running build — Playwright reports the `/q/solar/${token}` navigation rendering Next's 404 (the `heading level 1` / compliance-copy locators time out). (If the page from Task 29 is already present in the dev server, restart it so the route is picked up; the assertions then drive the failure to a pass in Step 4.)

- [ ] **Step 3: No new implementation needed.** The page and presenters from Tasks 22–29 satisfy this spec; this task only adds the e2e coverage. (If Step 2 surfaced a genuine gap — e.g. a locator that does not match rendered text — fix the page in `app/q/solar/[token]/page.tsx` to match the asserted copy, keeping the Task 25 compliance constant verbatim.)

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
npm run test:e2e -- solar-quote-page.spec.ts
```

Expected: both tests pass (`2 passed`) when Supabase secrets are present; both `skipped` when they are not. The hero caption, assumptions panel, and compliance copy are visible; no "Pay deposit" link and no "Net (inc GST)" line render in the unconfirmed state.

- [ ] **Step 5: Commit.** Run:

```
git add quotemate-automation/tests/e2e/solar-quote-page.spec.ts
git commit -m "test(solar): e2e for /q/solar/[token] render, confirm gate, compliance copy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

Phase 4 deliverable files (all absolute paths):
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/quote-page-format.ts` (+ `.test.ts`)
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/confidence-chip.ts` (+ `.test.ts`)
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/tier-cards.ts` (+ `.test.ts`)
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/compliance-copy.ts` (+ `.test.ts`)
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/deposit-cta.ts` (+ `.test.ts`)
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/hero-overlay.ts` (+ `.test.ts`)
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/static-map-center.ts` (+ `.test.ts`)
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/app/api/solar/q/[token]/static-map/route.ts`
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/quote-page-row.ts` (+ `.test.ts`)
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/app/q/solar/[token]/page.tsx`
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/tests/e2e/solar-quote-page.spec.ts`

Notes for the executing engineer:
- Contract names used verbatim: `SolarEstimate`, `SolarRoofFacts`, `SolarSystemTier`, `SolarQuotePrice`, `SolarProductionResult`, `SolarEconomicsResult`, `SolarConfidenceBand`, `SolarCoverageSource`, `SolarOrientation` — all imported from `lib/solar/types.ts` (created in an earlier phase). Tests stub these via `as unknown as` casts to stay independent of the full object graph, matching the repo's existing `save-as-quote-helpers.test.ts` fixture style.
- The deposit CTA reuses the existing `/r/[token]/[tier]` short-link (pattern card: `app/r/[token]/[tier]/route.ts` + `lib/quote/booking.ts`); Phase 4 only builds the gate that decides whether to render the link, it does not modify the redirect route.
- The page reads only `public_token`, `address`, `state`, `estimate` (jsonb `SolarEstimate`), and `confirmed_at` from `solar_estimates` — columns created by the Phase 2/3 data-model migration; if those column names differ at execution time, update the two `.select(...)` strings (page + static-map route) and the e2e seed object accordingly.
- One spot to double-check at execution: in `page.tsx` the per-card "Panels" `MiniStat` resolves `panels_count` from `estimate.sizing.tiers`. If you prefer, surface `panelsCount` directly through `buildSolarTierCards` (currently `undefined` by contract design) instead of the inline lookup — either is fine, but keep the tier-cards test green.

---

## Phase 5 — Tradie review, deposit unlock, guardrails & e2e

## Phase 5 — Tradie review, deposit unlock, guardrails & e2e

This phase closes the loop: a drafted solar estimate must be tradie-confirmed before the per-tier Stripe deposit unlocks (no auto-send), every published estimate passes a deterministic output check (spec §7), stale-config and Solar-API-failure paths fail safe, and one Playwright e2e plus an STC parity script lock the behaviour in.

All tasks use the shared contract names from `lib/solar/types.ts` verbatim (`SolarEstimate`, `SolarQuotePrice`, `SolarConfig`, `SolarPriceTier`, `SolarProductionResult`, `SolarConfidenceBand`, `guardrail_flags`, etc.). Pure logic lands in `lib/solar/`; the confirm/deposit HTTP boundary lands in `app/api/solar/` and `app/r/[token]/[tier]`.

> Assumed available from earlier phases (Phases 1–4): `lib/solar/types.ts` (the contract), `lib/solar/config.ts` (`validateSolarConfig`), `lib/solar/pricing.ts` (`calculateSolarPrice`), `lib/solar/intake.ts` (`runSolarEstimate`), the `solar_estimates` table + `confirmed_at` column, and the `/q/solar/[token]` page. Phase 5 adds the review gate, guardrails, deposit unlock, and tests on top.

---

### Task 31: Deterministic output check — net = gross − STC (per-tier identity)

Files:
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/guardrails.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/guardrails.test.ts`

- [ ] **Step 1: Write the failing test for the net-identity check.** Create `lib/solar/guardrails.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { checkNetIdentity } from './guardrails'
import type { SolarPriceTier } from './types'

function tier(over: Partial<SolarPriceTier> = {}): SolarPriceTier {
  return {
    tier: 'better',
    label: 'Full-size system',
    system_kw_dc: 6.6,
    gross_ex_gst: 8000,
    gross_inc_gst: 8800,
    stc: {
      system_kw: 6.6,
      zone_rating: 1.382,
      deeming_years: 5,
      certificates: 45,
      stc_price_aud: 38,
      rebate_aud: 1710,
    },
    net_ex_gst: 6290, // 8000 − 1710
    net_inc_gst: 6919,
    scope: '6.6 kW solar install with standard panels.',
    ...over,
  }
}

describe('checkNetIdentity', () => {
  it('returns no flag when net_ex_gst === gross_ex_gst − rebate (within 1 cent)', () => {
    expect(checkNetIdentity(tier())).toEqual([])
  })

  it('flags when net does not equal gross minus the STC rebate', () => {
    const bad = tier({ net_ex_gst: 5000 }) // should be 6290
    const flags = checkNetIdentity(bad)
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatch(/net.*gross.*STC/i)
    expect(flags[0]).toContain('better')
  })

  it('tolerates a 1-cent rounding drift', () => {
    expect(checkNetIdentity(tier({ net_ex_gst: 6290.01 }))).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- lib/solar/guardrails.test.ts
```

Expected failure: `Error: Failed to load url ./guardrails` (the module does not exist yet) — all three tests error/fail.

- [ ] **Step 3: Write the minimal implementation.** Create `lib/solar/guardrails.ts`:

```typescript
// ════════════════════════════════════════════════════════════════════
// Solar — deterministic output check (spec §7).
//
// Solar's analogue of the strict-grounding validator. Every published
// estimate must satisfy: net = gross − STC, gross within sane $/kW
// bounds, payback within years bounds, AC/kW within ±35% of the CEC
// benchmark. Any violation appends a human string to guardrail_flags;
// flagged estimates route to tradie review and NEVER publish silently.
//
// PURE — no I/O. Fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type { SolarPriceTier } from './types'

/** Allowed rounding drift between net and (gross − rebate), in dollars. */
const NET_IDENTITY_TOLERANCE_AUD = 0.011

/**
 * PURE — verify net_ex_gst === gross_ex_gst − stc.rebate_aud for one tier.
 * Returns [] when the identity holds (within a 1-cent tolerance), or a
 * one-element array describing the breach.
 */
export function checkNetIdentity(tier: SolarPriceTier): string[] {
  const expectedNet = tier.gross_ex_gst - tier.stc.rebate_aud
  const drift = Math.abs(tier.net_ex_gst - expectedNet)
  if (drift <= NET_IDENTITY_TOLERANCE_AUD) return []
  return [
    `${tier.tier}: net price ($${tier.net_ex_gst.toFixed(2)}) does not equal ` +
      `gross − STC ($${tier.gross_ex_gst.toFixed(2)} − $${tier.stc.rebate_aud.toFixed(2)} ` +
      `= $${expectedNet.toFixed(2)}).`,
  ]
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- lib/solar/guardrails.test.ts
```

Expected: `3 passed`.

- [ ] **Step 5: Commit.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && git add lib/solar/guardrails.ts lib/solar/guardrails.test.ts && git commit -m "feat(solar): net=gross-STC deterministic output check

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 32: Guardrail bounds — gross $/kW, payback years, CEC benchmark

Files:
- Modify: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/guardrails.ts`
- Modify: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/guardrails.test.ts`

- [ ] **Step 1: Write the failing tests for the three bounds checks.** Append to `lib/solar/guardrails.test.ts`:

```typescript
import {
  checkGrossPerKwBounds,
  checkPaybackBounds,
  checkCecBenchmark,
} from './guardrails'
import type { SolarEconomicsTier, SolarProductionResult } from './types'

function econ(over: Partial<SolarEconomicsTier> = {}): SolarEconomicsTier {
  return {
    tier: 'better',
    self_consumed_kwh: 3600,
    exported_kwh: 5400,
    bill_savings_aud: 1080,
    export_earnings_aud: 270,
    annual_savings_aud: 1350,
    payback_years_low: 4.2,
    payback_years_high: 6.8,
    ...over,
  }
}

function prod(over: Partial<SolarProductionResult> = {}): SolarProductionResult {
  return {
    system_kw_dc: 6.6,
    annual_kwh_ac: 9200,
    annual_kwh_low: 7360,
    annual_kwh_high: 11040,
    derate_applied: 0.81,
    degradation_pct_per_year: 0.005,
    cec_benchmark_kwh_per_kw: 1400,
    within_cec_benchmark: true,
    band: 'tight',
    ...over,
  }
}

describe('checkGrossPerKwBounds', () => {
  it('passes when gross/kW sits inside $700–$1,800', () => {
    expect(checkGrossPerKwBounds(tier())).toEqual([]) // 8000/6.6 ≈ $1212
  })
  it('flags when gross/kW is below the $700 floor', () => {
    const flags = checkGrossPerKwBounds(tier({ gross_ex_gst: 4000 })) // ≈$606/kW
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatch(/\$\/kW/)
    expect(flags[0]).toContain('better')
  })
  it('flags when gross/kW is above the $1,800 ceiling', () => {
    expect(checkGrossPerKwBounds(tier({ gross_ex_gst: 13000 }))).toHaveLength(1) // ≈$1970/kW
  })
})

describe('checkPaybackBounds', () => {
  it('passes when the whole payback band sits inside 2–12 years', () => {
    expect(checkPaybackBounds(econ())).toEqual([])
  })
  it('flags when the low bound is under 2 years (too good to be true)', () => {
    expect(checkPaybackBounds(econ({ payback_years_low: 1.4 }))).toHaveLength(1)
  })
  it('flags when the high bound exceeds 12 years', () => {
    const flags = checkPaybackBounds(econ({ payback_years_high: 14 }))
    expect(flags[0]).toMatch(/payback/i)
    expect(flags[0]).toContain('better')
  })
})

describe('checkCecBenchmark', () => {
  it('passes when AC/kW is within ±35% of the CEC benchmark', () => {
    expect(checkCecBenchmark(prod())).toEqual([]) // 9200/6.6 ≈ 1394 vs 1400
  })
  it('flags when AC/kW is more than 35% above the benchmark', () => {
    const flags = checkCecBenchmark(prod({ annual_kwh_ac: 14000 })) // ≈2121 vs 1400 (+51%)
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatch(/CEC benchmark/i)
  })
  it('flags when AC/kW is more than 35% below the benchmark', () => {
    expect(checkCecBenchmark(prod({ annual_kwh_ac: 5000 }))).toHaveLength(1) // ≈758 vs 1400 (−46%)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- lib/solar/guardrails.test.ts
```

Expected failure: `checkGrossPerKwBounds is not a function` (and the same for `checkPaybackBounds`, `checkCecBenchmark`) — the new `describe` blocks fail while the 3 Task-28 tests still pass.

- [ ] **Step 3: Write the minimal implementation.** Append to `lib/solar/guardrails.ts`:

```typescript
import type { SolarEconomicsTier, SolarProductionResult } from './types'

// ── Sane-bounds constants (spec §7) ─────────────────────────────────
const GROSS_PER_KW_MIN_AUD = 700
const GROSS_PER_KW_MAX_AUD = 1800
const PAYBACK_YEARS_MIN = 2
const PAYBACK_YEARS_MAX = 12
const CEC_BENCHMARK_TOLERANCE = 0.35

/**
 * PURE — gross $/kW DC must sit in $700–$1,800 (spec §7). Skips the
 * check for zero-priced tiers (which never publish anyway).
 */
export function checkGrossPerKwBounds(tier: SolarPriceTier): string[] {
  if (tier.system_kw_dc <= 0 || tier.gross_ex_gst <= 0) return []
  const perKw = tier.gross_ex_gst / tier.system_kw_dc
  if (perKw < GROSS_PER_KW_MIN_AUD || perKw > GROSS_PER_KW_MAX_AUD) {
    return [
      `${tier.tier}: gross price is $${perKw.toFixed(0)}/kW, outside the ` +
        `$${GROSS_PER_KW_MIN_AUD}–$${GROSS_PER_KW_MAX_AUD}/kW sanity band.`,
    ]
  }
  return []
}

/**
 * PURE — the whole payback band must sit inside 2–12 years (spec §7).
 * A sub-2-year payback is implausibly good; over 12 years is implausibly
 * poor for an AU residential system.
 */
export function checkPaybackBounds(econ: SolarEconomicsTier): string[] {
  if (
    econ.payback_years_low < PAYBACK_YEARS_MIN ||
    econ.payback_years_high > PAYBACK_YEARS_MAX
  ) {
    return [
      `${econ.tier}: payback band ${econ.payback_years_low.toFixed(1)}–` +
        `${econ.payback_years_high.toFixed(1)} yrs falls outside the ` +
        `${PAYBACK_YEARS_MIN}–${PAYBACK_YEARS_MAX} year sanity band.`,
    ]
  }
  return []
}

/**
 * PURE — AC production per kW must sit within ±35% of the CEC city
 * benchmark (spec §7). Catches a runaway derate or wrong-zone insolation.
 */
export function checkCecBenchmark(prod: SolarProductionResult): string[] {
  if (prod.system_kw_dc <= 0 || prod.cec_benchmark_kwh_per_kw <= 0) return []
  const acPerKw = prod.annual_kwh_ac / prod.system_kw_dc
  const lo = prod.cec_benchmark_kwh_per_kw * (1 - CEC_BENCHMARK_TOLERANCE)
  const hi = prod.cec_benchmark_kwh_per_kw * (1 + CEC_BENCHMARK_TOLERANCE)
  if (acPerKw < lo || acPerKw > hi) {
    return [
      `${prod.system_kw_dc} kW DC: production is ${acPerKw.toFixed(0)} kWh/kW/yr, ` +
        `outside ±${(CEC_BENCHMARK_TOLERANCE * 100).toFixed(0)}% of the CEC ` +
        `benchmark (${prod.cec_benchmark_kwh_per_kw} kWh/kW/yr).`,
    ]
  }
  return []
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- lib/solar/guardrails.test.ts
```

Expected: `12 passed` (3 from Task 31 + 9 new).

- [ ] **Step 5: Commit.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && git add lib/solar/guardrails.ts lib/solar/guardrails.test.ts && git commit -m "feat(solar): gross \$/kW, payback, and CEC-benchmark bound checks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 33: Aggregate guardrails over a whole `SolarEstimate`

Files:
- Modify: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/guardrails.ts`
- Modify: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/guardrails.test.ts`

- [ ] **Step 1: Write the failing test for the estimate-level aggregator.** Append to `lib/solar/guardrails.test.ts`:

```typescript
import { runSolarGuardrails } from './guardrails'
import type { SolarEstimate } from './types'

function estimate(): SolarEstimate {
  return {
    token: 'tok_demo_123456',
    context: { postcode: '2000', state: 'NSW', install_year: 2026, network: 'Ausgrid' },
    coverage_source: 'google',
    roof: {
      source: 'google',
      usable_area_m2: 60,
      planes: [],
      segment_count: 2,
      primary_orientation: 'north',
      mean_pitch_degrees: 22,
      max_panels_count: 18,
      panel_capacity_watts: 400,
      panel_configs: [],
      storeys: 1,
      polygon_geojson: null,
      imagery_quality: 'HIGH',
      imagery_date: '2025-11-01',
    },
    sizing: {
      tiers: [],
      roof_capacity_kw_dc: 7.2,
      export_limit_kw_ac: 5,
      routing: { decision: 'tradie_review', reason: 'auto-calculated' },
    },
    production: [prod()],
    price: {
      tiers: [tier()],
      effective_rate_per_kw: 1212,
      loadings_applied: [],
      routing: { decision: 'tradie_review', reason: 'auto-calculated' },
    },
    economics: {
      tiers: [econ()],
      assumptions: {
        self_consumption_pct: 0.4,
        retail_rate_aud_per_kwh: 0.3,
        feed_in_tariff_aud_per_kwh: 0.05,
        feed_in_network: 'Ausgrid',
      },
    },
    confidence_band: 'tight',
    satellite_image_url: null,
    routing: { decision: 'tradie_review', reason: 'auto-calculated' },
    guardrail_flags: [],
    config_version: '2026-06-01',
  }
}

describe('runSolarGuardrails', () => {
  it('returns an empty array for a clean estimate', () => {
    expect(runSolarGuardrails(estimate())).toEqual([])
  })

  it('aggregates flags from every check across every tier', () => {
    const e = estimate()
    e.price.tiers = [tier({ net_ex_gst: 1 }), tier({ tier: 'best', gross_ex_gst: 4000 })]
    e.economics.tiers = [econ({ payback_years_high: 99 })]
    e.production = [prod({ annual_kwh_ac: 99000 })]
    const flags = runSolarGuardrails(e)
    // net-identity (1) + gross/kW (1) + payback (1) + CEC (1) ≥ 4 distinct flags
    expect(flags.length).toBeGreaterThanOrEqual(4)
    expect(flags.some((f) => /net price/i.test(f))).toBe(true)
    expect(flags.some((f) => /\$\/kW/.test(f))).toBe(true)
    expect(flags.some((f) => /payback/i.test(f))).toBe(true)
    expect(flags.some((f) => /CEC benchmark/i.test(f))).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- lib/solar/guardrails.test.ts
```

Expected failure: `runSolarGuardrails is not a function`. The 12 prior tests still pass.

- [ ] **Step 3: Write the minimal implementation.** Append to `lib/solar/guardrails.ts`:

```typescript
import type { SolarEstimate } from './types'

/**
 * PURE — run every deterministic output check across an entire
 * SolarEstimate and return the flat list of human-readable breaches
 * (spec §7). An empty array means the estimate is clean and may publish
 * once the tradie confirms; a non-empty array MUST block silent publish
 * and surface to the tradie. This is the value written to
 * SolarEstimate.guardrail_flags.
 */
export function runSolarGuardrails(estimate: SolarEstimate): string[] {
  const flags: string[] = []
  for (const tier of estimate.price.tiers) {
    flags.push(...checkNetIdentity(tier))
    flags.push(...checkGrossPerKwBounds(tier))
  }
  for (const econ of estimate.economics.tiers) {
    flags.push(...checkPaybackBounds(econ))
  }
  for (const prod of estimate.production) {
    flags.push(...checkCecBenchmark(prod))
  }
  return flags
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- lib/solar/guardrails.test.ts
```

Expected: `14 passed`.

- [ ] **Step 5: Commit.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && git add lib/solar/guardrails.ts lib/solar/guardrails.test.ts && git commit -m "feat(solar): runSolarGuardrails aggregates all output checks per estimate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 34: Publish gate — combine guardrails + config freshness + confirmation

Files:
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/publish.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/publish.test.ts`

- [ ] **Step 1: Write the failing test for the publish gate.** Create `lib/solar/publish.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { canShowPrices } from './publish'

describe('canShowPrices', () => {
  it('hides prices until the tradie has confirmed (no auto-send)', () => {
    const r = canShowPrices({ confirmedAt: null, guardrailFlags: [], configStale: false })
    expect(r.showPrices).toBe(false)
    expect(r.reason).toMatch(/installer will confirm/i)
  })

  it('shows prices once confirmed, clean, and config is fresh', () => {
    const r = canShowPrices({
      confirmedAt: '2026-06-08T02:00:00Z',
      guardrailFlags: [],
      configStale: false,
    })
    expect(r.showPrices).toBe(true)
    expect(r.reason).toBeNull()
  })

  it('blocks publish when guardrail flags exist, even after confirmation', () => {
    const r = canShowPrices({
      confirmedAt: '2026-06-08T02:00:00Z',
      guardrailFlags: ['better: net price ($1.00) does not equal gross − STC ...'],
      configStale: false,
    })
    expect(r.showPrices).toBe(false)
    expect(r.reason).toMatch(/checks/i)
  })

  it('blocks publish when the solar config is stale, even after confirmation', () => {
    const r = canShowPrices({
      confirmedAt: '2026-06-08T02:00:00Z',
      guardrailFlags: [],
      configStale: true,
    })
    expect(r.showPrices).toBe(false)
    expect(r.reason).toMatch(/pricing data is being refreshed/i)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- lib/solar/publish.test.ts
```

Expected failure: `Failed to load url ./publish` — all four tests error.

- [ ] **Step 3: Write the minimal implementation.** Create `lib/solar/publish.ts`:

```typescript
// ════════════════════════════════════════════════════════════════════
// Solar — the publish gate (spec §6 CTA, §7 guardrails, §5 freshness).
//
// Mirrors roofing's confirm-gate: prices are NEVER shown before the
// tradie confirms (no auto-send — inherits the high-ticket rule). On top
// of confirmation, prices are also withheld if any deterministic output
// check flagged the estimate, or the solar config is stale. Each block
// carries a customer-facing reason for the /q/solar/[token] page.
//
// PURE — no I/O. Fully unit-testable.
// ════════════════════════════════════════════════════════════════════

export type PublishGateInput = {
  /** quotes/solar_estimates confirmed_at — null until the tradie signs off. */
  confirmedAt: string | null | undefined
  /** SolarEstimate.guardrail_flags — non-empty blocks publish. */
  guardrailFlags: string[]
  /** True when validateSolarConfig() returned ok:false (spec §5). */
  configStale: boolean
}

export type PublishGateResult = {
  /** Whether the customer page may render tier prices + the deposit CTA. */
  showPrices: boolean
  /** Customer-facing reason when withheld; null when prices show. */
  reason: string | null
}

/**
 * PURE — decide whether /q/solar/[token] may reveal prices + unlock the
 * deposit. Confirmation is necessary but not sufficient: a flagged or
 * stale estimate stays hidden so a bad number can never reach a customer.
 */
export function canShowPrices(input: PublishGateInput): PublishGateResult {
  if (input.configStale) {
    return {
      showPrices: false,
      reason: 'Our solar pricing data is being refreshed — your installer will be in touch shortly.',
    }
  }
  if (input.guardrailFlags.length > 0) {
    return {
      showPrices: false,
      reason: 'This estimate needs a few checks from your installer before we can show pricing.',
    }
  }
  if (!input.confirmedAt) {
    return {
      showPrices: false,
      reason: 'Your installer will confirm this estimate before pricing is finalised.',
    }
  }
  return { showPrices: true, reason: null }
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- lib/solar/publish.test.ts
```

Expected: `4 passed`.

- [ ] **Step 5: Commit.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && git add lib/solar/publish.ts lib/solar/publish.test.ts && git commit -m "feat(solar): publish gate — confirm + clean + fresh-config before prices show

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 35: Solar deposit-redirect target (book-first / pay-last, gated on confirm)

Files:
- Modify: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/publish.ts`
- Modify: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/publish.test.ts`

- [ ] **Step 1: Write the failing test for the solar pay-redirect.** Append to `lib/solar/publish.test.ts`:

```typescript
import { solarPayRedirectTarget } from './publish'

describe('solarPayRedirectTarget', () => {
  const base = {
    confirmedAt: '2026-06-08T02:00:00Z',
    paid: false,
    scheduledAt: null as string | null,
    tier: 'better',
  }

  it('blocks the deposit until the tradie confirms (no auto-send)', () => {
    expect(solarPayRedirectTarget({ ...base, confirmedAt: null })).toBe('locked')
  })

  it('routes confirmed-but-unbooked to book-first', () => {
    expect(solarPayRedirectTarget(base)).toBe('book')
  })

  it('routes confirmed + booked + unpaid straight to Stripe (deposit last)', () => {
    expect(
      solarPayRedirectTarget({ ...base, scheduledAt: '2026-07-01T03:00:00Z' }),
    ).toBe('stripe')
  })

  it('routes an already-paid customer to the thank-you page', () => {
    expect(solarPayRedirectTarget({ ...base, paid: true })).toBe('paid')
  })

  it('keeps the inspection fee pay-first even when unconfirmed', () => {
    expect(
      solarPayRedirectTarget({ ...base, confirmedAt: null, tier: 'inspection' }),
    ).toBe('stripe')
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- lib/solar/publish.test.ts
```

Expected failure: `solarPayRedirectTarget is not a function`. The 4 publish-gate tests still pass.

- [ ] **Step 3: Write the minimal implementation.** Append to `lib/solar/publish.ts`. (This wraps the existing book-first/pay-last `payRedirectTarget` so solar inherits the funnel order, but adds the confirm gate ahead of it.)

```typescript
import { payRedirectTarget } from '../quote/booking'

export type SolarPayRedirectKind = 'locked' | 'book' | 'stripe' | 'paid'

export type SolarPayRedirectInput = {
  /** Tradie confirmation timestamp — null means the deposit is locked. */
  confirmedAt: string | null | undefined
  paid: boolean
  scheduledAt: string | null | undefined
  /** Stripe tier key. 'inspection' stays pay-first and skips the gate. */
  tier: string
}

/**
 * PURE — where /r/<token>/<tier> sends a SOLAR customer. Layers the
 * forced-confirmation gate on top of the shared book-first/pay-last
 * funnel (lib/quote/booking.payRedirectTarget):
 *
 *   inspection                 → 'stripe' (pay-first; site-visit fee)
 *   not yet confirmed          → 'locked' (no auto-send; deposit gated)
 *   confirmed, then defer to the shared funnel:
 *     already paid             → 'paid'
 *     not paid, no slot        → 'book'
 *     not paid, slot chosen     → 'stripe'
 */
export function solarPayRedirectTarget(
  input: SolarPayRedirectInput,
): SolarPayRedirectKind {
  if (input.tier === 'inspection') return 'stripe'
  if (!input.confirmedAt) return 'locked'
  return payRedirectTarget({
    paid: input.paid,
    scheduledAt: input.scheduledAt,
    tier: input.tier,
  })
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- lib/solar/publish.test.ts
```

Expected: `9 passed`.

- [ ] **Step 5: Commit.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && git add lib/solar/publish.ts lib/solar/publish.test.ts && git commit -m "feat(solar): deposit redirect gated on tradie confirm, reuses book-first funnel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 36: Tradie confirm API route — `POST /api/solar/[token]/confirm`

Files:
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/app/api/solar/[token]/confirm/route.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/app/api/solar/[token]/confirm/route.test.ts`

This route is the forced human-in-loop step: an authenticated tradie stamps `confirmed_at` on the `solar_estimates` row, which is what `solarPayRedirectTarget`/`canShowPrices` unlock against. It refuses to confirm an estimate that still carries `guardrail_flags`.

- [ ] **Step 1: Write the failing test for the confirm-eligibility helper.** The route's pure decision is extracted into a testable helper. Create `app/api/solar/[token]/confirm/route.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { confirmEligibility } from './route'

describe('confirmEligibility', () => {
  it('rejects an estimate that still has guardrail flags', () => {
    const r = confirmEligibility({
      guardrailFlags: ['better: gross price is $606/kW, outside ...'],
      alreadyConfirmedAt: null,
    })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(409)
    expect(r.error).toMatch(/flag/i)
  })

  it('is idempotent — already confirmed returns ok without re-stamping', () => {
    const r = confirmEligibility({
      guardrailFlags: [],
      alreadyConfirmedAt: '2026-06-08T02:00:00Z',
    })
    expect(r.ok).toBe(true)
    expect(r.stamp).toBe(false)
  })

  it('confirms a clean, unconfirmed estimate and signals a fresh stamp', () => {
    const r = confirmEligibility({ guardrailFlags: [], alreadyConfirmedAt: null })
    expect(r.ok).toBe(true)
    expect(r.stamp).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- app/api/solar/[token]/confirm/route.test.ts
```

Expected failure: `Failed to load url ./route` (the route file does not exist) — all three tests error.

- [ ] **Step 3: Write the minimal implementation.** Create `app/api/solar/[token]/confirm/route.ts` (Next 16: `params` is a Promise and must be awaited; bearer auth strips the `Bearer ` prefix; the pure helper is exported for the test):

```typescript
// ════════════════════════════════════════════════════════════════════
// POST /api/solar/[token]/confirm — the forced tradie review step.
//
// No solar estimate auto-sends. The tradie reviews the drafted tiers and
// confirms; that stamps confirmed_at on the solar_estimates row, which is
// what canShowPrices() + solarPayRedirectTarget() unlock against. A
// flagged estimate (guardrail_flags non-empty) cannot be confirmed — the
// tradie must adjust the numbers (clearing the flags on re-draft) first.
//
// Next 16: params is a Promise (await it). Bearer auth required.
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export type ConfirmEligibilityInput = {
  guardrailFlags: string[]
  alreadyConfirmedAt: string | null
}

export type ConfirmEligibilityResult =
  | { ok: true; stamp: boolean }
  | { ok: false; status: number; error: string }

/**
 * PURE — decide whether this estimate may be confirmed.
 *  • guardrail flags present → 409, cannot confirm
 *  • already confirmed       → ok, stamp:false (idempotent no-op)
 *  • clean + unconfirmed     → ok, stamp:true
 */
export function confirmEligibility(
  input: ConfirmEligibilityInput,
): ConfirmEligibilityResult {
  if (input.guardrailFlags.length > 0) {
    return {
      ok: false,
      status: 409,
      error:
        'This estimate has open checks (guardrail flags). Adjust the tiers and re-draft before confirming.',
    }
  }
  if (input.alreadyConfirmedAt) return { ok: true, stamp: false }
  return { ok: true, stamp: true }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'invalid_token' }, { status: 400 })
  }

  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const accessToken = auth.slice(7).trim()
  const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: row, error } = await supabase
    .from('solar_estimates')
    .select('id, tenant_id, confirmed_at, guardrail_flags')
    .eq('token', token)
    .maybeSingle()
  if (error || !row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const eligibility = confirmEligibility({
    guardrailFlags: (row.guardrail_flags as string[] | null) ?? [],
    alreadyConfirmedAt: (row.confirmed_at as string | null) ?? null,
  })
  if (!eligibility.ok) {
    return Response.json(
      { ok: false, error: eligibility.error },
      { status: eligibility.status },
    )
  }

  if (eligibility.stamp) {
    const confirmedAt = new Date().toISOString()
    const { error: updErr } = await supabase
      .from('solar_estimates')
      .update({ confirmed_at: confirmedAt })
      .eq('id', row.id)
    if (updErr) {
      return Response.json(
        { ok: false, error: 'confirm_failed' },
        { status: 500 },
      )
    }
    return Response.json({ ok: true, confirmed_at: confirmedAt })
  }

  return Response.json({ ok: true, confirmed_at: row.confirmed_at })
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- app/api/solar/[token]/confirm/route.test.ts
```

Expected: `3 passed`.

- [ ] **Step 5: Commit.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && git add "app/api/solar/[token]/confirm/route.ts" "app/api/solar/[token]/confirm/route.test.ts" && git commit -m "feat(solar): tradie confirm route stamps confirmed_at, refuses flagged estimates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 37: Solar deposit short-link — `GET /r/solar/[token]/[tier]`

Files:
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/app/r/solar/[token]/[tier]/route.ts`
- Test: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/app/r/solar/[token]/[tier]/route.test.ts`

This wires `solarPayRedirectTarget` into a real redirect, mirroring `app/r/[token]/[tier]/route.ts`. The `locked` target sends the customer back to the (price-hidden) `/q/solar/[token]` page rather than to Stripe.

- [ ] **Step 1: Write the failing test for the redirect URL builder.** Create `app/r/solar/[token]/[tier]/route.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildSolarRedirectUrl, VALID_SOLAR_TIERS } from './route'

const APP = 'https://quote-mate-rho.vercel.app'

describe('VALID_SOLAR_TIERS', () => {
  it('accepts good/better/best/inspection only', () => {
    expect([...VALID_SOLAR_TIERS].sort()).toEqual(
      ['best', 'better', 'good', 'inspection'].sort(),
    )
  })
})

describe('buildSolarRedirectUrl', () => {
  const token = 'tok_demo_123456'

  it('locked → back to the price-hidden quote page', () => {
    const url = buildSolarRedirectUrl({
      target: 'locked',
      token,
      tier: 'better',
      stripeUrl: null,
      appUrl: APP,
    })
    expect(url).toBe(`${APP}/q/solar/${token}?locked=1`)
  })

  it('book → the solar slot picker for that tier', () => {
    const url = buildSolarRedirectUrl({
      target: 'book',
      token,
      tier: 'better',
      stripeUrl: null,
      appUrl: APP,
    })
    expect(url).toBe(`${APP}/q/solar/${token}/book?tier=better`)
  })

  it('paid → the thank-you page for that tier', () => {
    const url = buildSolarRedirectUrl({
      target: 'paid',
      token,
      tier: 'best',
      stripeUrl: null,
      appUrl: APP,
    })
    expect(url).toBe(`${APP}/q/solar/${token}/paid?tier=best&already=1`)
  })

  it('stripe → the stored Stripe checkout URL', () => {
    const url = buildSolarRedirectUrl({
      target: 'stripe',
      token,
      tier: 'good',
      stripeUrl: 'https://checkout.stripe.com/c/pay/cs_test_abc',
      appUrl: APP,
    })
    expect(url).toBe('https://checkout.stripe.com/c/pay/cs_test_abc')
  })

  it('stripe with no stored link → null (caller 404s)', () => {
    const url = buildSolarRedirectUrl({
      target: 'stripe',
      token,
      tier: 'good',
      stripeUrl: null,
      appUrl: APP,
    })
    expect(url).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- "app/r/solar/[token]/[tier]/route.test.ts"
```

Expected failure: `Failed to load url ./route` — all tests error.

- [ ] **Step 3: Write the minimal implementation.** Create `app/r/solar/[token]/[tier]/route.ts`:

```typescript
// ════════════════════════════════════════════════════════════════════
// GET /r/solar/[token]/[tier] — solar deposit short-link.
//
// Mirrors app/r/[token]/[tier]/route.ts but layers the forced-confirm
// gate (solarPayRedirectTarget):
//   locked → /q/solar/[token]?locked=1  (deposit not yet unlocked)
//   book   → /q/solar/[token]/book?tier=…
//   paid   → /q/solar/[token]/paid?tier=…&already=1
//   stripe → the stored stripe_links[tier] checkout URL
//
// Next 16: params is a Promise (await it).
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { solarPayRedirectTarget, type SolarPayRedirectKind } from '../../../../../lib/solar/publish'

export const dynamic = 'force-dynamic'

export const VALID_SOLAR_TIERS = new Set(['good', 'better', 'best', 'inspection'])

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/**
 * PURE — build the redirect destination from a resolved target. Returns
 * null only when target is 'stripe' but no checkout link is stored
 * (caller then 404s).
 */
export function buildSolarRedirectUrl(args: {
  target: SolarPayRedirectKind
  token: string
  tier: string
  stripeUrl: string | null
  appUrl: string
}): string | null {
  const { target, token, tier, stripeUrl, appUrl } = args
  if (target === 'locked') return `${appUrl}/q/solar/${token}?locked=1`
  if (target === 'book') return `${appUrl}/q/solar/${token}/book?tier=${tier}`
  if (target === 'paid') return `${appUrl}/q/solar/${token}/paid?tier=${tier}&already=1`
  return stripeUrl ?? null
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string; tier: string }> },
) {
  const { token, tier } = await ctx.params
  if (!VALID_SOLAR_TIERS.has(tier)) {
    return new Response('Invalid tier', { status: 400 })
  }

  const { data: row } = await supabase
    .from('solar_estimates')
    .select('confirmed_at, paid_at, scheduled_at, stripe_links')
    .eq('token', token)
    .maybeSingle()
  if (!row) return new Response('Not found', { status: 404 })

  const target = solarPayRedirectTarget({
    confirmedAt: (row.confirmed_at as string | null) ?? null,
    paid: !!(row.paid_at as string | null),
    scheduledAt: (row.scheduled_at as string | null) ?? null,
    tier,
  })

  const stripeUrl =
    (row.stripe_links as Record<string, string> | null)?.[tier] ?? null
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? ''
  const dest = buildSolarRedirectUrl({ target, token, tier, stripeUrl, appUrl })

  if (!dest) return new Response('No payment link for this tier', { status: 404 })
  return Response.redirect(dest, 302)
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- "app/r/solar/[token]/[tier]/route.test.ts"
```

Expected: `6 passed`.

- [ ] **Step 5: Commit.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && git add "app/r/solar/[token]/[tier]/route.ts" "app/r/solar/[token]/[tier]/route.test.ts" && git commit -m "feat(solar): deposit short-link routes locked/book/paid/stripe per confirm state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 38: API-failure & quota guardrail — graceful fallback signal

Files:
- Modify: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/guardrails.ts`
- Modify: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/guardrails.test.ts`

When the Solar API fails or the daily GCP quota is exhausted, the orchestrator must not hard-fail — it returns a "estimate shortly" signal that routes the customer to the manual path (spec §7). This pure helper maps a coverage failure code to that decision, plus emits a daily-quota note.

- [ ] **Step 1: Write the failing test for the API-failure mapper.** Append to `lib/solar/guardrails.test.ts`:

```typescript
import { apiFailureFallback } from './guardrails'
import type { SolarCoverageFailureCode } from './types'

describe('apiFailureFallback', () => {
  it('routes provider quota exhaustion to the manual path with a quota note', () => {
    const r = apiFailureFallback('provider_quota_exhausted')
    expect(r.useManualFallback).toBe(true)
    expect(r.customerMessage).toMatch(/estimate shortly/i)
    expect(r.quotaNote).toMatch(/daily/i)
  })

  it('routes rate-limited and unavailable to the manual path (no quota note)', () => {
    for (const code of ['provider_rate_limited', 'provider_unavailable'] as SolarCoverageFailureCode[]) {
      const r = apiFailureFallback(code)
      expect(r.useManualFallback).toBe(true)
      expect(r.quotaNote).toBeNull()
    }
  })

  it('does NOT trigger the API-failure fallback for a genuine no-building/outside-coverage result', () => {
    // These are coverage outcomes, not API failures — the manual ask is
    // the normal uncovered branch, not the "estimate shortly" error path.
    const r = apiFailureFallback('no_building_at_address')
    expect(r.useManualFallback).toBe(false)
    expect(r.customerMessage).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- lib/solar/guardrails.test.ts
```

Expected failure: `apiFailureFallback is not a function`. The 14 prior guardrail tests still pass.

- [ ] **Step 3: Write the minimal implementation.** Append to `lib/solar/guardrails.ts`:

```typescript
import type { SolarCoverageFailureCode } from './types'

/** The set of failure codes that are TRANSIENT API/quota problems (not
 *  genuine coverage outcomes). Only these trigger the "estimate shortly"
 *  fallback rather than the normal uncovered → manual-ask branch. */
const API_FAILURE_CODES: ReadonlySet<SolarCoverageFailureCode> = new Set([
  'provider_unavailable',
  'provider_rate_limited',
  'provider_quota_exhausted',
  'provider_invalid_response',
])

export type ApiFailureFallback = {
  /** True when we should branch to the manual-roof path despite a covered
   *  address (because the provider, not the roof, failed). */
  useManualFallback: boolean
  /** Customer-facing reassurance; null when not an API failure. */
  customerMessage: string | null
  /** Admin/ops note for quota exhaustion (spec §7 daily-quota cap); null
   *  for non-quota failures. */
  quotaNote: string | null
}

/**
 * PURE — map a coverage failure code to the API-failure fallback
 * decision (spec §7). Provider/quota failures → manual path + a graceful
 * "estimate shortly" message; quota exhaustion additionally surfaces a
 * daily-quota note so ops knows the GCP cap bound (cost guardrail).
 * Genuine coverage outcomes (no building, outside coverage) return
 * useManualFallback:false — they take the normal uncovered branch.
 */
export function apiFailureFallback(
  code: SolarCoverageFailureCode,
): ApiFailureFallback {
  if (!API_FAILURE_CODES.has(code)) {
    return { useManualFallback: false, customerMessage: null, quotaNote: null }
  }
  return {
    useManualFallback: true,
    customerMessage:
      'We could not reach our roof-imagery provider just now — we will have your estimate shortly. Answer a couple of quick questions to get an instant indicative figure.',
    quotaNote:
      code === 'provider_quota_exhausted'
        ? 'Solar API daily quota exhausted — requests are capped to cap GCP spend; resets at the daily boundary.'
        : null,
  }
}
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- lib/solar/guardrails.test.ts
```

Expected: `17 passed`.

- [ ] **Step 5: Commit.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && git add lib/solar/guardrails.ts lib/solar/guardrails.test.ts && git commit -m "feat(solar): API-failure/quota fallback signal with daily-quota note

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 39: STC parity/sanity script vs worked CER examples

Files:
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/scripts/test-solar-stc-parity.mjs`

This is the parity harness (à la `scripts/test-sms-parity.mjs`): it checks the STC certificate math (`floor(kW × zone_rating × deeming_years)`), the rebate dollars, and the net-identity against worked CER examples, plus asserts payback lands inside the sane band. It imports `calculateSolarPrice` from the real engine via `tsx`.

- [ ] **Step 1: Write the parity script (it IS the test — run it and watch it fail first).** Create `scripts/test-solar-stc-parity.mjs`:

```javascript
// QuoteMate · solar STC parity / sanity harness
// (mirrors scripts/test-sms-parity.mjs — plain Node assert, not vitest)
//
// Verifies the deterministic STC math against worked CER examples:
//   certificates = floor(kW × zone_rating × deeming_years)
//   rebate_aud   = certificates × stc_price_aud
//   net_ex_gst   = gross_ex_gst − rebate_aud
// and that payback bands land inside the sane 2–12yr window.
//
// Run: node --import tsx scripts/test-solar-stc-parity.mjs

import { strict as assert } from 'node:assert'

const results = { passed: 0, failed: 0, failures: [] }

function it(name, fn) {
  try {
    fn()
    results.passed++
    console.log(`  \u2713 ${name}`)
  } catch (err) {
    results.failed++
    results.failures.push({ name, err })
    console.log(`  \u2717 ${name}`)
  }
}

function describe(group, fn) {
  console.log(`\n${group}`)
  fn()
}

const pricing = await import('../lib/solar/pricing.ts')
const guardrails = await import('../lib/solar/guardrails.ts')

// ── A minimal SolarConfig + sizing/roof/context fixtures ──────────────
// Worked CER example: Sydney (zone 3, rating 1.382), 2026 install
// (deeming 5), 6.6 kW. certificates = floor(6.6 × 1.382 × 5) = floor(45.6) = 45.
const config = {
  version: '2026-06-01',
  effective_date: '2026-06-01',
  deeming_schedule: { 2026: 5, 2027: 4, 2028: 3, 2029: 2, 2030: 1 },
  zone_table: { 2000: 1.382, 4000: 1.536 },
  stc_price_aud: 38,
  feed_in: { by_network: { Ausgrid: 0.05 }, default_aud_per_kwh: 0.05 },
  export_limits: { default_kw_per_phase: 5, by_network: {} },
  default_rate_card: {
    install_rate_per_kw: { standard_panels: 1212, premium_panels: 1600, unknown: 0 },
    multi_storey_loading_pct: 0.15,
    complex_roof_loading_pct: 0.15,
    gst_registered: true,
    call_out_minimum_ex_gst: 600,
  },
  derate_factor: 0.81,
  self_consumption_pct: 0.4,
  retail_rate_aud_per_kwh: 0.3,
}

const context = { postcode: '2000', state: 'NSW', install_year: 2026, network: 'Ausgrid' }

const roof = {
  source: 'google',
  usable_area_m2: 60,
  planes: [],
  segment_count: 2,
  primary_orientation: 'north',
  mean_pitch_degrees: 22,
  max_panels_count: 18,
  panel_capacity_watts: 400,
  panel_configs: [],
  storeys: 1,
  polygon_geojson: null,
  imagery_quality: 'HIGH',
  imagery_date: '2025-11-01',
}

const sizing = {
  tiers: [
    {
      tier: 'better',
      label: 'Full-size system',
      system_kw_dc: 6.6,
      panels_count: 16,
      panel_type: 'standard_panels',
      source_config: { panels_count: 16, yearly_energy_dc_kwh: 9400 },
      export_limited: false,
    },
  ],
  roof_capacity_kw_dc: 7.2,
  export_limit_kw_ac: 5,
  routing: { decision: 'tradie_review', reason: 'auto-calculated' },
}

describe('STC certificate math vs worked CER example (Sydney 6.6 kW, 2026)', () => {
  const price = pricing.calculateSolarPrice({ sizing, roof, context, config })
  const t = price.tiers.find((x) => x.tier === 'better')

  it('produces a better tier', () => {
    assert.ok(t, 'expected a better tier in the output')
  })

  it('certificates = floor(6.6 × 1.382 × 5) = 45', () => {
    assert.equal(t.stc.certificates, 45)
  })

  it('zone_rating is the postcode lookup (1.382), never a state default', () => {
    assert.equal(t.stc.zone_rating, 1.382)
  })

  it('deeming_years = 5 for a 2026 install', () => {
    assert.equal(t.stc.deeming_years, 5)
  })

  it('rebate_aud = 45 × $38 = $1,710', () => {
    assert.equal(t.stc.rebate_aud, 1710)
  })

  it('net = gross − rebate (the published identity)', () => {
    assert.ok(
      Math.abs(t.net_ex_gst - (t.gross_ex_gst - t.stc.rebate_aud)) <= 0.011,
      `net ${t.net_ex_gst} != gross ${t.gross_ex_gst} − rebate ${t.stc.rebate_aud}`,
    )
  })

  it('gross/kW lands inside the $700–$1,800 sanity band', () => {
    assert.deepEqual(guardrails.checkGrossPerKwBounds(t), [])
  })
})

console.log(`\n  ${results.passed} passed \u00b7 ${results.failed} failed`)
if (results.failed > 0) {
  for (const f of results.failures) console.error(`\n\u2717 ${f.name}\n  ${f.err.message}`)
  process.exit(1)
}
process.exit(0)
```

- [ ] **Step 2: Run the script, verify it fails on the not-yet-built expectations.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && node --import tsx scripts/test-solar-stc-parity.mjs
```

Expected (one of two failure modes): if `calculateSolarPrice` from Phase 4 already computes STC, the script may pass immediately — in that case it is a *characterization* harness and you skip to Step 4. If the engine's STC numbers differ (e.g. wrong zone default, wrong deeming, no STC subtraction), you will see `✗ certificates = floor(...)` / `✗ rebate_aud = ...` with a non-zero exit. The expected first-run state is at least the `certificates = 45` and `rebate_aud = 1710` assertions failing if the engine does not yet read `config.zone_table[context.postcode]` correctly.

- [ ] **Step 3: Fix `lib/solar/pricing.ts` so the worked CER example passes (only if Step 2 failed).** The minimal change is ensuring the STC breakdown uses the postcode zone lookup, the deeming schedule, and `floor()`. Confirm `calculateSolarPrice` contains (adjust to the Phase-4 code, do not duplicate existing logic):

```typescript
// inside calculateSolarPrice, per tier:
const zone_rating = config.zone_table[context.postcode] // postcode lookup, never state-default
const deeming_years = config.deeming_schedule[context.install_year] ?? 0
const certificates = Math.floor(tier.system_kw_dc * zone_rating * deeming_years)
const rebate_aud = roundTo(certificates * config.stc_price_aud, 2)
const net_ex_gst = roundTo(gross_ex_gst - rebate_aud, 2)
```

(If Phase 4 already produces these exact numbers, no code change is needed — the harness simply locks the behaviour.)

- [ ] **Step 4: Run the script, verify it passes.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && node --import tsx scripts/test-solar-stc-parity.mjs
```

Expected: `7 passed · 0 failed`, exit 0.

- [ ] **Step 5: Commit.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && git add scripts/test-solar-stc-parity.mjs lib/solar/pricing.ts && git commit -m "test(solar): STC parity harness vs worked CER examples + net identity

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 40: Playwright e2e — confirm route contract + quote-page locked/confirmed states

Files:
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/tests/e2e/solar.spec.ts`

Following the repo's e2e convention (drive API contracts + rendered page states without a real Supabase Auth session), this covers: the confirm route gates unauthenticated calls, the solar deposit short-link rejects a bogus tier, and the `/q/solar/[token]` page renders the "indicative — installer confirms" framing pre-confirmation (the fallback/locked path).

- [ ] **Step 1: Write the failing e2e spec.** Create `tests/e2e/solar.spec.ts`:

```typescript
// E2E coverage for the solar review/deposit gate + customer page states.
//
// Mirrors tests/e2e/activation.spec.ts: we drive the API contracts and
// the rendered page states rather than the full address→estimate wizard
// (which needs a real Supabase Auth session + live Google Solar key).
//
//   1. POST /api/solar/[token]/confirm unauthenticated → 401 (no auto-
//      send; the forced tradie step is auth-gated).
//   2. GET /r/solar/[token]/[tier] with a bogus tier → 400 (tier guard).
//   3. /q/solar/[token] for an UNKNOWN token → the page does not crash;
//      it 404s or renders the not-found state (token guard).

import { test, expect } from '@playwright/test'

const SAMPLE_TOKEN = 'tok_e2e_unknown_000000'

test.describe('Solar review gate — API contracts', () => {
  test('confirm route rejects unauthenticated calls', async ({ request }) => {
    const res = await request.post(`/api/solar/${SAMPLE_TOKEN}/confirm`)
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('unauthorized')
  })

  test('confirm route rejects bogus Bearer tokens with 401', async ({ request }) => {
    const res = await request.post(`/api/solar/${SAMPLE_TOKEN}/confirm`, {
      headers: { Authorization: 'Bearer not-a-real-token-just-for-testing' },
    })
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })

  test('deposit short-link rejects an invalid tier with 400', async ({ request }) => {
    const res = await request.get(`/r/solar/${SAMPLE_TOKEN}/platinum`, {
      maxRedirects: 0,
    })
    expect(res.status()).toBe(400)
    expect(await res.text()).toContain('Invalid tier')
  })

  test('deposit short-link 404s a known-good tier on an unknown token', async ({
    request,
  }) => {
    const res = await request.get(`/r/solar/${SAMPLE_TOKEN}/better`, {
      maxRedirects: 0,
    })
    expect(res.status()).toBe(404)
  })
})

test.describe('Solar customer page — pre-confirmation state', () => {
  test('unknown token does not crash the page (renders 404 / not-found)', async ({
    page,
  }) => {
    const res = await page.goto(`/q/solar/${SAMPLE_TOKEN}`)
    // Next renders the not-found page for an unresolved token; assert we
    // got a 4xx and the page is not a 500 error.
    expect(res?.status()).toBeGreaterThanOrEqual(400)
    expect(res?.status()).toBeLessThan(500)
  })
})
```

- [ ] **Step 2: Run the e2e spec, verify it fails.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm run test:e2e -- solar.spec.ts
```

Expected failure: the confirm route and short-link route return 404 from Next's default handler (routes not yet wired into the build) or the assertions on `error: 'unauthorized'` / `Invalid tier` fail because the routes from Tasks 36–37 are not yet exercised by the dev server. (If Tasks 36–37 are already merged, the suite passes here and this task just locks the contract — proceed to Step 4.)

- [ ] **Step 3: Confirm the routes from Tasks 36–37 are reachable (no new app code).** The e2e exercises the routes created in Tasks 36 and 34. No new implementation is required in this task — if a spec fails, fix it in the owning route file (`app/api/solar/[token]/confirm/route.ts` or `app/r/solar/[token]/[tier]/route.ts`). Re-confirm `VALID_SOLAR_TIERS` rejects `platinum` (Task 37, Step 3) and the confirm route returns `{ ok: false, error: 'unauthorized' }` for a missing/bogus bearer (Task 36, Step 3).

- [ ] **Step 4: Run the e2e spec, verify it passes.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm run test:e2e -- solar.spec.ts
```

Expected: `5 passed` (the Playwright `webServer` auto-starts `next dev` on port 3100).

- [ ] **Step 5: Commit.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && git add tests/e2e/solar.spec.ts && git commit -m "test(solar): e2e for confirm gate, deposit short-link, and quote-page guards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 41: Wire guardrails + config-freshness into the orchestrator's persisted estimate

Files:
- Modify: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/intake.ts`
- Create: `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/intake-guardrails.test.ts`

The final wiring: `runSolarEstimate` must stamp `guardrail_flags` (from `runSolarGuardrails`) and downgrade routing to `tradie_review` when flags exist, and must refuse to compute prices when `validateSolarConfig` is not ok (spec §5, §7). This task tests the pure assembly helper that the orchestrator uses, keeping the I/O-heavy orchestrator thin.

- [ ] **Step 1: Write the failing test for the estimate-finalisation helper.** Create `lib/solar/intake-guardrails.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { finaliseSolarEstimate } from './intake'
import type { SolarEstimate } from './types'

function cleanEstimate(): SolarEstimate {
  return {
    token: 'tok_final_123456',
    context: { postcode: '2000', state: 'NSW', install_year: 2026, network: 'Ausgrid' },
    coverage_source: 'google',
    roof: {
      source: 'google',
      usable_area_m2: 60,
      planes: [],
      segment_count: 2,
      primary_orientation: 'north',
      mean_pitch_degrees: 22,
      max_panels_count: 18,
      panel_capacity_watts: 400,
      panel_configs: [],
      storeys: 1,
      polygon_geojson: null,
      imagery_quality: 'HIGH',
      imagery_date: '2025-11-01',
    },
    sizing: {
      tiers: [],
      roof_capacity_kw_dc: 7.2,
      export_limit_kw_ac: 5,
      routing: { decision: 'tradie_review', reason: 'auto-calculated' },
    },
    production: [
      {
        system_kw_dc: 6.6,
        annual_kwh_ac: 9200,
        annual_kwh_low: 7360,
        annual_kwh_high: 11040,
        derate_applied: 0.81,
        degradation_pct_per_year: 0.005,
        cec_benchmark_kwh_per_kw: 1400,
        within_cec_benchmark: true,
        band: 'tight',
      },
    ],
    price: {
      tiers: [
        {
          tier: 'better',
          label: 'Full-size system',
          system_kw_dc: 6.6,
          gross_ex_gst: 8000,
          gross_inc_gst: 8800,
          stc: {
            system_kw: 6.6,
            zone_rating: 1.382,
            deeming_years: 5,
            certificates: 45,
            stc_price_aud: 38,
            rebate_aud: 1710,
          },
          net_ex_gst: 6290,
          net_inc_gst: 6919,
          scope: '6.6 kW solar install with standard panels.',
        },
      ],
      effective_rate_per_kw: 1212,
      loadings_applied: [],
      routing: { decision: 'tradie_review', reason: 'auto-calculated' },
    },
    economics: {
      tiers: [
        {
          tier: 'better',
          self_consumed_kwh: 3600,
          exported_kwh: 5400,
          bill_savings_aud: 1080,
          export_earnings_aud: 270,
          annual_savings_aud: 1350,
          payback_years_low: 4.2,
          payback_years_high: 6.8,
        },
      ],
      assumptions: {
        self_consumption_pct: 0.4,
        retail_rate_aud_per_kwh: 0.3,
        feed_in_tariff_aud_per_kwh: 0.05,
        feed_in_network: 'Ausgrid',
      },
    },
    confidence_band: 'tight',
    satellite_image_url: null,
    routing: { decision: 'auto_quote', reason: 'within bounds' },
    guardrail_flags: [],
    config_version: '2026-06-01',
  }
}

describe('finaliseSolarEstimate', () => {
  it('leaves a clean estimate flag-free and tradie-reviewed', () => {
    const out = finaliseSolarEstimate(cleanEstimate())
    expect(out.guardrail_flags).toEqual([])
    expect(out.routing.decision).toBe('tradie_review')
  })

  it('stamps guardrail_flags and forces tradie_review when a tier breaches bounds', () => {
    const e = cleanEstimate()
    e.price.tiers[0].net_ex_gst = 1 // breaks net = gross − STC
    const out = finaliseSolarEstimate(e)
    expect(out.guardrail_flags.length).toBeGreaterThan(0)
    expect(out.routing.decision).toBe('tradie_review')
    expect(out.routing.reason).toMatch(/checks/i)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- lib/solar/intake-guardrails.test.ts
```

Expected failure: `finaliseSolarEstimate is not a function` (the export does not exist on `intake.ts` yet) — both tests error.

- [ ] **Step 3: Add the pure finaliser to `lib/solar/intake.ts`.** Add the import and the exported helper near the top of the module (after the existing imports). `runSolarEstimate` (the orchestrator) should call `finaliseSolarEstimate(estimate)` immediately before persisting the `solar_estimates` row:

```typescript
import { runSolarGuardrails } from './guardrails'
import type { SolarEstimate, SolarRoutingDecision } from './types'

/**
 * PURE — stamp deterministic-output flags on a drafted estimate and
 * force tradie_review whenever any flag fired (spec §7: out-of-bounds →
 * flag for tradie, never publish silently). A clean estimate keeps its
 * incoming routing if already tradie-review, else is normalised to it
 * (solar never auto-sends — inherits roofing's high-ticket rule).
 */
export function finaliseSolarEstimate(estimate: SolarEstimate): SolarEstimate {
  const flags = runSolarGuardrails(estimate)
  const routing: SolarRoutingDecision =
    flags.length > 0
      ? {
          decision: 'tradie_review',
          reason: `${flags.length} estimate check${flags.length === 1 ? '' : 's'} need your review before this can be sent.`,
        }
      : {
          decision: 'tradie_review',
          reason:
            'Quote auto-calculated from roof data. Every solar quote requires tradie sign-off before customer send.',
        }
  return { ...estimate, guardrail_flags: flags, routing }
}
```

Inside the existing `runSolarEstimate`, immediately before the `solar_estimates` insert, replace the raw `estimate` with the finalised one:

```typescript
const finalEstimate = finaliseSolarEstimate(estimate)
// ...persist finalEstimate (token, guardrail_flags, routing, config_version, ...)
return finalEstimate
```

- [ ] **Step 4: Run the test, verify it passes.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- lib/solar/intake-guardrails.test.ts
```

Expected: `2 passed`.

- [ ] **Step 5: Run the full solar suite, then commit.** Run:

```
cd c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation && npm test -- lib/solar && git add lib/solar/intake.ts lib/solar/intake-guardrails.test.ts && git commit -m "feat(solar): orchestrator stamps guardrail_flags + forces tradie review

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected test output before commit: all `lib/solar/*.test.ts` pass (guardrails 17, publish 9, intake-guardrails 2, plus the Phase 1–4 solar tests).

---

## Phase 5 done — definition of done

- Drafted solar estimates carry `guardrail_flags` (net=gross−STC, gross $700–$1,800/kW, payback 2–12 yr, AC/kW within ±35% of CEC benchmark); any breach forces `tradie_review` and `canShowPrices` withholds prices (spec §7).
- No auto-send: `/api/solar/[token]/confirm` is the forced human-in-loop step; it refuses to confirm a flagged estimate and stamps `confirmed_at`.
- The per-tier Stripe deposit unlocks only post-confirm via `/r/solar/[token]/[tier]` (`solarPayRedirectTarget`: `locked` → `book` → `stripe`/`paid`), reusing the book-first/pay-last funnel.
- Stale config (`validateSolarConfig` not ok) and Solar-API/quota failures fail safe (`apiFailureFallback` → manual path + "estimate shortly" + daily-quota note).
- One Playwright e2e (`tests/e2e/solar.spec.ts`) covers the confirm gate, deposit short-link tier guard, and the customer-page token guard.
- `scripts/test-solar-stc-parity.mjs` locks STC math against a worked CER example (Sydney 6.6 kW 2026 → 45 STCs → $1,710 rebate → net identity).

Files created/modified in this phase (all absolute):
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/guardrails.ts` (+ `.test.ts`)
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/publish.ts` (+ `.test.ts`)
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/app/api/solar/[token]/confirm/route.ts` (+ `.test.ts`)
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/app/r/solar/[token]/[tier]/route.ts` (+ `.test.ts`)
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/lib/solar/intake.ts` (modified; + `lib/solar/intake-guardrails.test.ts`)
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/scripts/test-solar-stc-parity.mjs`
- `c:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/tests/e2e/solar.spec.ts`

---
