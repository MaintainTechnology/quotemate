// ════════════════════════════════════════════════════════════════════
// Pylon proposal — QuoteMate-MODELLED enrichment (pure).
//
// Phase-0 finding (2026-06-12): the Pylon design API exposes "only basic
// information" — no production, consumption or financial-analysis data.
// Everything the proposal shows beyond Pylon's own verbatim numbers is
// therefore modelled by QuoteMate from two design facts (DC kW + cash
// price) and the tenant's solar_config constants, and every such section
// is labelled "modelled by QuoteMate". Nothing here ever feeds back into
// the quote table — Pylon's line items stay verbatim.
//
// PURE — no I/O. Reuses the solar engine's chart builders + financial
// projection so the Pylon tab and the Google tab tell the same story
// with the same math and the same print-safe SVGs.
// ════════════════════════════════════════════════════════════════════

import {
  buildCumulativeSavingsChart,
  buildMonthlyBillComparisonChart,
  buildMonthlyProductionChart,
  buildUtilityCostsChart,
  type ChartTheme,
  type SolarChart,
} from '@/lib/solar/charts'
import {
  buildSolarEnvironmentalImpact,
  buildSolarFinancialSummary,
  type SolarEnvironmentalImpact,
  type SolarFinancialSummary,
} from '@/lib/solar/financial-summary'
import { roundTo } from '@/lib/solar/math'
import type { SolarConfig, SolarEconomicsTier, SolarPriceTier } from '@/lib/solar/types'
import type { PylonProposalDesign } from './proposal'

/**
 * CEC-derived AC specific yields (kWh per kW DC per year) by state —
 * the same conservative metro benchmarks the solar engine's production
 * model cross-checks against (lib/solar/production.ts). Used directly
 * here because a Pylon design carries no panel-config energy data.
 */
const CEC_YIELD_BY_STATE: Record<string, number> = {
  NSW: 1382,
  VIC: 1278,
  QLD: 1424,
  SA: 1490,
  WA: 1521,
  TAS: 1130,
  ACT: 1382,
  NT: 1621,
}
const CEC_YIELD_FALLBACK = 1380

/** Pylon site addresses carry FULL state names ("Victoria") — map them
 *  to the abbreviations the CEC table is keyed by. */
const STATE_NAME_TO_ABBR: Record<string, string> = {
  'NEW SOUTH WALES': 'NSW',
  VICTORIA: 'VIC',
  QUEENSLAND: 'QLD',
  'SOUTH AUSTRALIA': 'SA',
  'WESTERN AUSTRALIA': 'WA',
  TASMANIA: 'TAS',
  'AUSTRALIAN CAPITAL TERRITORY': 'ACT',
  'NORTHERN TERRITORY': 'NT',
}

/** PURE — "Victoria" | "vic" | "VIC" → 'VIC'; unknown → null. */
export function normalizeAuState(state: string | null | undefined): string | null {
  const raw = (state ?? '').trim().toUpperCase()
  if (!raw) return null
  if (raw in CEC_YIELD_BY_STATE) return raw
  return STATE_NAME_TO_ABBR[raw] ?? null
}

/** PURE — CEC metro-benchmark specific yield (kWh/kW/yr) for a state;
 *  national fallback when unknown. Shared with the OpenSolar tab. */
export function cecYieldForState(state: string | null | undefined): number {
  const key = normalizeAuState(state) ?? ''
  return CEC_YIELD_BY_STATE[key] ?? CEC_YIELD_FALLBACK
}

/**
 * AU grid emission factor, kg CO₂e per MWh — national grid average per
 * the DCCEEW National Greenhouse Accounts factors. The Google path gets
 * a per-site factor from the Solar API; a Pylon design has none, so the
 * modelled environmental section uses this cited national constant.
 */
const AU_GRID_CARBON_KG_PER_MWH = 680

