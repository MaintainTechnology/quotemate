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
// transparent three-line breakdown. GST factor 1.10, call-out floor after
// the multiplication — identical to lib/roofing/pricing.ts.
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

// ── Default rate card (mirrors DEFAULT_SOLAR_CONFIG.default_rate_card) ──
export const DEFAULT_SOLAR_RATE_CARD: SolarRateCard = {
  install_rate_per_kw: {
    standard_panels: 1100,
    premium_panels: 1450,
    unknown: 0,
  },
  multi_storey_loading_pct: 0.15,
  complex_roof_loading_pct: 0.10,
  gst_registered: true,
  call_out_minimum_ex_gst: 3500,
}

// ── Loadings ────────────────────────────────────────────────────────
type Loading = {
  code: 'multi_storey' | 'complex_roof'
  pct: number
  detail: string
}

export function applicableLoadings(
  roof: SolarRoofFacts,
  rateCard: SolarRateCard,
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
  const steep = typeof roof.mean_pitch_degrees === 'number' && roof.mean_pitch_degrees > 35
  const manyPlanes = roof.segment_count >= 6
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
 *  never state-default; spec §5). */
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
  const rateCard = args.rateCard ?? args.config.default_rate_card ?? DEFAULT_SOLAR_RATE_CARD
  const { sizing, roof, context, config } = args

  const loadings = applicableLoadings(roof, rateCard)
  const loadingMultiplier = loadings.reduce((acc, l) => acc * (1 + l.pct), 1)

  const gstFactor = rateCard.gst_registered ? 1.10 : 1.0
  const floor = rateCard.call_out_minimum_ex_gst ?? 0
  const applyFloor = (n: number) => (floor > 0 && n > 0 ? Math.max(n, floor) : n)

  let callOutMinimumApplied = false
  // Use the panel type from the first tier for the effective-rate display.
  const displayRate =
    (rateCard.install_rate_per_kw[sizing.tiers[0]?.panel_type ?? 'unknown'] ?? 0) *
    loadingMultiplier

  const tiers: SolarPriceTier[] = sizing.tiers.map((t) => {
    const baseRate = rateCard.install_rate_per_kw[t.panel_type] ?? 0
    const grossRaw = t.system_kw_dc * baseRate * loadingMultiplier
    const grossFloored = applyFloor(grossRaw)
    if (floor > 0 && grossRaw > 0 && grossRaw < floor) callOutMinimumApplied = true

    const gross_ex_gst = roundTo(grossFloored, 2)
    const stc = stcBreakdown({ system_kw: t.system_kw_dc, context, config })
    const net_ex_gst = roundTo(Math.max(0, gross_ex_gst - stc.rebate_aud), 2)

    return {
      tier: t.tier,
      label: t.label,
      system_kw_dc: t.system_kw_dc,
      gross_ex_gst,
      gross_inc_gst: roundTo(gross_ex_gst * gstFactor, 2),
      stc,
      net_ex_gst,
      net_inc_gst: roundTo(net_ex_gst * gstFactor, 2),
      scope: `${t.system_kw_dc.toFixed(1)} kW solar install (${t.panels_count} ${t.panel_type.replace('_', ' ')}), supply and install by an accredited installer.`,
    }
  })

  return {
    tiers,
    effective_rate_per_kw: roundTo(displayRate, 2),
    loadings_applied: loadings,
    routing: sizing.routing,
    call_out_minimum_applied: callOutMinimumApplied,
  }
}

function roundTo(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

export const __test_only__ = { roundTo, stcBreakdown, applicableLoadings }
