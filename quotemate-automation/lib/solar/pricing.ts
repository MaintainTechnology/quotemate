// ════════════════════════════════════════════════════════════════════
// Solar — pure pricing logic (mirror of roofing/painting calculate*Price).
//
//   gross $ = system_kW × $/kW (panel grade) × loadings
//   STC      = floor(kW × zone_rating × deeming_years) × stc_price
//   net $    = gross − STC
//
// Deterministic — no LLM on the money path. The STC subtraction lives
// HERE (not in the caller) because it needs the context's postcode/year
// and the dated config; the customer page renders gross → STC → net as a
// transparent three-line breakdown. GST computed as ex_gst + roundTo(ex_gst
// × GST_RATE, 2) so the displayed GST component equals a legal invoice line.
// GST is only applied when rateCard.gst_registered is true.
// Call-out floor after the multiplication — identical to lib/roofing/pricing.ts.
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type {
  SolarSizingResult,
  SolarRoofFacts,
  SolarEstimateContext,
  SolarConfig,
  SolarRateCard,
  SolarPriceTier,
  SolarStcBreakdown,
  SolarQuotePrice,
} from './types'
import { DEFAULT_SOLAR_CONFIG } from './config'
import { roundTo } from './math'

// ── GST rate constant (10% AU GST). Applied only when rateCard.gst_registered. ──
const GST_RATE = 0.10

// ── Default rate card re-exported from config (single source of truth) ──
// Callers that need a fallback rate card should import this rather than
// hard-coding numbers; it mirrors DEFAULT_SOLAR_CONFIG.default_rate_card
// exactly so a config.ts update is reflected here automatically.
export const DEFAULT_SOLAR_RATE_CARD: SolarRateCard =
  DEFAULT_SOLAR_CONFIG.default_rate_card

// ── Loadings ────────────────────────────────────────────────────────
type Loading = {
  code: 'multi_storey' | 'complex_roof'
  pct: number
  detail: string
}

export function applicableLoadings(
  roof: SolarRoofFacts,
  rateCard: SolarRateCard,
  config?: SolarConfig,
): Loading[] {
  const out: Loading[] = []
  if ((roof.storeys ?? 1) >= 2) {
    out.push({
      code: 'multi_storey',
      pct: rateCard.multi_storey_loading_pct,
      detail: `${(rateCard.multi_storey_loading_pct * 100).toFixed(0)}% multi-storey roof access loading`,
    })
  }
  // A steep mean pitch (> 35°) or a complex many-plane roof loads access.
  // The segment threshold is config-driven (defaults to 6 if not set).
  const complexRoofMinSegments = config?.complex_roof_min_segments ?? 6
  const steep = typeof roof.mean_pitch_degrees === 'number' && roof.mean_pitch_degrees > 35
  const manyPlanes = roof.segment_count >= complexRoofMinSegments
  if (steep || manyPlanes) {
    out.push({
      code: 'complex_roof',
      pct: rateCard.complex_roof_loading_pct,
      detail: `${(rateCard.complex_roof_loading_pct * 100).toFixed(0)}% complex/steep roof loading`,
    })
  }
  return out
}

// ── STC breakdown ────────────────────────────────────────────────────
/** PURE — STC certificates + dollar rebate for a system size. Postcodes
 *  not in the zone table yield zone 0 → 0 certificates → 0 rebate (we
 *  never state-default; spec §5). deeming_years=0 (SRES ended) also yields
 *  0 certificates → net equals gross. */
export function stcBreakdown(args: {
  system_kw: number
  context: SolarEstimateContext
  config: SolarConfig
}): SolarStcBreakdown {
  const { system_kw, context, config } = args
  const zone_rating = config.zone_table[context.postcode] ?? 0
  const deeming_years = config.deeming_schedule[context.install_year] ?? 0
  const certificates =
    zone_rating > 0 && deeming_years > 0
      ? Math.floor(system_kw * zone_rating * deeming_years)
      : 0
  const stc_price_aud = config.stc_price_aud
  const rebate_aud = roundTo(certificates * stc_price_aud, 2)
  return {
    system_kw,
    zone_rating,
    deeming_years,
    certificates,
    stc_price_aud,
    rebate_aud,
  }
}

