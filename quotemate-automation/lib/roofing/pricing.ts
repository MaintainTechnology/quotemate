// ════════════════════════════════════════════════════════════════════
// Roofing — pure pricing logic.
//
// $/m² × sloped area × loadings → tier prices + routing decision.
//
// The roofing trade does NOT use the strict-grounding estimator. The
// rationale (docs/strategy.md v10):
//   • Roofers price per sloped square metre operationally; line-item
//     granularity is unnecessary.
//   • Deterministic calc → no Opus on the money path → no grounding
//     validator needed → cheaper, faster, more predictable.
//   • Tier framing maps 1:1 onto the three operational scopes:
//     Good = patch / spot repair, Better = re-roof same material,
//     Best = upgrade to a better material.
//
// PURE — no I/O. Fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type {
  PitchBucket,
  RoofForm,
  RoofJobIntent,
  RoofMaterial,
  RoofMetrics,
  RoofUserInputs,
  RoofingPriceTier,
  RoofingQuotePrice,
  RoofingRateCard,
  RoofingRoutingDecision,
} from './types'

// ── Pitch corrections ───────────────────────────────────────────────
// Footprint × correction = sloped area. Per the standard residential
// pitch ranges in AU practice. unknown/very_steep cases route to
// inspection rather than guessing.
const PITCH_CORRECTION: Record<PitchBucket, number | null> = {
  shallow: 1.06, //   < 20°  (typical ~15°)
  standard: 1.10, // 20–25°  (the AU residential default ~22.5°)
  steep: 1.18, //   26–35°  (typical ~30°)
  very_steep: null, // route to inspection
  unknown: null,
}

/** PURE — sloped area in m² given footprint + customer pitch declaration. */
export function slopedAreaFromFootprint(
  footprint_m2: number,
  pitch: PitchBucket,
): number | null {
  if (!Number.isFinite(footprint_m2) || footprint_m2 <= 0) return null
  const c = PITCH_CORRECTION[pitch]
  if (c === null || c === undefined) return null
  return roundTo(footprint_m2 * c, 1)
}

/** PURE — true when this combination should never be auto-quoted. */
export function requiresInspection(args: {
  metrics: RoofMetrics
  inputs: RoofUserInputs
  outsideCoverage?: boolean
}): RoofingRoutingDecision | null {
  const { metrics, inputs, outsideCoverage } = args

  if (outsideCoverage === true) {
    return {
      decision: 'inspection_required',
      reason:
        'Address is outside Geoscape building coverage — a tradie needs to attend to measure.',
    }
  }
  if (inputs.material === 'cement_sheet') {
    return {
      decision: 'inspection_required',
      reason:
        'Cement-sheet roofs may contain asbestos — mandatory on-site inspection before any quote.',
    }
  }
  if (
    typeof inputs.building_year_built === 'number' &&
    inputs.building_year_built < 1990 &&
    inputs.intent === 'full_reroof'
  ) {
    return {
      decision: 'inspection_required',
      reason:
        'Building was constructed before 1990 — asbestos risk in roof cavity must be assessed on-site.',
    }
  }
  if (inputs.pitch === 'very_steep' || inputs.pitch === 'unknown') {
    return {
      decision: 'inspection_required',
      reason:
        'Roof pitch is steep or unknown — fall-protection cost cannot be priced without an on-site measurement.',
    }
  }
  if (metrics.form === 'complex') {
    return {
      decision: 'inspection_required',
      reason:
        'Roof form is complex — area and ridge counts need on-site measurement.',
    }
  }
  if (metrics.sloped_area_m2 === null) {
    return {
      decision: 'inspection_required',
      reason:
        'Sloped roof area could not be determined from available data — on-site measurement required.',
    }
  }
  if ((metrics.storeys ?? 1) >= 3) {
    return {
      decision: 'inspection_required',
      reason:
        'Building is 3 or more storeys — scaffold/EWP access cannot be priced without an on-site inspection.',
    }
  }
  return null
}

// ── Defaults ────────────────────────────────────────────────────────
// Per-tenant rate cards override these via pricing_book.overlays.
// Numbers chosen to match the per-m² norms in the AU re-roof market
// (Q1 2026): ~$80–$110 /m² for Colorbond, ~$95–$130 /m² for tile.

