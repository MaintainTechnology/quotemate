// ════════════════════════════════════════════════════════════════════
// Solar — annual savings + banded payback (spec §1, §6).
//
//   annual savings = self_consumed_kWh × retail_rate
//                  + exported_kWh × feed_in_tariff
//   payback        = net_price ÷ annual_savings  — a RANGE, not a point.
//
// The payback band is driven off the production band: the high-production
// edge pays back FASTER (lower years), the low-production edge SLOWER
// (higher years). Tight ±20% vs wide ±30% — uses BAND_SPREAD from
// types.ts so production.ts and economics.ts stay semantically coupled.
//
// GST NOTE: payback is computed using net_ex_gst (the customer's after-
// rebate cost excluding GST), because retail_rate_aud_per_kwh and
// feed_in_tariff_aud_per_kwh in SolarConfig represent ex-GST tariffs
// (e.g. the 8c/kWh Ausgrid FiT is the network rate before 10% GST).
// Using inc-GST net against ex-GST savings would inflate payback years by
// ~10%. Both numerator (net_ex_gst) and denominator (savings from ex-GST
// rates) are therefore consistently ex-GST.
//
// Feed-in resolves by network from config, defaulting when unknown.
// When annual_savings_aud is 0 and net > 0, payback fields are null
// (uncalculable — not "free, zero payback").
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
import { BAND_SPREAD } from './types'
import { roundTo } from './math'

export function calculateSolarEconomics(args: {
  price: SolarQuotePrice
  production: SolarProductionResult[]
  config: SolarConfig
  context: SolarEstimateContext
}): SolarEconomicsResult {
  const { price, production, config, context } = args

  // Guard: mismatched arrays produce nonsensical economics (zero production
  // for a non-zero system). Throw early — the same pattern pricing.ts uses
  // for empty tiers — rather than silently returning null payback for all
  // extra tiers.
  if (production.length !== price.tiers.length) {
    throw new Error(
      `economics: production.length (${production.length}) must equal price.tiers.length (${price.tiers.length}). ` +
        'Each price tier must have a corresponding production result.',
    )
  }

  const selfPct = config.self_consumption_pct
  const retail = config.retail_rate_aud_per_kwh
  const feedIn =
    config.feed_in.by_network[context.network] ?? config.feed_in.default_aud_per_kwh

  const tiers: SolarEconomicsTier[] = price.tiers.map((priceTier, i) => {
    const prod = production[i]
    const ac = prod.annual_kwh_ac
    const spread = BAND_SPREAD[prod.band]

    const self_consumed_kwh = Math.round(ac * selfPct)
    const exported_kwh = ac - self_consumed_kwh

    const bill_savings_aud = roundTo(self_consumed_kwh * retail, 2)
    const export_earnings_aud = roundTo(exported_kwh * feedIn, 2)
    const annual_savings_aud = roundTo(bill_savings_aud + export_earnings_aud, 2)

    // Use net_ex_gst: both the retail and feed-in rates in SolarConfig are
    // ex-GST tariffs. Mixing inc-GST net with ex-GST savings inflates
    // payback by ~10%. See module-level GST NOTE.
    const net = priceTier.net_ex_gst

    // High production (× (1+spread)) → fast payback (low years).
    // Low production (× (1−spread)) → slow payback (high years).
    // Null when annual_savings_aud=0 and net>0 — uncalculable, not free.
    const payback_years_low: number | null =
      annual_savings_aud > 0
        ? roundTo(net / (annual_savings_aud * (1 + spread)), 1)
        : net > 0
          ? null
          : 0
    const payback_years_high: number | null =
      annual_savings_aud > 0
        ? roundTo(net / (annual_savings_aud * (1 - spread)), 1)
        : net > 0
          ? null
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
