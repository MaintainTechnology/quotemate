// ════════════════════════════════════════════════════════════════════
// Solar — premium-quote view model (premium quote spec §4.4).
//
// ONE pure assembler turns a persisted SolarEstimate + SolarConfig into
// every premium artefact, so /q/solar/[token] (theme 'dark') and the
// Gotenberg PDF (theme 'light') render the SAME deterministic SVG
// strings and the same numbers:
//
//   • layout / string overlays   (real Solar API panel geometry)
//   • utility costs              (personal when a bill exists)
//   • four charts                (production, utility, monthly, 25-yr)
//   • 20-year financial summary  (NPV / ROI / IRR / payback band)
//   • environmental impact       (grid carbon factor)
//   • assumed-values table       (DC kW, panels, tilt, azimuth, derate,
//                                 config version — Pylon-style)
//
// Every field degrades to null per the matrix (§4.6); consumers omit
// the matching section. Gated by the SOLAR_PREMIUM_QUOTE env flag.
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type { SolarConfig, SolarEstimate } from './types'
import { buildLayoutOverlay, type LayoutOverlay } from './layout-overlay'
import { buildStringOverlay, type StringOverlay } from './string-overlay'
import { resolveSolarOverlayCenter } from './static-map-center'
import { deriveSolarUtilityCosts, type SolarUtilityCosts } from './utility-costs'
import {
  buildMonthlyProductionChart,
  buildUtilityCostsChart,
  buildMonthlyBillComparisonChart,
  buildCumulativeSavingsChart,
  type ChartTheme,
  type SolarChart,
} from './charts'
import {
  buildSolarFinancialSummary,
  buildSolarEnvironmentalImpact,
  type SolarFinancialSummary,
  type SolarEnvironmentalImpact,
} from './financial-summary'
import { orientationLabel } from './hero-overlay'
import { monthlyKwhFromWeights } from './raster-analysis'
import { buildSolarSunView, type SolarSunView } from './sun-view'

/** Feature gate (spec §5) — pure so it is unit-testable; callers pass
 *  process.env.SOLAR_PREMIUM_QUOTE. Enabled on 'true' or '1' only. */
export function solarPremiumQuoteEnabled(envValue: string | undefined): boolean {
  return envValue === 'true' || envValue === '1'
}

export type SolarAssumedValueRow = { label: string; value: string }

export type SolarPremiumQuote = {
  /** Engineering-accurate panel layout; null without geometry (§4.6). */
  layout: LayoutOverlay | null
  /** Indicative string runs; null without geometry. */
  strings: StringOverlay | null
  /** Personal/modelled utility costs; null when the estimate has no tiers. */
  utility: SolarUtilityCosts | null
  charts: {
    monthlyProduction: SolarChart | null
    utilityCosts: SolarChart | null
    monthlyBill: SolarChart | null
    cumulativeSavings: SolarChart | null
  }
  /** 20-yr NPV/ROI/IRR for the headline tier; null when unpriceable. */
  financial: SolarFinancialSummary | null
  /** Environmental impact; null when the carbon factor is absent. */
  environmental: SolarEnvironmentalImpact | null
  /** Pylon-style assumed-values table (no dollar figures). */
  assumed_values: SolarAssumedValueRow[]
  /** Sun & shade analysis (full-exploitation build 2026-06-13); null
   *  when the estimate carries no sun data. No dollars → pre-confirm OK. */
  sun: SolarSunView | null
}

