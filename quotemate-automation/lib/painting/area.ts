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
import { K_SHAPE_EXTERIOR, K_SHAPE_INTERIOR, clamp, roundTo } from './geometry'
import { measureFromRooms, type RoomMeasurementTotals } from './rooms'

// Re-exported so every existing `from './area'` import keeps working.
export { K_SHAPE_INTERIOR, clamp, roundTo }

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
      source === 'listing' || source === 'manual' || source === 'floor_plan'
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
  const ceilingHeightM = CEILING_HEIGHT_M[inputs.ceiling_height]
  const roomTotals = resolveRoomTotals(inputs, ceilingHeightM)
  // Always resolved: the exterior fallback needs the WHOLE-HOUSE floor area
  // even when the interior is measured room by room (a partial room schedule
  // would otherwise shrink the façade).
  const wholeHouse = resolveFloorArea(facts, inputs)
  const resolved = roomTotals
    ? ({
        floor_area_m2: roomTotals.floor_area_m2,
        source: 'floor_plan',
        confidence: roomTotals.all_dimensioned ? 'high' : 'medium',
        note: `Internal area measured from ${roomTotals.rooms_used.length} rooms on the floor plan.`,
      } satisfies ResolvedFloorArea)
    : wholeHouse
  if (!resolved) return null

  const storeys = facts.storeys && facts.storeys > 0 ? facts.storeys : 1
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
    const wallArea = roomTotals
      ? roomTotals.wall_area_m2
      : floor * WALL_MULTIPLIER[inputs.ceiling_height]
    surfaces.push({ scope: 'walls', unit: 'm2', ...withBand(wallArea) })
    notes.push(
      roomTotals
        ? `Walls measured from ${roomTotals.rooms_used.length} rooms on the floor plan — each room's own perimeter × ${ceilingHeightM} m ceilings, openings deducted.`
        : `Walls ≈ floor area × ${WALL_MULTIPLIER[inputs.ceiling_height]} (${ceilingHeightM} m ceilings, openings deducted).`,
    )
  }

  if (scopes.has('ceilings')) {
    surfaces.push({
      scope: 'ceilings',
      unit: 'm2',
      ...withBand(roomTotals ? roomTotals.ceiling_area_m2 : floor),
    })
    notes.push(
      roomTotals
        ? `Ceilings measured from ${roomTotals.rooms_used.length} rooms on the floor plan.`
        : 'Ceilings ≈ internal floor area.',
    )
  }

  if (scopes.has('trim')) {
    if (roomTotals) {
      // Skirting follows each room's own perimeter — the whole-house
      // heuristic below sees one box and misses every internal partition.
      surfaces.push({ scope: 'trim', unit: 'lm', ...withBand(roomTotals.trim_lm) })
      notes.push(
        `Trim measured from ${roomTotals.rooms_used.length} rooms on the floor plan — skirting around each room, plus a door architrave set per room.`,
      )
    } else {
      // Skirting/architrave linear metres ≈ internal perimeter, scaled up a
      // little for door/window architraves and internal partition runs.
      const perimeter = K_SHAPE_INTERIOR * 4 * Math.sqrt(floor)
      const trimLm = perimeter * 1.6
      surfaces.push({ scope: 'trim', unit: 'lm', ...withBand(trimLm) })
      notes.push('Trim (skirting + architraves) ≈ internal perimeter × 1.6.')
    }
  }

  // Façade ≈ external perimeter × wall height × gable factor, recovered from
  // the per-storey footprint. The fallback uses the WHOLE-HOUSE floor area and
  // never `floor`: on the per-room path `floor` is the room-schedule sum, which
  // may cover only part of the dwelling. With neither a footprint nor a
  // whole-house area there is nothing to derive a façade from — before the room
  // path existed that fact set produced no measurement at all, so inventing one
  // from the interior schedule would be a silent under-quote.
  const exteriorFootprint =
    facts.footprint_m2 && facts.footprint_m2 > 0
      ? facts.footprint_m2
      : wholeHouse != null
        ? wholeHouse.floor_area_m2 / storeys
        : null

  if (scopes.has('exterior') && exteriorFootprint == null) {
    notes.push(
      'The exterior needs an on-site measure — no building outline is available for this address.',
    )
  }

  if (scopes.has('exterior') && exteriorFootprint != null) {
    const footprint = exteriorFootprint
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

  if (!roomTotals && inputs.structure?.building_id && (inputs.rooms?.length ?? 0) > 0) {
    // Customer-visible (customerMeasurementNotes passes it through to
    // /q/paint and the PDF), so it states the fact without the internals.
    notes.push('Measured for the selected building at this address.')
  }

  if (roomTotals && roomTotals.rooms_without_dimensions > 0) {
    const n = roomTotals.rooms_without_dimensions
    notes.push(
      `${n} room${n === 1 ? '' : 's'} had no printed dimensions and ${n === 1 ? 'was' : 'were'} sized from ${n === 1 ? 'its' : 'their'} plan area.`,
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
    basis: roomTotals ? 'rooms' : 'whole_house',
    ...(roomTotals ? { rooms: roomTotals.rooms_used } : {}),
  }
}

/**
 * PURE — the per-room totals, when the room path applies at all.
 *
 * A hand-entered floor area still wins (same priority as resolveFloorArea),
 * and an absent / empty / all-excluded / geometry-free schedule falls
 * through to the whole-house heuristic unchanged.
 */
function resolveRoomTotals(
  inputs: PaintUserInputs,
  ceilingHeightM: number,
): RoomMeasurementTotals | null {
  const manual = inputs.manual_floor_area_m2
  if (typeof manual === 'number' && Number.isFinite(manual) && manual > 0) return null
  // A targeted structure is ONE building at a multi-structure address, but a
  // plan's room list covers the whole property — measuring every room would
  // quote the main house when the granny flat was selected.
  if (inputs.structure?.building_id) return null
  if (!Array.isArray(inputs.rooms) || inputs.rooms.length === 0) return null
  return measureFromRooms(inputs.rooms, { ceilingHeightM })
}

export const __test_only__ = {
  CEILING_HEIGHT_M,
  WALL_MULTIPLIER,
  CONFIDENCE_BAND,
  EAVES_CORRECTION,
  FLOOR_AREA_PER_BEDROOM,
}
