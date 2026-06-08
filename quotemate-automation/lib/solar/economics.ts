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
