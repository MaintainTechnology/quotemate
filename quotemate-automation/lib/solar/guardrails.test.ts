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
    expect(flags[0]).toMatch(/\$\d+\/kW/)
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

import { apiFailureFallback } from './guardrails'
import type { SolarCoverageFailureCode } from './types'

describe('apiFailureFallback', () => {
  it('routes provider quota exhaustion to the manual path with a quota note', () => {
    const r = apiFailureFallback('provider_quota_exhausted')
    expect(r.useManualFallback).toBe(true)
    expect(r.customerMessage).toMatch(/estimate shortly/i)
    expect(r.quotaNote).toMatch(/daily/i)
  })

  it('routes rate-limited, unavailable, and invalid-response to the manual path (no quota note)', () => {
    for (const code of ['provider_rate_limited', 'provider_unavailable', 'provider_invalid_response'] as SolarCoverageFailureCode[]) {
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
      call_out_minimum_applied: false,
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
