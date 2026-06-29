// ════════════════════════════════════════════════════════════════════
// Painting — pure pricing logic.
//
// $/m² (and $/lm for trim) × quantity × coats × prep → Good/Better/Best
// tiers + routing decision. Like roofing, painting does NOT use the
// strict-grounding Opus estimator — it's a deterministic per-m² calc:
//   Good   = 1-coat refresh (a lighter scope, not a discount)
//   Better = 2-coat standard repaint (the base rate)
//   Best   = premium paint + extra prep/care (an uplift)
//
// Every tier carries an inc-GST low/high band derived from the area
// engine's confidence — the estimate is always a RANGE, never a single
// hard number, because internal floor area is itself uncertain.
//
// PURE — no I/O. Fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type {
  PaintCondition,
  PaintMeasurement,
  PaintScope,
  PaintUserInputs,
  PaintingPriceTier,
  PaintingQuotePrice,
  PaintingRateCard,
  PaintingRoutingDecision,
  PropertyFacts,
} from './types'

// ── Defaults ────────────────────────────────────────────────────────
// Per-tenant rate cards override these via pricing_book.overlays.
// Rates from the AU painting estimator brief (2024–2026):
//   walls $20–35/m² (≈$28), ceilings $10–30/m² (≈$20), trim $8–15/lm
//   (≈$12), exterior $25–60/m² (≈$45).

export const DEFAULT_PAINTING_RATE_CARD: PaintingRateCard = {
  rate_per_unit: {
    walls: 28,
    ceilings: 20,
    trim: 12,
    exterior: 45,
  },
  coats_multiplier: { 1: 0.7, 2: 1.0, 3: 1.35 },
  condition_multiplier: { sound: 1.0, minor: 1.15, bare: 1.4 },
  colour_change_extra: 0.1,
  good_refresh_fraction: 0.72,
  premium_uplift_pct: 0.28,
  double_storey_loading_pct: 0.5,
  gst_registered: true,
  // A half-day minimum so a tiny single-room job never computes an
  // unrealistic number no painter would attend for. Well below any
  // whole-house tier, so it only binds on small jobs.
  call_out_minimum_ex_gst: 450,
  // Default model is the per-m² rate card above. The hourly levers below are
  // inert unless pricing_model is flipped to 'hourly' (a painter who quotes by
  // labour time sets these at onboarding).
  pricing_model: 'sqm',
  hourly_rate: 85,
  production_rate_per_unit: {
    walls: 3, // m²/hr for a base 2-coat sound job (all-in throughput)
    ceilings: 4, // m²/hr
    trim: 7, // lm/hr
    exterior: 2, // m²/hr (slower; cutting, access)
  },
}

/** Default crew charge-out ($/hr, ex-GST) when a painter picks hourly pricing
 *  but leaves the rate blank. Chosen so the derived per-unit rates land near
 *  the per-m² defaults above. */
export const DEFAULT_PAINTING_HOURLY_RATE = 85

/** Default throughput (units/hour) used to convert measured area → labour
 *  hours in hourly mode. m²/hr for walls/ceilings/exterior, lm/hr for trim. */
export const DEFAULT_PAINTING_PRODUCTION_RATES: Record<PaintScope, number> = {
  walls: 3,
  ceilings: 4,
  trim: 7,
  exterior: 2,
}

/**
 * PURE — the effective $/unit rate map the tiers price from.
 *   • 'sqm' (default): the rate card's rate_per_unit verbatim.
 *   • 'hourly': for each scope, hourly_rate ÷ production_rate (units → hours →
 *     $). Falls back to the fixed rate_per_unit for any scope whose production
 *     rate is missing/zero, so the engine can never divide by zero.
 * Feeding this through the existing per-unit engine keeps coats/prep
 * multipliers, loadings, tiers, GST and the call-out floor identical across
 * both models — only the base rate changes.
 */