export const DEFAULT_ROOFING_RATE_CARD: RoofingRateCard = {
  reroof_rate_per_m2: {
    colorbond_trimdek: 95,
    colorbond_kliplok: 115,
    concrete_tile: 95,
    terracotta_tile: 130,
    cement_sheet: 0, // never auto-quoted
    unknown: 0,
  },
  multi_storey_loading_pct: 0.20,
  asbestos_loading_pct: 0.35,
  upgrade_material: 'colorbond_kliplok',
  gst_registered: true,
}

// ── Loadings ────────────────────────────────────────────────────────

type Loading = {
  code: 'multi_storey' | 'asbestos'
  pct: number
  detail: string
}

/** PURE — which loadings stack on this job. */
export function applicableLoadings(
  metrics: RoofMetrics,
  inputs: RoofUserInputs,
  rateCard: RoofingRateCard,
): Loading[] {
  const out: Loading[] = []
  if ((metrics.storeys ?? 1) >= 2) {
    out.push({
      code: 'multi_storey',
      pct: rateCard.multi_storey_loading_pct,
      detail: `${(rateCard.multi_storey_loading_pct * 100).toFixed(0)}% multi-storey access loading`,
    })
  }
  // Asbestos loading only fires when the customer has confirmed asbestos
  // and the work was authorised past the inspection gate. (Inspection-
  // required quotes never reach this loading.)
  if (inputs.material === 'cement_sheet') {
    out.push({
      code: 'asbestos',
      pct: rateCard.asbestos_loading_pct,
      detail: `${(rateCard.asbestos_loading_pct * 100).toFixed(0)}% asbestos handling loading`,
    })
  }
  return out
}

// ── Tier rates ──────────────────────────────────────────────────────
// Tier-to-multiplier mapping. Good = patch (20% of full re-roof typical
// scope), Better = re-roof same material (full rate), Best = upgrade
// material (the rateCard's upgrade_material rate).
//
// The 'good' tier intentionally is NOT a discount on the full re-roof
// rate — it's a different scope (patch / leak repair only). Tradies
// should still review before send.

const GOOD_TIER_SCOPE_FRACTION = 0.20

function tierLabel(intent: RoofJobIntent, tier: 'good' | 'better' | 'best'): string {
  if (intent === 'leak_trace') {
    if (tier === 'good') return 'Leak trace + minor repair'
    if (tier === 'better') return 'Leak trace + flashing rework'
    return 'Leak trace + full section repair'
  }
  if (intent === 'patch_repair' || intent === 'flashing_repair' || intent === 'ridge_cap') {
    if (tier === 'good') return 'Targeted patch / repair'
    if (tier === 'better') return 'Broader repair + repoint'
    return 'Full section repair'
  }
  if (intent === 'gutter_replace') {
    if (tier === 'good') return 'Gutter replace — Quad profile'
    if (tier === 'better') return 'Gutter + downpipe replace'
    return 'Gutter + downpipe + flashings'
  }
  if (tier === 'good') return 'Patch / spot repair'
  if (tier === 'better') return 'Full re-roof — same material'
  return 'Full re-roof — upgrade material'
}

function tierScopeLine(
  intent: RoofJobIntent,
  tier: 'good' | 'better' | 'best',
  material: RoofMaterial,
  upgradeMaterial: RoofMaterial,
  area_m2: number,
): string {
  const materialWords: Record<RoofMaterial, string> = {
    colorbond_trimdek: 'Colorbond Trimdek',
    colorbond_kliplok: 'Colorbond Klip-Lok 700',
    concrete_tile: 'concrete tile',
    terracotta_tile: 'terracotta tile',
    cement_sheet: 'cement sheet',
    unknown: 'the existing material',
  }
  const m = materialWords[material]
  const u = materialWords[upgradeMaterial]
  if (intent === 'full_reroof') {
    if (tier === 'good') {
      return `Spot patches and ridge cap rebed on the existing ${m} roof (no full replacement).`
    }
    if (tier === 'better') {
      return `Full re-roof of approximately ${area_m2.toFixed(0)} m² using ${m}, including ridge caps and flashings.`
    }
    return `Full re-roof of approximately ${area_m2.toFixed(0)} m² using ${u} as a material upgrade, including ridge caps and flashings.`
  }
  if (intent === 'leak_trace') {
    if (tier === 'good') return 'Locate the leak source and perform a minor fix (replace one tile / reseal one flashing).'
    if (tier === 'better') return 'Leak trace plus full flashing rework at the suspect penetration.'
    return 'Leak trace plus targeted section repair (up to ~5 m² of roof material replaced).'
  }
  return `Roofing works applied across approximately ${area_m2.toFixed(0)} m² of the existing roof.`
}

