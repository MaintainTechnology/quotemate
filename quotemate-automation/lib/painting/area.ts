// ════════════════════════════════════════════════════════════════════
// Painting — deterministic area engine.
//
// PropertyFacts + PaintUserInputs → paintable m² (walls / ceilings /
// exterior) and lm (trim), each with a low/high band from a confidence
// tier. This is the heart of the painting money path and it is PURE —
// the vision/LLM layer (future) only READS printed numbers and
// CLASSIFIES surfaces; ALL arithmetic happens here, exactly like the
// roofing trade and the grounding-validator doctrine in lib/estimate.
//
// Geometry basis (see docs research brief):
//   • gross wall area = perimeter × ceiling height; perimeter recovered
//     from floor area via perimeter ≈ k_shape · 4 · √(floor_area).
//   • a flat "wall ≈ floor × k" multiplier is a valid proxy across the
//     typical residential room band and is what we use when only whole-
//     house floor area is known (no per-room dims).
//   • ceiling area ≈ floor area.
//   • exterior façade ≈ ext_perimeter × wall-band × storeys × gable.
//
// PURE — no I/O. Fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type {
  CeilingHeight,
  FloorAreaSource,
  PaintConfidence,
  PaintMeasurement,
  PaintSurfaceArea,
  PaintUserInputs,
  PropertyFacts,
} from './types'

// ── Geometry constants ──────────────────────────────────────────────

/** Ceiling height in metres per bucket. */
const CEILING_HEIGHT_M: Record<CeilingHeight, number> = {
  standard: 2.4,
  high: 2.7,
  extra_high: 3.2, // routes to inspection; height used only for the indicative number
  raked: 2.7, // routes to inspection; height used only for the indicative number
}

/**
 * Net wall-area multiplier (× floor area), openings already absorbed.
 * From the AU estimator brief: 2.4 m ≈ 2.8×, 2.7 m ≈ 3.2× (mid of the
 * documented bands). These are NET of a ~10–15% door/window deduction.
 */
const WALL_MULTIPLIER: Record<CeilingHeight, number> = {
  standard: 2.8,
  high: 3.2,
  extra_high: 3.6, // indicative only — extra_high routes to inspection before a price commits
  raked: 3.5,
}

/** Perimeter shape factor — real rooms/houses are oblong, not square. */
const K_SHAPE_INTERIOR = 1.08
const K_SHAPE_EXTERIOR = 1.15

/** Exterior wall band (m) painted per storey, to the eaves line. */
const EXTERIOR_WALL_BAND_M = 2.7
/** Gable/hip uplift on façade area — averaged across roof forms. */
const GABLE_FACTOR = 1.1
/** Eaves/overhang correction when treating footprint as floor footprint. */
const EAVES_CORRECTION = 0.9

/** Confidence → half-width of the area band (± fraction). */
const CONFIDENCE_BAND: Record<PaintConfidence, number> = {
  high: 0.12,
  medium: 0.25,
  low: 0.4,
}

/** Rough whole-house floor area (m²) per bedroom — the weakest proxy. */
const FLOOR_AREA_PER_BEDROOM = 45

// ── Floor-area resolution ───────────────────────────────────────────

type ResolvedFloorArea = {
  floor_area_m2: number
  source: FloorAreaSource
  confidence: PaintConfidence
  note: string
} | null

/**
 * PURE — pick the best available floor-area number and its confidence.
 * Priority: manual override → listing building size → footprint×storeys
 * → bedroom estimate. Returns null when nothing usable is available
 * (the caller then routes to inspection).
 */
export function resolveFloorArea(
  facts: PropertyFacts,
  inputs: PaintUserInputs,
): ResolvedFloorArea {
  const storeys = facts.storeys && facts.storeys > 0 ? facts.storeys : 1

  if (
    typeof inputs.manual_floor_area_m2 === 'number' &&
    Number.isFinite(inputs.manual_floor_area_m2) &&
    inputs.manual_floor_area_m2 > 0
  ) {
    return {
      floor_area_m2: roundTo(inputs.manual_floor_area_m2, 1),
      source: 'manual',
      confidence: 'high',
      note: 'Floor area entered by hand — treated as confirmed.',
    }
  }

  if (
    typeof facts.floor_area_m2 === 'number' &&
    Number.isFinite(facts.floor_area_m2) &&
    facts.floor_area_m2 > 0
  ) {
    // A listing building-size is high confidence; a footprint-derived or
    // bed-derived number carries the provider's own (lower) confidence.
    const source = facts.floor_area_source ?? 'listing'
    const confidence: PaintConfidence =
      source === 'listing' || source === 'manual'
        ? 'high'
        : source === 'footprint'
          ? 'medium'
          : 'low'
    return {
      floor_area_m2: roundTo(facts.floor_area_m2, 1),
      source,
      confidence,
      note:
        source === 'listing'
          ? 'Floor area from a property listing. Confirm it predates any renovation.'
          : 'Floor area supplied by the data provider.',
    }
  }

  if (
    typeof facts.footprint_m2 === 'number' &&
    Number.isFinite(facts.footprint_m2) &&
    facts.footprint_m2 > 0
  ) {
    const fa = facts.footprint_m2 * storeys * EAVES_CORRECTION
    return {
      floor_area_m2: roundTo(fa, 1),
      source: 'footprint',
      confidence: 'medium',
      note: `Estimated from building footprint (${facts.footprint_m2.toFixed(0)} m²) × ${storeys} storey${storeys === 1 ? '' : 's'}. Confirm storeys and internal area.`,
    }
  }

  if (typeof facts.bedrooms === 'number' && facts.bedrooms > 0) {
    return {
      floor_area_m2: roundTo(facts.bedrooms * FLOOR_AREA_PER_BEDROOM, 1),
      source: 'beds_estimate',
      confidence: 'low',
      note: `Rough estimate from ${facts.bedrooms} bedroom${facts.bedrooms === 1 ? '' : 's'} only — book a site measure before committing a price.`,
    }
  }

  return null
}