export function effectiveRatePerUnit(card: PaintingRateCard): Record<PaintScope, number> {
  if (card.pricing_model !== 'hourly') return card.rate_per_unit
  const hourly = numOrNull(card.hourly_rate) ?? DEFAULT_PAINTING_HOURLY_RATE
  const prod = card.production_rate_per_unit ?? DEFAULT_PAINTING_PRODUCTION_RATES
  const scopes: PaintScope[] = ['walls', 'ceilings', 'trim', 'exterior']
  const out = {} as Record<PaintScope, number>
  for (const scope of scopes) {
    const p = numOrNull(prod[scope])
    out[scope] = p && p > 0 ? hourly / p : (card.rate_per_unit[scope] ?? 0)
  }
  return out
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// ── Routing / inspection triggers ───────────────────────────────────

/**
 * PURE — true when this job should never be auto-quoted at a fixed price.
 * Mirrors the roofing inspection gate + the painting-specific brief:
 * lead/asbestos era, poor substrate, raked ceilings, 3+ storeys, no area
 * input, or a confidence band too wide to commit a price.
 */
export function requiresInspection(args: {
  facts: PropertyFacts
  inputs: PaintUserInputs
  measurement: PaintMeasurement | null
}): PaintingRoutingDecision | null {
  const { facts, inputs, measurement } = args

  if (measurement === null) {
    return {
      decision: 'inspection_required',
      reason:
        'No reliable floor area could be found for this address, so a site measure is needed before any price.',
    }
  }
  if (inputs.condition === 'poor') {
    return {
      decision: 'inspection_required',
      reason:
        'Surfaces are flaking, water-damaged or mouldy, so prep cannot be priced without an inspection on site.',
    }
  }
  if (inputs.ceiling_height === 'raked') {
    return {
      decision: 'inspection_required',
      reason:
        'Raked or cathedral ceilings need a measurement on site — area and access cannot be priced from floor area alone.',
    }
  }
  if (inputs.ceiling_height === 'extra_high') {
    return {
      decision: 'inspection_required',
      reason:
        'Ceilings above about 2.7 m need an on-site measure — the extra wall area and access (scaffold or tower) cannot be priced from floor area alone.',
    }
  }
  if (
    typeof facts.year_built === 'number' &&
    facts.year_built < 1970 &&
    inputs.scopes.includes('exterior')
  ) {
    return {
      decision: 'inspection_required',
      reason:
        'The building predates 1970, so lead-paint (and fibro/asbestos) risk on the exterior must be assessed on site.',
    }
  }
  if ((measurement.storeys ?? 1) >= 3) {
    return {
      decision: 'inspection_required',
      reason:
        'The building is 3 or more storeys, so access and fall protection cannot be priced without an inspection on site.',
    }
  }
  if (measurement.confidence === 'low') {
    return {
      decision: 'inspection_required',
      reason:
        'The floor area is only a rough estimate, so this is an indicative range — book a site measure to confirm the price.',
    }
  }
  return null
}

// ── Multipliers ─────────────────────────────────────────────────────

/** PURE — total labour/prep multiplier from coats + condition + colour. */
export function jobMultiplier(
  inputs: PaintUserInputs,
  rateCard: PaintingRateCard,
): number {
  const coats = rateCard.coats_multiplier[inputs.coats] ?? 1.0
  const condition =
    inputs.condition === 'poor'
      ? 1.0 // never reaches pricing (inspection), keep safe
      : (rateCard.condition_multiplier[
          inputs.condition as Exclude<PaintCondition, 'poor'>
        ] ?? 1.0)
  const colour = inputs.colour_change ? 1 + rateCard.colour_change_extra : 1.0
  return coats * condition * colour
}

type Loading = {
  code: 'double_storey' | 'colour_change'
  pct: number
  detail: string
}

/** PURE — which loadings are surfaced to the tradie as line explanations. */
export function applicableLoadings(
  measurement: PaintMeasurement,
  inputs: PaintUserInputs,
  rateCard: PaintingRateCard,
): Loading[] {
  const out: Loading[] = []
  if (inputs.scopes.includes('exterior') && (measurement.storeys ?? 1) >= 2) {
    out.push({
      code: 'double_storey',
      pct: rateCard.double_storey_loading_pct,
      detail: `${(rateCard.double_storey_loading_pct * 100).toFixed(0)}% double-storey exterior access loading`,
    })
  }
  if (inputs.colour_change) {
    out.push({
      code: 'colour_change',
      pct: rateCard.colour_change_extra,
      detail: `${(rateCard.colour_change_extra * 100).toFixed(0)}% colour-change prep`,
    })
  }
  return out
}

// ── Core pricing ────────────────────────────────────────────────────

/**
 * PURE — the Better-tier (2-coat standard) ex-GST cost across all the
 * measured surfaces at the POINT quantities. Exterior carries the
 * double-storey loading; trim/walls/ceilings share the coats/prep
 * multiplier. Returns the cost so the tier builder can scale it.
 */
function betterCostExGst(
  measurement: PaintMeasurement,
  inputs: PaintUserInputs,
  rateCard: PaintingRateCard,
  quantityOf: (s: PaintMeasurement['surfaces'][number]) => number,
): number {
  const mult = jobMultiplier(inputs, rateCard)
  const rates = effectiveRatePerUnit(rateCard)
  const doubleStorey =
    inputs.scopes.includes('exterior') && (measurement.storeys ?? 1) >= 2
      ? 1 + rateCard.double_storey_loading_pct
      : 1.0
  let total = 0
  for (const surface of measurement.surfaces) {
    const rate = rates[surface.scope] ?? 0
    const loading = surface.scope === 'exterior' ? doubleStorey : 1.0
    total += quantityOf(surface) * rate * mult * loading
  }
  return total
}

const TIER_LABELS: Record<'good' | 'better' | 'best', string> = {
  good: '1-coat refresh',
  better: '2-coat standard repaint',
  best: 'Premium paint + full prep',
}

function tierScopeLine(
  tier: 'good' | 'better' | 'best',
  scopes: PaintScope[],
): string {
  const list = scopeWords(scopes)
  if (tier === 'good') {
    return `Single topcoat refresh over sound ${list} in the existing colour.`
  }
  if (tier === 'better') {
    return `Two topcoats with standard prep across ${list}.`
  }
  return `Two coats of premium paint with full prep (patching, sanding, priming) across ${list}.`
}

function scopeWords(scopes: PaintScope[]): string {
  const words: Record<PaintScope, string> = {
    walls: 'walls',
    ceilings: 'ceilings',
    trim: 'trim',
    exterior: 'the exterior',
  }
  const parts = scopes.map((s) => words[s])
  if (parts.length <= 1) return parts[0] ?? 'the nominated surfaces'
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * PURE — compute the three-tier price + routing for a painting job.
 * Returns PaintingQuotePrice. When inspection routing fires the tiers
 * are still computed (an indicative range for the tradie), exactly like
 * roofing — the UI swaps to the inspection CTA for the customer.
 */
export function calculatePaintingPrice(args: {
  facts: PropertyFacts
  inputs: PaintUserInputs
  measurement: PaintMeasurement
  rateCard?: PaintingRateCard
}): PaintingQuotePrice {
  const rateCard = args.rateCard ?? DEFAULT_PAINTING_RATE_CARD
  const { inputs, measurement, facts } = args

  const routing =
    requiresInspection({ facts, inputs, measurement }) ??
    ({
      decision: 'tradie_review',
      reason:
        'Quote auto-calculated from the floor-area estimate. Every painting quote needs tradie sign-off before customer send.',
    } as PaintingRoutingDecision)

  const gstFactor = rateCard.gst_registered ? 1.1 : 1.0
  const floor = rateCard.call_out_minimum_ex_gst ?? 0
  const applyFloor = (n: number) => (floor > 0 && n > 0 ? Math.max(n, floor) : n)

  // Better tier at point / low / high quantities → the inc-GST band.
  const betterPoint = betterCostExGst(measurement, inputs, rateCard, (s) => s.quantity)
  const betterLow = betterCostExGst(measurement, inputs, rateCard, (s) => s.quantity_low)
  const betterHigh = betterCostExGst(measurement, inputs, rateCard, (s) => s.quantity_high)

  // ── Transparent breakdown — every contributor to the tiers ──────────
  const coatsMult = rateCard.coats_multiplier[inputs.coats] ?? 1.0
  const prepMult =
    inputs.condition === 'poor'
      ? 1.0
      : (rateCard.condition_multiplier[
          inputs.condition as Exclude<PaintCondition, 'poor'>
        ] ?? 1.0)
  const colourMult = inputs.colour_change ? 1 + rateCard.colour_change_extra : 1.0
  const doubleStoreyMult =
    inputs.scopes.includes('exterior') && (measurement.storeys ?? 1) >= 2
      ? 1 + rateCard.double_storey_loading_pct
      : 1.0
  const effectiveRates = effectiveRatePerUnit(rateCard)
  const breakdownSurfaces = measurement.surfaces.map((s) => {
    const rate = effectiveRates[s.scope] ?? 0
    const surfaceMult =
      coatsMult * prepMult * colourMult * (s.scope === 'exterior' ? doubleStoreyMult : 1.0)
    return {
      scope: s.scope,
      unit: s.unit,
      quantity: s.quantity,
      rate_per_unit: roundTo(rate, 2),
      line_ex_gst: roundTo(s.quantity * rate * surfaceMult, 2),
    }
  })
  const breakdown = {
    surfaces: breakdownSurfaces,
    coats_multiplier: coatsMult,
    prep_multiplier: prepMult,
    colour_change_multiplier: colourMult,
    double_storey_multiplier: doubleStoreyMult,
    better_ex_gst: roundTo(betterPoint, 2),
    good_refresh_fraction: rateCard.good_refresh_fraction,
    premium_uplift_pct: rateCard.premium_uplift_pct,
    gst_factor: rateCard.gst_registered ? 1.1 : 1.0,
    call_out_minimum_ex_gst: rateCard.call_out_minimum_ex_gst ?? 0,
    pricing_model: rateCard.pricing_model === 'hourly' ? ('hourly' as const) : ('sqm' as const),
    ...(rateCard.pricing_model === 'hourly'
      ? { hourly_rate: numOrNull(rateCard.hourly_rate) ?? DEFAULT_PAINTING_HOURLY_RATE }
      : {}),
  }

  const tierFractions: Record<'good' | 'better' | 'best', number> = {
    good: rateCard.good_refresh_fraction,
    better: 1.0,
    best: 1 + rateCard.premium_uplift_pct,
  }

  let callOutApplied = false
  const buildTier = (tier: 'good' | 'better' | 'best'): PaintingPriceTier => {
    const f = tierFractions[tier]
    const exRaw = betterPoint * f
    const ex = applyFloor(exRaw)
    if (floor > 0 && exRaw > 0 && exRaw < floor) callOutApplied = true
    const lowEx = applyFloor(betterLow * f)
    const highEx = applyFloor(betterHigh * f)
    return {
      tier,
      label: TIER_LABELS[tier],
      ex_gst: roundTo(ex, 2),
      inc_gst: roundTo(ex * gstFactor, 2),
      inc_gst_low: roundTo(lowEx * gstFactor, 2),
      inc_gst_high: roundTo(highEx * gstFactor, 2),
      scope: tierScopeLine(tier, inputs.scopes),
    }
  }

  const tiers: [PaintingPriceTier, PaintingPriceTier, PaintingPriceTier] = [
    buildTier('good'),
    buildTier('better'),
    buildTier('best'),
  ]

  const totalAreaM2 = roundTo(
    measurement.surfaces
      .filter((s) => s.unit === 'm2')
      .reduce((acc, s) => acc + s.quantity, 0),
    1,
  )

  return {
    confidence: measurement.confidence,
    total_area_m2: totalAreaM2,
    tiers,
    loadings_applied: applicableLoadings(measurement, inputs, rateCard),
    routing,
    call_out_minimum_applied: callOutApplied,
    breakdown,
  }
}

/** PURE — round to N decimal places. */
function roundTo(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

export const __test_only__ = { roundTo, betterCostExGst, TIER_LABELS }
