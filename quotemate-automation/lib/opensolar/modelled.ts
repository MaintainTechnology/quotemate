// ════════════════════════════════════════════════════════════════════
// OpenSolar proposal — enrichment, real-data-first (pure).
//
// Sourcing rule (spec §4.4): anything the OpenSolar design exposes is
// used VERBATIM (annual + monthly output, bills, payback/NPV/IRR/ROI,
// CO₂ lifetime); anything missing — typically on the API Access plan,
// which omits the design + proposal data — is modelled by QuoteMate
// from the design facts and the tenant's solar_config constants, and
// labelled "modelled by QuoteMate". Nothing here ever feeds the quote
// table — OpenSolar's own prices stay verbatim.
//
// PURE — no I/O. Reuses the solar engine's chart builders + financial
// projection so all three solar tabs tell the same story with the same
// math and the same print-safe SVGs.
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
import { cecYieldForState, normalizeAuState } from '@/lib/pylon/modelled'
import type { OpenSolarProposalDesign } from './proposal'

/** AU national grid emission factor, kg CO₂e/MWh (DCCEEW NGA factors) —
 *  used only when the design carries no co2_tons_lifetime of its own. */
const AU_GRID_CARBON_KG_PER_MWH = 680

export type OpenSolarFinancialStat = {
  label: string
  value: string
  hint?: string
  /** 'design' = OpenSolar's own figure, verbatim. 'modelled' = QuoteMate. */
  source: 'design' | 'modelled'
}