export type PylonModelled = {
  /** Modelled AC production for the designed system, kWh/yr. */
  annual_kwh_ac: number
  /** The specific yield applied, kWh/kW/yr (cited in the assumptions). */
  specific_yield_kwh_per_kw: number
  /** Modelled household + bill figures (config typical-usage path). */
  utility: {
    household_annual_kwh: number
    annual_bill_before_aud: number
    annual_bill_with_solar_aud: number
    bill_offset_pct: number
  }
  /** Modelled annual savings, $/yr ex-GST tariffs. */
  annual_savings_aud: number
  /** Ex-GST net price derived from the design's ex-tax line items, $. */
  net_ex_gst_aud: number
  /** 20-yr NPV / ROI / IRR / payback projection (engine math). */
  financial: SolarFinancialSummary | null
  environmental: SolarEnvironmentalImpact | null
  charts: {
    monthly_production: SolarChart | null
    utility_costs: SolarChart | null
    monthly_bill: SolarChart | null
    cumulative_savings: SolarChart | null
  }
  /** Constants applied — rendered in the assumed-values table. */
  assumptions: Array<{ label: string; value: string }>
}

/** Ex-GST cash price in dollars from the design's ex-tax line items. */
export function designNetExGstAud(design: PylonProposalDesign): number | null {
  const lines = design.line_items.filter(
    (li) =>
      li.included_in_summary_line === 'subtotal' || li.included_in_summary_line === 'total',
  )
  if (lines.length > 0) {
    const cents = lines.reduce((acc, li) => acc + (li.total_amount_cents ?? 0), 0)
    if (cents > 0) return roundTo(cents / 100, 2)
  }
  // Fallback: strip 10% GST from the inc-tax cash total.
  if (design.pricing.total_cents != null && design.pricing.total_cents > 0) {
    const divisor = design.pricing.total_includes_tax ? 1.1 : 1
    return roundTo(design.pricing.total_cents / 100 / divisor, 2)
  }
  return null
}

/**
 * PURE — the full modelled enrichment for one Pylon design. Returns null
 * when the design has no positive DC kW (nothing can be modelled; the
 * proposal renders Pylon's verbatim sections only).
 */