// ── Surface measurement ─────────────────────────────────────────────

/**
 * PURE — derive paintable quantities for the chosen scopes from a
 * resolved floor area. Returns null when no floor area is available.
 */
export function measurePaintableArea(
  facts: PropertyFacts,
  inputs: PaintUserInputs,
): PaintMeasurement | null {
  const resolved = resolveFloorArea(facts, inputs)
  if (!resolved) return null

  const storeys = facts.storeys && facts.storeys > 0 ? facts.storeys : 1
  const ceilingHeightM = CEILING_HEIGHT_M[inputs.ceiling_height]
  const band = CONFIDENCE_BAND[resolved.confidence]
  const floor = resolved.floor_area_m2

  const withBand = (q: number): Omit<PaintSurfaceArea, 'scope' | 'unit'> => ({
    quantity: roundTo(q, 1),
    quantity_low: roundTo(q * (1 - band), 1),
    quantity_high: roundTo(q * (1 + band), 1),
  })

  const notes: string[] = [resolved.note]
  const surfaces: PaintSurfaceArea[] = []
  const scopes = new Set(inputs.scopes)

  if (scopes.has('walls')) {
    const wallArea = floor * WALL_MULTIPLIER[inputs.ceiling_height]
    surfaces.push({ scope: 'walls', unit: 'm2', ...withBand(wallArea) })
    notes.push(
      `Walls ≈ floor area × ${WALL_MULTIPLIER[inputs.ceiling_height]} (${ceilingHeightM} m ceilings, openings deducted).`,
    )
  }

  if (scopes.has('ceilings')) {
    surfaces.push({ scope: 'ceilings', unit: 'm2', ...withBand(floor) })
    notes.push('Ceilings ≈ internal floor area.')
  }

  if (scopes.has('trim')) {
    // Skirting/architrave linear metres ≈ internal perimeter, scaled up a
    // little for door/window architraves and internal partition runs.
    const perimeter = K_SHAPE_INTERIOR * 4 * Math.sqrt(floor)
    const trimLm = perimeter * 1.6
    surfaces.push({ scope: 'trim', unit: 'lm', ...withBand(trimLm) })
    notes.push('Trim (skirting + architraves) ≈ internal perimeter × 1.6.')
  }

  if (scopes.has('exterior')) {
    // Façade ≈ external perimeter × wall height × gable factor.
    // Recover the per-storey footprint to get the external perimeter.
    const footprint =
      facts.footprint_m2 && facts.footprint_m2 > 0
        ? facts.footprint_m2
        : floor / storeys
    const extPerimeter = K_SHAPE_EXTERIOR * 4 * Math.sqrt(footprint)
    // Prefer a real ground-to-eave wall height (Geoscape averageEaveHeight):
    // it already spans every storey, so we do NOT multiply by the storey
    // count again. Fall back to the per-storey band × storeys when unknown.
    const eave =
      typeof facts.eave_height_m === 'number' && facts.eave_height_m > 0
        ? clamp(facts.eave_height_m, 2.1, 15)
        : null
    const wallHeight = eave ?? EXTERIOR_WALL_BAND_M * storeys
    const facade = extPerimeter * wallHeight * GABLE_FACTOR
    surfaces.push({ scope: 'exterior', unit: 'm2', ...withBand(facade) })
    notes.push(
      eave != null
        ? `Exterior façade ≈ external perimeter × ${eave.toFixed(1)} m eave height (Geoscape) × ${GABLE_FACTOR} gable factor.`
        : `Exterior façade ≈ external perimeter × ${EXTERIOR_WALL_BAND_M} m × ${storeys} storey${storeys === 1 ? '' : 's'} × ${GABLE_FACTOR} gable factor.`,
    )
  }

  return {
    floor_area_m2: floor,
    floor_area_low_m2: roundTo(floor * (1 - band), 1),
    floor_area_high_m2: roundTo(floor * (1 + band), 1),
    floor_area_source: resolved.source,
    ceiling_height_m: ceilingHeightM,
    storeys,
    confidence: resolved.confidence,
    surfaces,
    notes,
  }
}

/** PURE — round to N decimal places, predictable. */
export function roundTo(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

/** PURE — clamp n into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

export const __test_only__ = {
  CEILING_HEIGHT_M,
  WALL_MULTIPLIER,
  CONFIDENCE_BAND,
  EAVES_CORRECTION,
  FLOOR_AREA_PER_BEDROOM,
}