export function calculateSolarPrice(args: {
  sizing: SolarSizingResult
  roof: SolarRoofFacts
  context: SolarEstimateContext
  config: SolarConfig
  rateCard?: SolarRateCard
}): SolarQuotePrice {
  const { sizing, roof, context, config } = args
  // Guard: inspection_required path produces tiers=[]; callers cannot price it.
  if (sizing.tiers.length === 0) {
    throw new Error(
      'calculateSolarPrice called with an inspection_required sizing result (tiers=[]).' +
        ' Route to inspection before pricing.',
    )
  }

  // Use config's default_rate_card as the fallback — single source of truth.
  const rateCard = args.rateCard ?? config.default_rate_card

  const loadings = applicableLoadings(roof, rateCard, config)
  const loadingMultiplier = loadings.reduce((acc, l) => acc * (1 + l.pct), 1)

  const floor = rateCard.call_out_minimum_ex_gst ?? 0
  const applyFloor = (n: number) => (floor > 0 && n > 0 ? Math.max(n, floor) : n)

  let callOutMinimumApplied = false

  const tiers: SolarPriceTier[] = sizing.tiers.map((t) => {
    const baseRate = rateCard.install_rate_per_kw[t.panel_type] ?? 0

    // Guard: unknown panel type (baseRate=0) for a real kW system is a config
    // error — a $0 gross quote must never slip through undetected.
    if (baseRate === 0 && t.system_kw_dc > 0) {
      throw new Error(
        `calculateSolarPrice: no install rate for panel_type '${t.panel_type}' on a ` +
          `${t.system_kw_dc} kW system. Update the rate card or resolve the panel type ` +
          `before pricing.`,
      )
    }

    const grossRaw = t.system_kw_dc * baseRate * loadingMultiplier
    const grossFloored = applyFloor(grossRaw)
    if (floor > 0 && grossRaw > 0 && grossRaw < floor) callOutMinimumApplied = true

    const gross_ex_gst = roundTo(grossFloored, 2)
    const stc = stcBreakdown({ system_kw: t.system_kw_dc, context, config })
    const net_ex_gst = roundTo(Math.max(0, gross_ex_gst - stc.rebate_aud), 2)

    // GST: compute the tax component separately so the displayed line
    // (inc_gst − ex_gst) equals roundTo(ex_gst × GST_RATE, 2) on AU tax
    // invoices. GST is only applied when rateCard.gst_registered is true.
    const gross_gst = rateCard.gst_registered ? roundTo(gross_ex_gst * GST_RATE, 2) : 0
    const net_gst = rateCard.gst_registered ? roundTo(net_ex_gst * GST_RATE, 2) : 0

    return {
      tier: t.tier,
      label: t.label,
      system_kw_dc: t.system_kw_dc,
      gross_ex_gst,
      gross_inc_gst: roundTo(gross_ex_gst + gross_gst, 2),
      stc,
      net_ex_gst,
      net_inc_gst: roundTo(net_ex_gst + net_gst, 2),
      scope: `${t.system_kw_dc.toFixed(1)} kW solar install (${t.panels_count} ${t.panel_type.replace('_', ' ')}), supply and install by an accredited installer.`,
    }
  })

  // Compute effective_rate_per_kw AFTER the tier loop (so any guard throws
  // above have already fired — displayRate must reflect a known panel type).
  const displayRate =
    (rateCard.install_rate_per_kw[sizing.tiers[0].panel_type] ?? 0) *
    loadingMultiplier

  return {
    tiers,
    effective_rate_per_kw: roundTo(displayRate, 2),
    loadings_applied: loadings,
    routing: sizing.routing,
    call_out_minimum_applied: callOutMinimumApplied,
  }
}

export const __test_only__ = { applicableLoadings }
