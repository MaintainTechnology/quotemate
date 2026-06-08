// ════════════════════════════════════════════════════════════════════
// Solar test fixtures — deterministic payloads the whole lib/solar
// suite reuses:
//   • COVERED_RAW_BODY       — a realistic buildingInsights:findClosest body
//                              with roofSegmentStats + solarPanelConfigs +
//                              maxArrayPanelsCount + panelCapacityWatts.
//   • COVERED_INSIGHT        — that body run through parseBuildingInsights
//                              (the reused solar-api parser), HIGH imagery.
//   • COVERED_ROOF_FACTS     — COVERED_INSIGHT mapped to SolarRoofFacts
//                              (the normalised shape the whole engine consumes).
//   • UNCOVERED_RAW_BODY     — a 404-shaped body (no solarPotential).
//   • MANUAL_INPUT           — a customer-declared manual-roof fallback.
//   • SOLAR_CONFIG_FIXTURE   — a complete SolarConfig with hand-worked
//                              values consistent with COVERED_RAW_BODY
//                              (postcode 2000, install_year 2026, etc.).
//   • SMALL_PANEL_CONFIG     — a 10-panel × 400 W (4 kW DC → 3.2 kW AC)
//                              config for testing the non-export-limited
//                              branch (below the 5 kW/phase ceiling).
//   • DEGENERATE_RAW_BODY    — single-segment, zero south-facing area;
//                              tests primary_orientation selection edge.
//   • ZERO_AREA_RAW_BODY     — all roofSegmentStats have area=0;
//                              parseBuildingInsights must return null.
//
// Numbers are hand-chosen so the downstream STC / production / payback
// assertions land on exact, hand-worked values (see each module's test).
// ════════════════════════════════════════════════════════════════════

import { parseBuildingInsights } from '../../roofing/solar-api'
import type { SolarRoofInsight } from '../../roofing/solar-api'
import type {
  SolarManualRoofInput,
  SolarRoofFacts,
  SolarConfig,
  SolarPanelConfig,
} from '../types'

// ── Raw Google Solar API bodies ──────────────────────────────────────

/**
 * A north-facing two-plane hip roof, ~120 m² of roof, HIGH imagery.
 * panelCapacityWatts=400, maxArrayPanelsCount=30.
 * Three panel configs (16/24/30 panels) all produce >5 kW AC —
 * used to test the export_limited=true branch in sizing.ts.
 */
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

/**
 * COVERED_INSIGHT mapped onto SolarRoofFacts — the normalised shape that
 * every lib/solar module (roof.ts, sizing.ts, production.ts, …) actually
 * consumes. Manually constructed from COVERED_RAW_BODY values so tests
 * can import this without depending on roof.ts (Task 6).
 *
 * Hand-worked values:
 *   usable_area_m2 = 70 + 50 = 120
 *     NOTE: usable_area_m2 here is the SUM of raw segment areas reported by
 *     the Google Solar API. It is the POST-obstruction-discount area as
 *     returned by the API (i.e. Google already applies its own obstruction
 *     model). roof.ts emits this value directly (round1 of raw area sum);
 *     no additional obstruction discount is applied in this codebase.
 *   segment_count  = 2
 *   primary_orientation = 'north'   (largest plane: azimuth=0, area=70)
 *   mean_pitch_degrees  = 20        (area-weighted: both planes pitch=20)
 *   max_panels_count    = 30
 *   panel_capacity_watts = 400
 *   imagery_quality     = 'HIGH'
 *   imagery_date        = '2024-03-12'
 */
export const COVERED_ROOF_FACTS: SolarRoofFacts = {
  source: 'google',
  usable_area_m2: 120,
  planes: [
    { pitch_degrees: 20, azimuth_degrees: 0, area_m2: 70, orientation: 'north' },
    { pitch_degrees: 20, azimuth_degrees: 180, area_m2: 50, orientation: 'south' },
  ],
  segment_count: 2,
  primary_orientation: 'north',
  mean_pitch_degrees: 20,
  max_panels_count: 30,
  panel_capacity_watts: 400,
  panel_configs: [
    { panels_count: 16, yearly_energy_dc_kwh: 9600 },
    { panels_count: 24, yearly_energy_dc_kwh: 14400 },
    { panels_count: 30, yearly_energy_dc_kwh: 18000 },
  ],
  storeys: null,
  polygon_geojson: null,
  imagery_quality: 'HIGH',
  imagery_date: '2024-03-12',
}

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