export function buildPylonModelled(args: {
  design: PylonProposalDesign
  /** AU state from the project site address (e.g. 'VIC'); null tolerated. */
  state: string | null
  config: SolarConfig
  theme: ChartTheme
}): PylonModelled | null {
  const { design, config, theme } = args
  const dcKw = design.summary.dc_output_kw
  if (dcKw == null || !Number.isFinite(dcKw) || dcKw <= 0) return null

  const stateKey = normalizeAuState(args.state) ?? ''
  const specificYield = CEC_YIELD_BY_STATE[stateKey] ?? CEC_YIELD_FALLBACK
  const annual_kwh_ac = Math.round(dcKw * specificYield)

  // ── Savings (engine math: self-consumption × retail + export × FiT) ──
  const selfPct = config.self_consumption_pct
  const retail = config.retail_rate_aud_per_kwh
  const feedIn = config.feed_in.default_aud_per_kwh
  const household_annual_kwh =
    config.typical_household_kwh_per_year != null && config.typical_household_kwh_per_year > 0
      ? config.typical_household_kwh_per_year
      : 6000

  const self_consumed_kwh = Math.min(Math.round(annual_kwh_ac * selfPct), household_annual_kwh)
  const exported_kwh = Math.max(0, annual_kwh_ac - self_consumed_kwh)
  const grid_import_kwh = Math.max(0, household_annual_kwh - self_consumed_kwh)

  const annual_savings_aud = roundTo(self_consumed_kwh * retail + exported_kwh * feedIn, 2)
  const annual_bill_before_aud = roundTo(household_annual_kwh * retail, 2)
  const annual_bill_with_solar_aud = roundTo(grid_import_kwh * retail - exported_kwh * feedIn, 2)
  const offsetRaw =
    annual_bill_before_aud > 0
      ? (annual_bill_before_aud - annual_bill_with_solar_aud) / annual_bill_before_aud
      : 0
  const bill_offset_pct = roundTo(Math.min(1, Math.max(0, offsetRaw)), 3)

  // ── 20-yr projection via the engine's financial-summary module ──────
  const net_ex_gst_aud = designNetExGstAud(design) ?? 0
  // Synthesize the one tier the projection needs — the Pylon design IS
  // the tier; payback band uses the engine's wide ±30% spread semantics.
  const econ: SolarEconomicsTier = {
    tier: 'better',
    self_consumed_kwh,
    exported_kwh,
    bill_savings_aud: roundTo(self_consumed_kwh * retail, 2),
    export_earnings_aud: roundTo(exported_kwh * feedIn, 2),
    annual_savings_aud,
    payback_years_low:
      annual_savings_aud > 0 ? roundTo(net_ex_gst_aud / (annual_savings_aud * 1.3), 1) : null,
    payback_years_high:
      annual_savings_aud > 0 ? roundTo(net_ex_gst_aud / (annual_savings_aud * 0.7), 1) : null,
  }
  const priceTier = { net_ex_gst: net_ex_gst_aud } as SolarPriceTier
  const financial =
    net_ex_gst_aud > 0
      ? buildSolarFinancialSummary({ econ, price: priceTier, config })
      : null

  const environmental = buildSolarEnvironmentalImpact({
    annual_kwh_ac,
    carbon_offset_factor_kg_per_mwh: AU_GRID_CARBON_KG_PER_MWH,
    config,
  })

  const charts = {
    monthly_production: buildMonthlyProductionChart({ annual_kwh_ac, theme }),
    utility_costs: buildUtilityCostsChart({
      annual_bill_before_aud,
      annual_bill_with_solar_aud,
      source: 'modelled',
      theme,
    }),
    monthly_bill: buildMonthlyBillComparisonChart({
      annual_bill_before_aud,
      annual_bill_with_solar_aud,
      source: 'modelled',
      theme,
    }),
    cumulative_savings: financial
      ? buildCumulativeSavingsChart({
          series: financial.years.map((y) => ({
            year: y.year,
            cumulative_aud: y.cumulative_aud,
          })),
          theme,
        })
      : null,
  }

  const pct = (f: number) => `${roundTo(f * 100, 1)}%`
  const assumptions: Array<{ label: string; value: string }> = [
    { label: 'DC array power', value: `${dcKw.toFixed(2)} kW (Pylon design)` },
    {
      label: 'Specific yield',
      value: `${specificYield} kWh/kW/yr (CEC metro benchmark${stateKey ? `, ${stateKey}` : ''})`,
    },
    { label: 'Self-consumption', value: pct(selfPct) },
    { label: 'Retail rate', value: `$${retail.toFixed(2)}/kWh ex GST` },
    { label: 'Feed-in tariff', value: `$${feedIn.toFixed(2)}/kWh` },
    { label: 'Household usage', value: `${household_annual_kwh.toLocaleString('en-AU')} kWh/yr (typical)` },
    {
      label: 'Grid emission factor',
      value: `${AU_GRID_CARBON_KG_PER_MWH} kg CO\u2082e/MWh (AU national average)`,
    },
  ]
  if (financial) {
    assumptions.push(
      {
        label: 'Price escalation',
        value: `${pct(financial.assumptions.escalation_pct_per_year)}/yr`,
      },
      { label: 'Discount rate', value: pct(financial.assumptions.discount_rate_pct) },
      {
        label: 'Panel degradation',
        value: `${pct(financial.assumptions.degradation_pct_per_year)}/yr`,
      },
    )
  }

  return {
    annual_kwh_ac,
    specific_yield_kwh_per_kw: specificYield,
    utility: {
      household_annual_kwh,
      annual_bill_before_aud,
      annual_bill_with_solar_aud,
      bill_offset_pct,
    },
    annual_savings_aud,
    net_ex_gst_aud,
    financial,
    environmental,
    charts,
    assumptions,
  }
}