export function buildSolarPremiumQuote(args: {
  estimate: SolarEstimate
  config: SolarConfig
  theme: ChartTheme
}): SolarPremiumQuote {
  const { estimate, config, theme } = args
  const roof = estimate.roof

  // Headline tier = largest (last in good→best order) — the same tier
  // the hero overlay and the tradie-notify SMS quote.
  const headlineTier = estimate.sizing.tiers[estimate.sizing.tiers.length - 1] ?? null
  const headlineIdx = estimate.sizing.tiers.length - 1
  const headlineProd = headlineIdx >= 0 ? estimate.production[headlineIdx] ?? null : null
  const headlinePrice = headlineTier
    ? estimate.price.tiers.find((t) => t.tier === headlineTier.tier) ?? null
    : null
  const headlineEcon = headlineTier
    ? estimate.economics.tiers.find((t) => t.tier === headlineTier.tier) ?? null
    : null

  // ── Overlays — require panel geometry + a deterministic centre. ────
  const center = resolveSolarOverlayCenter({
    roof,
    location: estimate.context.location ?? null,
  })
  const panelLimit = headlineTier?.panels_count ?? null

  const layout =
    center != null
      ? buildLayoutOverlay({
          panels: roof.panels ?? [],
          panel_size_m: roof.panel_size_m,
          planes: roof.planes,
          center,
          panel_limit: panelLimit,
        })
      : null

  const strings =
    center != null
      ? buildStringOverlay({
          panels: roof.panels ?? [],
          planes: roof.planes,
          center,
          panel_limit: panelLimit,
          string_max_panels: config.string_max_panels ?? null,
        })
      : null

  // ── Utility costs (headline tier drives the charts). ───────────────
  const utility =
    estimate.economics.tiers.length > 0
      ? deriveSolarUtilityCosts({
          context: estimate.context,
          economics: estimate.economics,
          production: estimate.production,
          config,
        })
      : null
  const utilityHeadline =
    utility && headlineTier
      ? utility.tiers.find((t) => t.tier === headlineTier.tier) ?? null
      : null

  // ── Financial + environmental. ──────────────────────────────────────
  const financial =
    headlineEcon && headlinePrice
      ? buildSolarFinancialSummary({ econ: headlineEcon, price: headlinePrice, config })
      : null

  const environmental = headlineProd
    ? buildSolarEnvironmentalImpact({
        annual_kwh_ac: headlineProd.annual_kwh_ac,
        carbon_offset_factor_kg_per_mwh: roof.carbon_offset_factor_kg_per_mwh,
        config,
      })
    : null

  // ── Charts. ─────────────────────────────────────────────────────────
  // Monthly production: prefer the MEASURED seasonal shape from the
  // monthly-flux rasters (context.sun weights × the headline tier's
  // annual AC output) over the modelled AU-wide curve.
  const sunWeights = estimate.context.sun?.monthly_production_weights ?? null
  const measuredMonthly =
    headlineProd && sunWeights
      ? monthlyKwhFromWeights(headlineProd.annual_kwh_ac, sunWeights)
      : null
  const monthlyProduction = headlineProd
    ? buildMonthlyProductionChart({
        annual_kwh_ac: headlineProd.annual_kwh_ac,
        theme,
        monthly_kwh: measuredMonthly,
      })
    : null

  const utilityCosts =
    utility && utilityHeadline
      ? buildUtilityCostsChart({
          annual_bill_before_aud: utility.annual_bill_before_aud,
          annual_bill_with_solar_aud: utilityHeadline.annual_bill_with_solar_aud,
          source: utility.source,
          theme,
        })
      : null

  const monthlyBill =
    utility && utilityHeadline
      ? buildMonthlyBillComparisonChart({
          annual_bill_before_aud: utility.annual_bill_before_aud,
          annual_bill_with_solar_aud: utilityHeadline.annual_bill_with_solar_aud,
          source: utility.source,
          theme,
        })
      : null

  const cumulativeSavings = financial
    ? buildCumulativeSavingsChart({
        series: financial.years.map((y) => ({
          year: y.year,
          cumulative_aud: y.cumulative_aud,
        })),
        net_cost_aud: headlinePrice?.net_ex_gst ?? null,
        theme,
      })
    : null

  // ── Assumed values (no dollars — renders pre-confirm). ─────────────
  const assumed_values: SolarAssumedValueRow[] = []
  if (headlineTier) {
    assumed_values.push(
      { label: 'DC array power', value: `${headlineTier.system_kw_dc} kW` },
      { label: 'Panel count', value: String(headlineTier.panels_count) },
    )
  }
  if (roof.panel_capacity_watts > 0) {
    assumed_values.push({ label: 'Panel rating', value: `${roof.panel_capacity_watts} W` })
  }
  if (roof.mean_pitch_degrees != null) {
    assumed_values.push({ label: 'Roof tilt', value: `${roof.mean_pitch_degrees}°` })
  }
  assumed_values.push({
    label: 'Primary azimuth',
    value: orientationLabel(roof.primary_orientation),
  })
  if (headlineProd) {
    assumed_values.push({
      label: 'DC→AC derate',
      value: headlineProd.derate_applied.toFixed(2),
    })
  }
  if (financial) {
    assumed_values.push(
      {
        label: 'Price escalation',
        value: `${(financial.assumptions.escalation_pct_per_year * 100).toFixed(1)}%/yr`,
      },
      {
        label: 'Discount rate',
        value: `${(financial.assumptions.discount_rate_pct * 100).toFixed(1)}%`,
      },
      {
        label: 'Panel degradation',
        value: `${(financial.assumptions.degradation_pct_per_year * 100).toFixed(1)}%/yr`,
      },
    )
  }
  // Pylon STC cross-check badge (spec §4.5) — display-only verification.
  if (estimate.context.pylon_stc_check?.verified) {
    assumed_values.push({
      label: 'STC count',
      value: 'Verified against Pylon ✓',
    })
  }
  // Official zone facts from Pylon's calculator (supplements build
  // 2026-06-13) — rebate transparency, display-only.
  const stcCheck = estimate.context.pylon_stc_check
  if (stcCheck?.zone != null) {
    const parts = [`Zone ${stcCheck.zone}`]
    if (stcCheck.zone_rating != null) parts.push(`rating ${stcCheck.zone_rating}`)
    if (stcCheck.deeming_period != null) parts.push(`${stcCheck.deeming_period}-yr deeming`)
    assumed_values.push({ label: 'STC zone', value: parts.join(' · ') })
  }
  // Sun facts from buildingInsights (full-exploitation build 2026-06-13).
  if (roof.max_sunshine_hours_per_year != null) {
    assumed_values.push({
      label: 'Max sunshine',
      value: `${Math.round(roof.max_sunshine_hours_per_year).toLocaleString('en-AU')} hrs/yr`,
    })
  }
  if (roof.panel_lifetime_years != null) {
    assumed_values.push({
      label: 'Panel lifetime',
      value: `${roof.panel_lifetime_years} yrs`,
    })
  }
  // Power supply + any customer/tradie-requested size (design 2026-06-16).
  // Phase explains the export ceiling; a clamped request is called out so the
  // customer understands why they didn't get the full kW they asked for.
  const supplyPhase = estimate.context.phase ?? 'single'
  assumed_values.push({
    label: 'Power supply',
    value: supplyPhase === 'three' ? '3-phase' : 'Single-phase',
  })
  const reqKw = estimate.context.requested_system_kw
  if (typeof reqKw === 'number' && reqKw > 0) {
    const headlineKw = headlineTier?.system_kw_dc
    // The request was clamped when the headline tier landed below the size the
    // customer asked for — the roof or the DNSP export ceiling capped it. (The
    // engine anchors the tiers to requested_size_kw, so a smaller headline kW
    // than the request means a cap was hit.)
    const reqClamped =
      typeof headlineKw === 'number' && headlineKw + 0.05 < reqKw
    assumed_values.push({
      label: 'Requested size',
      value:
        reqClamped && typeof headlineKw === 'number'
          ? `${reqKw} kW — capped at ${headlineKw} kW by roof / connection`
          : `${reqKw} kW`,
    })
  }
  assumed_values.push({ label: 'Config version', value: estimate.config_version })

  return {
    layout,
    strings,
    utility,
    charts: { monthlyProduction, utilityCosts, monthlyBill, cumulativeSavings },
    financial,
    environmental,
    assumed_values,
    sun: buildSolarSunView(estimate),
  }
}
