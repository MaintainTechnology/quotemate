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
// Year-1 AC energy is the point estimate. DEGRADATION_PCT_PER_YEAR is the
// 0.5%/yr constant passed through as metadata for the economics layer to
// use in its own year-by-year calculations — no lifetime production array
// is computed here.
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

/**
 * Conservative AU-wide fallback kWh/kW/yr used when a state lookup misses.
 * All 8 members of `AuState` are present in CEC_BENCHMARK_BY_STATE, so this
 * constant is unreachable for well-typed inputs. It is retained as a
 * runtime safety net for corrupt or out-of-range data that bypasses the type
 * system (e.g. a DB row with an unknown state string). Value is the simple
 * average of the 8 metro benchmarks below (~1378), rounded to a round number.
 */
const CEC_BENCHMARK_FALLBACK_KWH_PER_KW = 1380

/** CEC-derived specific-yield table, kWh per kW DC per year, keyed by
 *  AuState. All 8 members of the AuState union are present — exhaustive.
 *  Conservative metro values; admin can widen later. */
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

  // Guard: panel_capacity_watts <= 0 means the API returned corrupt data.
  // numberOr() in roof.ts can fall back to 0 from a missing field; dividing
  // by zero here would silently produce annual_kwh_ac = 0 with no flag. Throw
  // early so the caller can surface this as a guardrail flag.
  if (roof.panel_capacity_watts <= 0) {
    throw new Error(
      `panel_capacity_watts must be positive; received ${roof.panel_capacity_watts}. ` +
        'The Google Solar API response may be corrupt or missing panelCapacityWatts.',
    )
  }

  // Guard: yearly_energy_dc_kwh = 0 would silently produce a zero-AC estimate
  // that looks valid but would cause division by zero in the economics layer.
  if (tier.source_config.yearly_energy_dc_kwh <= 0) {
    throw new Error(
      `source_config.yearly_energy_dc_kwh must be positive; received ${tier.source_config.yearly_energy_dc_kwh}. ` +
        'The panel config or manual fallback produced a zero DC energy estimate.',
    )
  }

  // 1. Scale the config DC energy for any non-400W panel rating.
  const ratingScale = roof.panel_capacity_watts / CONFIG_PANEL_BASELINE_WATTS
  const scaledDc = tier.source_config.yearly_energy_dc_kwh * ratingScale

  // 2. DC → AC derate.
  const derate = config.derate_factor
  const annual_kwh_ac = Math.round(scaledDc * derate)

  // 3. CEC cross-check on implied AC specific yield.
  // CEC_BENCHMARK_BY_STATE covers all 8 AuState members exhaustively; the
  // fallback is a safety net for invalid runtime data that bypasses the type
  // system.
  const cec_benchmark_kwh_per_kw =
    CEC_BENCHMARK_BY_STATE[context.state] ?? CEC_BENCHMARK_FALLBACK_KWH_PER_KW
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
  CEC_BENCHMARK_FALLBACK_KWH_PER_KW,
}