// ── SolarConfig fixture ──────────────────────────────────────────────

/**
 * A complete SolarConfig with hand-worked values consistent with
 * COVERED_RAW_BODY. Postcode 2000 (Sydney CBD, zone 3 ≈ 1.382).
 * Install year 2026 → deeming_years = 5.
 * Network 'Ausgrid' → feed-in $0.06/kWh.
 * stc_price_aud = 38 (conservative vs $40 clearing-house cap).
 * derate_factor = 0.80 (real default from this fixture).
 *
 * Pinned values downstream tests assert on:
 *   deeming_schedule[2026] === 5
 *   zone_table['2000']     === 1.382
 *   stc_price_aud          === 38
 *   derate_factor          === 0.80
 *
 * Network keys use Title-case (Ausgrid/Endeavour/Essential) to match
 * SolarEstimateContext.network and DEFAULT_SOLAR_CONFIG conventions.
 */
export const SOLAR_CONFIG_FIXTURE: SolarConfig = {
  version: '2026-01-15',
  effective_date: '2026-01-15',
  deeming_schedule: {
    2026: 5,
    2027: 4,
    2028: 3,
    2029: 2,
    2030: 1,
  },
  zone_table: {
    '2000': 1.382,
    '4000': 1.536,
    '3000': 1.185,
  },
  stc_price_aud: 38,
  feed_in: {
    by_network: {
      // Title-case keys align with SolarEstimateContext.network values.
      Ausgrid: 0.06,
      Endeavour: 0.05,
      Essential: 0.05,
    },
    default_aud_per_kwh: 0.05,
  },
  export_limits: {
    default_kw_per_phase: 5,
    by_network: {
      Ausgrid: 5,
      Endeavour: 5,
    },
  },
  default_rate_card: {
    // install_rate_per_kw values are EX-GST ($/kW DC installed, before 10% GST).
    install_rate_per_kw: {
      standard_panels: 1100,
      premium_panels: 1400,
      unknown: 1100,
    },
    multi_storey_loading_pct: 0.10,
    complex_roof_loading_pct: 0.15,
    gst_registered: true,
  },
  derate_factor: 0.80,
  self_consumption_pct: 0.40,
  retail_rate_aud_per_kwh: 0.30,
}

// ── Sub-5 kW panel config (non-export-limited path) ──────────────────

/**
 * 10 panels × 400 W = 4 kW DC → 4 × 0.80 = 3.2 kW AC.
 * Below the standard 5 kW/phase export limit, so sizing.ts should set
 * export_limited=false for this config. Use alongside COVERED_ROOF_FACTS
 * in sizing.ts tests to exercise the non-export-limited branch.
 */
export const SMALL_PANEL_CONFIG: SolarPanelConfig = {
  panels_count: 10,
  yearly_energy_dc_kwh: 6000,
}

// ── Edge-case raw bodies ─────────────────────────────────────────────

/**
 * Single-segment body with only a north-facing plane (area=60 m²) and
 * zero south-facing area. Tests primary_orientation selection when there
 * is exactly one usable segment. parseBuildingInsights should succeed and
 * return a single-segment insight with orientation 'north'.
 */
export const DEGENERATE_RAW_BODY = {
  imageryQuality: 'MEDIUM',
  imageryDate: { year: 2023, month: 6, day: 1 },
  solarPotential: {
    maxArrayPanelsCount: 10,
    panelCapacityWatts: 400,
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    roofSegmentStats: [
      {
        pitchDegrees: 15,
        azimuthDegrees: 0, // due north
        stats: { areaMeters2: 60 },
      },
    ],
    solarPanelConfigs: [
      { panelsCount: 10, yearlyEnergyDcKwh: 6000 },
    ],
  },
} as const

/**
 * All roofSegmentStats have area=0 — parseBuildingInsights should return
 * null (no usable segments), confirming roof.ts falls through to the
 * manual fallback correctly.
 */
export const ZERO_AREA_RAW_BODY = {
  imageryQuality: 'HIGH',
  imageryDate: { year: 2024, month: 1, day: 1 },
  solarPotential: {
    maxArrayPanelsCount: 0,
    panelCapacityWatts: 400,
    roofSegmentStats: [
      {
        pitchDegrees: 20,
        azimuthDegrees: 0,
        stats: { areaMeters2: 0 },
      },
      {
        pitchDegrees: 20,
        azimuthDegrees: 180,
        stats: { areaMeters2: 0 },
      },
    ],
    solarPanelConfigs: [],
  },
} as const
