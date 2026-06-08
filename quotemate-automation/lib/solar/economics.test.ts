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
  call_out_minimum_applied: false,
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
    // payback_years_low/high are null only when annual_savings_aud=0; here production
    // is non-zero so both should be non-null positive numbers.
    expect(t.payback_years_low).not.toBeNull()
    expect(t.payback_years_high).not.toBeNull()
    // Assert non-null before numeric comparisons to satisfy TypeScript.
    const low = t.payback_years_low as number
    const high = t.payback_years_high as number
    expect(low).toBeLessThan(high)
    expect(low).toBeGreaterThan(0)
    // Exact values: net=5368, savings=1368.48, tight spread=±20%.
    // low  = roundTo(5368 / (1368.48 × 1.20), 1) = 3.3
    // high = roundTo(5368 / (1368.48 × 0.80), 1) = 4.9
    expect(low).toBe(3.3)
    expect(high).toBe(4.9)
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
    const span = (e.tiers[0].payback_years_high as number) - (e.tiers[0].payback_years_low as number)
    const tightSpan = (t.payback_years_high as number) - (t.payback_years_low as number)
    expect(span).toBeGreaterThan(tightSpan)
  })

  it('returns null payback when annual production is zero and net > 0', () => {
    // Simulates a zero-AC production result (e.g. a degenerate panel config).
    const zeroProd: SolarProductionResult = {
      ...PRODUCTION,
      annual_kwh_ac: 0,
    }
    const e = calculateSolarEconomics({
      price: PRICE,
      production: [zeroProd],
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    expect(e.tiers[0].annual_savings_aud).toBe(0)
    // Payback is uncalculable (not free/zero) when savings are 0 and cost is non-zero.
    expect(e.tiers[0].payback_years_low).toBeNull()
    expect(e.tiers[0].payback_years_high).toBeNull()
  })

  it('throws when production array length does not match price.tiers length', () => {
    // A caller bug: price has 1 tier but production has 0 entries.
    expect(() =>
      calculateSolarEconomics({
        price: PRICE,
        production: [],
        config: DEFAULT_SOLAR_CONFIG,
        context: CONTEXT,
      }),
    ).toThrow(/production\.length.*price\.tiers\.length/)
  })
})
