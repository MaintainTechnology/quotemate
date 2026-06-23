// c:/Users/dalig/Downloads/QuoteMax/quoteMate/.claude/worktrees/solar-estimate/quotemate-automation/lib/solar/tier-cards.test.ts
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