/**
 * PURE — compute the three-tier price + routing for a roofing job.
 * Returns RoofingQuotePrice. Throws only on programmer error (negative
 * area, missing pitch correction); operational failures (inspection
 * routing) surface inside the result's `routing` field.
 */
export function calculateRoofingPrice(args: {
  metrics: RoofMetrics
  inputs: RoofUserInputs
  rateCard?: RoofingRateCard
  outsideCoverage?: boolean
}): RoofingQuotePrice {
  const rateCard = args.rateCard ?? DEFAULT_ROOFING_RATE_CARD
  const { metrics, inputs } = args

  const routing =
    requiresInspection({
      metrics,
      inputs,
      outsideCoverage: args.outsideCoverage,
    }) ??
    ({
      decision: 'tradie_review',
      reason:
        'Quote auto-calculated from Geoscape measurement — every roofing quote requires tradie sign-off before customer send.',
    } as RoofingRoutingDecision)

  // Sloped area is the canonical pricing input. When inspection routing
  // already fired we still emit a "would have been" indicative number
  // for the tradie's situational awareness, using the footprint and a
  // gentle 1.10 correction. Customers never see this if inspection
  // routing applied — the UI swaps to the inspection CTA.
  const area_m2 =
    metrics.sloped_area_m2 ??
    (metrics.footprint_m2 > 0 ? roundTo(metrics.footprint_m2 * 1.10, 1) : 0)

  const baseRate = rateCard.reroof_rate_per_m2[inputs.material] ?? 0
  const upgradeRate = rateCard.reroof_rate_per_m2[rateCard.upgrade_material] ?? 0

  const loadings = applicableLoadings(metrics, inputs, rateCard)
  const loadingMultiplier = loadings.reduce((acc, l) => acc * (1 + l.pct), 1)

  const betterEx = area_m2 * baseRate * loadingMultiplier
  const bestEx = area_m2 * upgradeRate * loadingMultiplier
  const goodEx = betterEx * GOOD_TIER_SCOPE_FRACTION

  const gstFactor = rateCard.gst_registered ? 1.10 : 1.0
  const toIncGst = (n: number) => roundTo(n * gstFactor, 2)

  const effectiveRate = baseRate * loadingMultiplier

  const tiers: [RoofingPriceTier, RoofingPriceTier, RoofingPriceTier] = [
    {
      tier: 'good',
      label: tierLabel(inputs.intent, 'good'),
      ex_gst: roundTo(goodEx, 2),
      inc_gst: toIncGst(goodEx),
      scope: tierScopeLine(
        inputs.intent,
        'good',
        inputs.material,
        rateCard.upgrade_material,
        area_m2,
      ),
    },
    {
      tier: 'better',
      label: tierLabel(inputs.intent, 'better'),
      ex_gst: roundTo(betterEx, 2),
      inc_gst: toIncGst(betterEx),
      scope: tierScopeLine(
        inputs.intent,
        'better',
        inputs.material,
        rateCard.upgrade_material,
        area_m2,
      ),
    },
    {
      tier: 'best',
      label: tierLabel(inputs.intent, 'best'),
      ex_gst: roundTo(bestEx, 2),
      inc_gst: toIncGst(bestEx),
      scope: tierScopeLine(
        inputs.intent,
        'best',
        inputs.material,
        rateCard.upgrade_material,
        area_m2,
      ),
    },
  ]

  return {
    area_m2,
    effective_rate_per_m2: roundTo(effectiveRate, 2),
    tiers,
    loadings_applied: loadings,
    routing,
  }
}

/** PURE — round to N decimal places, banker-rounding-free, predictable. */
function roundTo(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

// Re-export the small helpers for tests + callers that want them direct.
export const __test_only__ = { roundTo, GOOD_TIER_SCOPE_FRACTION, PITCH_CORRECTION }

/** Map a RoofForm value to a human-readable label for UI. */
export function formLabel(form: RoofForm): string {
  switch (form) {
    case 'gable':       return 'Gable'
    case 'hip':         return 'Hip'
    case 'skillion':    return 'Skillion (mono-pitch)'
    case 'gable_hip':   return 'Gable + hip combination'
    case 'complex':     return 'Complex / irregular'
    case 'unknown':     return 'Unknown — needs inspection'
  }
}