export type OpenSolarModelled = {
  /** AC production for the system, kWh/yr — design figure when present. */
  annual_kwh_ac: number
  /** True when annual_kwh_ac is OpenSolar's own designed output. */
  annual_is_design: boolean
  utility: {
    annual_bill_before_aud: number
    annual_bill_with_solar_aud: number
    /** True when the bills came from the design's own bill calcs. */
    is_design: boolean
  } | null
  /** Headline financial stats — per-stat design/modelled provenance. */
  financial_stats: OpenSolarFinancialStat[]
  /** Modelled 20-yr projection (for the savings chart + assumptions). */
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

/** Ex-GST cash price in dollars — the design's own ex-tax figure, falling
 *  back to stripping 10% GST from the inc-tax total. */
export function openSolarNetExGstAud(design: OpenSolarProposalDesign): number | null {
  if (design.price_excluding_tax_aud != null && design.price_excluding_tax_aud > 0) {
    return roundTo(design.price_excluding_tax_aud, 2)
  }
  if (design.price_including_tax_aud != null && design.price_including_tax_aud > 0) {
    return roundTo(design.price_including_tax_aud / 1.1, 2)
  }
  return null
}

const pctText = (f: number) => `${roundTo(f * 100, 1)}%`
const aud0 = (n: number) => '$' + Math.round(n).toLocaleString('en-AU')

/**
 * PURE — the full enrichment for one OpenSolar design. Returns null when
 * the design has neither a designed output nor a positive kW (nothing
 * can be shown or modelled).
 */
export function buildOpenSolarModelled(args: {
  design: OpenSolarProposalDesign
  /** AU state from the project site (e.g. 'NSW'); null tolerated. */
  state: string | null
  config: SolarConfig
  theme: ChartTheme
}): OpenSolarModelled | null {
  const { design, config, theme } = args
  const kw = design.kw_stc

  // ── Production: design verbatim, else CEC-benchmark model ──────────
  const designAnnual =
    design.output_annual_kwh != null && design.output_annual_kwh > 0
      ? Math.round(design.output_annual_kwh)
      : null
  const stateKey = normalizeAuState(args.state)
  const specificYield = cecYieldForState(args.state)
  const modelledAnnual =
    kw != null && Number.isFinite(kw) && kw > 0 ? Math.round(kw * specificYield) : null
  const annual_kwh_ac = designAnnual ?? modelledAnnual
  if (annual_kwh_ac == null || annual_kwh_ac <= 0) return null
  const annual_is_design = designAnnual != null

  // ── Bills: design's own bill calcs verbatim, else engine model ─────
  const designBefore = design.proposal?.bill_before_annual_aud ?? null
  const designAfter = design.proposal?.bill_after_annual_aud ?? null
  const haveDesignBills = designBefore != null && designBefore > 0 && designAfter != null

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

  const modelledBefore = roundTo(household_annual_kwh * retail, 2)
  const modelledAfter = roundTo(grid_import_kwh * retail - exported_kwh * feedIn, 2)

  const billBefore = haveDesignBills ? designBefore : modelledBefore
  const billAfter = haveDesignBills ? designAfter : modelledAfter
  const annual_savings_aud = roundTo(Math.max(0, billBefore - billAfter), 2)

  // ── 20-yr projection via the engine's financial-summary module ─────
  const net_ex_gst_aud = openSolarNetExGstAud(design) ?? 0
  const econ: SolarEconomicsTier = {
    tier: 'better',
    self_consumed_kwh,
    exported_kwh,
    bill_savings_aud: roundTo(self_consumed_kwh * retail, 2),
    export_earnings_aud: roundTo(exported_kwh * feedIn, 2),
    annual_savings_aud:
      annual_savings_aud > 0
        ? annual_savings_aud
        : roundTo(self_consumed_kwh * retail + exported_kwh * feedIn, 2),
    payback_years_low:
      annual_savings_aud > 0 ? roundTo(net_ex_gst_aud / (annual_savings_aud * 1.3), 1) : null,
    payback_years_high:
      annual_savings_aud > 0 ? roundTo(net_ex_gst_aud / (annual_savings_aud * 0.7), 1) : null,
  }
  const priceTier = { net_ex_gst: net_ex_gst_aud } as SolarPriceTier
  const financial =
    net_ex_gst_aud > 0 ? buildSolarFinancialSummary({ econ, price: priceTier, config }) : null

  // ── Headline financial stats — design figures take precedence ──────
  const p = design.proposal
  const financial_stats: OpenSolarFinancialStat[] = []
  if (p?.npv_aud != null) {
    financial_stats.push({ label: 'Net present value', value: aud0(p.npv_aud), source: 'design' })
  } else if (financial) {
    financial_stats.push({
      label: 'Net present value',
      value: aud0(financial.npv_aud),
      hint: `Discounted at ${(financial.assumptions.discount_rate_pct * 100).toFixed(1)}%`,
      source: 'modelled',
    })
  }
  if (p?.payback_year != null) {
    financial_stats.push({
      label: 'Payback',
      value: `${roundTo(p.payback_year, 1)} yrs`,
      source: 'design',
    })
  } else if (financial && financial.payback_years_low != null && financial.payback_years_high != null) {
    financial_stats.push({
      label: 'Payback',
      value: `${Math.round(financial.payback_years_low)}\u2013${Math.round(financial.payback_years_high)} yrs`,
      source: 'modelled',
    })
  }
  if (p?.roi_pct != null) {
    financial_stats.push({
      label: 'Return on investment',
      value: `${roundTo(p.roi_pct, 1).toLocaleString('en-AU')}%`,
      source: 'design',
    })
  } else if (financial) {
    financial_stats.push({
      label: 'Total ROI (20 yr)',
      value: `${financial.total_roi_pct.toLocaleString('en-AU')}%`,
      hint: `${aud0(financial.total_savings_20yr_aud)} cumulative`,
      source: 'modelled',
    })
  }
  if (p?.irr_pct != null) {
    financial_stats.push({
      label: 'IRR',
      value: `${roundTo(p.irr_pct, 1).toLocaleString('en-AU')}%`,
      source: 'design',
    })
  } else if (financial && financial.irr_pct != null) {
    financial_stats.push({
      label: 'IRR',
      value: `${financial.irr_pct.toLocaleString('en-AU')}%`,
      source: 'modelled',
    })
  }

  // ── Environmental: design CO₂ lifetime verbatim, else factor model ─
  const environmental = buildSolarEnvironmentalImpact({
    annual_kwh_ac,
    carbon_offset_factor_kg_per_mwh: AU_GRID_CARBON_KG_PER_MWH,
    config,
  })

  // ── Charts ──────────────────────────────────────────────────────────
  const billSource: 'personal' | 'modelled' = haveDesignBills ? 'personal' : 'modelled'
  const charts = {
    monthly_production: buildMonthlyProductionChart({
      annual_kwh_ac,
      monthly_kwh: p?.output_monthly_kwh ?? null,
      theme,
    }),
    utility_costs:
      billBefore > 0
        ? buildUtilityCostsChart({
            annual_bill_before_aud: billBefore,
            annual_bill_with_solar_aud: billAfter,
            source: billSource,
            theme,
          })
        : null,
    monthly_bill:
      billBefore > 0
        ? buildMonthlyBillComparisonChart({
            annual_bill_before_aud: billBefore,
            annual_bill_with_solar_aud: billAfter,
            source: billSource,
            theme,
          })
        : null,
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

  // ── Assumed values ──────────────────────────────────────────────────
  const assumptions: Array<{ label: string; value: string }> = []
  if (kw != null) {
    assumptions.push({ label: 'DC array power', value: `${kw.toFixed(2)} kW (OpenSolar design)` })
  }
  design.module_groups.forEach((g, i) => {
    const bits = [
      g.module_quantity != null ? `${g.module_quantity} panels` : null,
      g.slope_deg != null ? `${roundTo(g.slope_deg, 0)}\u00b0 tilt` : null,
      g.azimuth_deg != null ? `${roundTo(g.azimuth_deg, 0)}\u00b0 azimuth` : null,
      g.layout,
    ].filter(Boolean)
    if (bits.length > 0) {
      assumptions.push({ label: `Roof group ${i + 1}`, value: bits.join(' · ') })
    }
  })
  assumptions.push({
    label: 'Annual production',
    value: annual_is_design
      ? `${annual_kwh_ac.toLocaleString('en-AU')} kWh/yr (OpenSolar design)`
      : `${annual_kwh_ac.toLocaleString('en-AU')} kWh/yr (modelled, ${specificYield} kWh/kW${stateKey ? `, ${stateKey}` : ''})`,
  })
  if (design.consumption_offset_pct != null) {
    assumptions.push({
      label: 'Consumption offset',
      value: `${roundTo(design.consumption_offset_pct, 0)}% (OpenSolar design)`,
    })
  }
  if (!haveDesignBills) {
    assumptions.push(
      { label: 'Self-consumption', value: pctText(selfPct) },
      { label: 'Retail rate', value: `$${retail.toFixed(2)}/kWh ex GST` },
      { label: 'Feed-in tariff', value: `$${feedIn.toFixed(2)}/kWh` },
      {
        label: 'Household usage',
        value: `${household_annual_kwh.toLocaleString('en-AU')} kWh/yr (typical)`,
      },
    )
  }
  if (design.stc_quantity != null) {
    assumptions.push({ label: 'STC quantity', value: `${design.stc_quantity} (OpenSolar design)` })
  }
  if (financial) {
    assumptions.push(
      {
        label: 'Price escalation',
        value: `${pctText(financial.assumptions.escalation_pct_per_year)}/yr`,
      },
      { label: 'Discount rate', value: pctText(financial.assumptions.discount_rate_pct) },
      {
        label: 'Panel degradation',
        value: `${pctText(financial.assumptions.degradation_pct_per_year)}/yr`,
      },
    )
  }

  return {
    annual_kwh_ac,
    annual_is_design,
    utility:
      billBefore > 0
        ? {
            annual_bill_before_aud: billBefore,
            annual_bill_with_solar_aud: billAfter,
            is_design: haveDesignBills,
          }
        : null,
    financial_stats,
    financial,
    environmental,
    charts,
    assumptions,
  }
}
