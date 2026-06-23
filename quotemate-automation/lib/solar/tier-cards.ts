// c:/Users/dalig/Downloads/QuoteMax/quoteMate/.claude/worktrees/solar-estimate/quotemate-automation/lib/solar/tier-cards.ts
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
