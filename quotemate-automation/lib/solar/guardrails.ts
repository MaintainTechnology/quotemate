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

import type { SolarPriceTier, SolarEconomicsTier, SolarProductionResult } from './types'

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
  const { payback_years_low: lo, payback_years_high: hi } = econ
  if (lo === null || hi === null) return []
  if (lo < PAYBACK_YEARS_MIN || hi > PAYBACK_YEARS_MAX) {
    return [
      `${econ.tier}: payback band ${lo.toFixed(1)}–` +
        `${hi.toFixed(1)} yrs falls outside the ` +
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
