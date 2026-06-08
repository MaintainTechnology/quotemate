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

/**
 * Fractional spread applied to the production midpoint when computing the
 * payback band. Tight ±20%, wide ±30% — shared between production.ts
 * (which computes annual_kwh_low/high) and economics.ts (which reconstructs
 * the payback interval from the same spread). Both files MUST use this
 * constant so the band widths stay semantically coupled.
 */
export const BAND_SPREAD: Record<SolarConfidenceBand, number> = {
  tight: 0.20,
  wide: 0.30,
}

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

/**
 * Why a coverage check resolved the way it did — operator-actionable.
 *
 * Only codes that `checkSolarCoverage` can actually emit are listed here.
 * The upstream `fetchBuildingInsights` collapses all non-404 HTTP errors
 * (including 429) into `http_error → provider_unavailable`, so
 * rate-limit / quota codes cannot be surfaced without extending the
 * upstream client. Removed unreachable codes (outside_coverage,
 * address_not_resolved, provider_rate_limited, provider_quota_exhausted)
 * to keep the exhaustive-switch contract honest.
 */
export type SolarCoverageFailureCode =
  | 'no_building_at_address'
  | 'imagery_below_floor'      // imageryQuality < MEDIUM
  | 'provider_unavailable'
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
  /** Always present — false when the floor was not triggered. */
  call_out_minimum_applied: boolean
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
  /**
   * Simple payback band, years (net price ÷ savings, low/high bounds).
   * Null when annual_savings_aud is 0 and net > 0 (uncalculable, not free).
   */
  payback_years_low: number | null
  payback_years_high: number | null
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
  /**
   * Default panel capacity in watts when the API response omits
   * panelCapacityWatts. Versioned here so a model-year change (e.g. 400→415)
   * is tracked alongside STC prices and deeming schedules (spec §5).
   */
  default_panel_capacity_watts?: number
  /**
   * Conservative DC specific yield used on the manual-fallback path
   * (kWh per kW DC per year). Absent from the Google path, which uses the
   * API's own per-config yearly_energy_dc_kwh. Versioned here so a
   * per-city benchmark upgrade (e.g. 1400 AU-wide → city-specific) is
   * tracked alongside deeming schedules rather than buried in code.
   *
   * NOTE: The manual path produces a single AU-wide benchmark figure that
   * will be ±15% vs Melbourne (~1200) or Brisbane (~1500). The Google
   * path uses the API's real per-config DC estimate, so the two paths
   * are structurally inconsistent by ≤±15% on production figures for the
   * same roof. The manual path always carries confidence_band='wide' to
   * reflect this uncertainty downstream.
   */
  manual_benchmark_kwh_per_kw?: number
  /**
   * Roof area consumed by one panel including setbacks, m². Used on the
   * manual-fallback path to convert declared usable_area_m2 into a panel
   * count. Versioned here so a panel-size model-year change is tracked
   * alongside deeming schedules (spec §5). Default: 1.95 m².
   */
  area_per_panel_m2?: number
  /**
   * Annual linear degradation fraction applied in production.ts (e.g. 0.005
   * = 0.5%/yr). Passed through as metadata to the economics layer for
   * year-by-year calculations. Versioned here so a manufacturer-spec update
   * is tracked alongside STC prices rather than buried in code.
   * Default: 0.005.
   */
  degradation_pct_per_year?: number
  /**
   * Minimum number of roof segments to trigger the complex-roof loading in
   * pricing.ts (segment_count >= this value). Versioned here so an
   * operational policy change (e.g. "charge complexity from 4 planes, not 6")
   * is config-driven rather than a code edit. Default: 6.
   */
  complex_roof_min_segments?: number
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
