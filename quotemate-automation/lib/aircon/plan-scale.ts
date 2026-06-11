// ════════════════════════════════════════════════════════════════════
// Air-conditioning — floor-plan scale resolution.
//
// Turns extracted rooms (polygons + whatever dimension text the plan
// printed) into rooms with FINAL areas, by priority:
//   1. printed dimension strings ("3.6 x 4.2", "3600 × 4200") — exact
//   2. a known total (stated on the plan / entered by the tradie /
//      Google Solar footprint) apportioned by relative polygon area
//   3. a m²-per-polygon-area scale inferred from the dimensioned rooms
//
// Relative polygon areas in page-percent space are distorted by the page
// aspect ratio, but every room on the page is distorted by the SAME
// factor, so ratios between rooms hold — which is all apportionment and
// scale inference need. PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import { LOAD_TYPE_BY_ROOM } from './plan-extract'
import { roundTo } from './sizing'
import type { AcExtractedRoom, AcPlanPoint, AcResolvedRoom } from './types'

/** Per-room sanity bounds — outside these a "room" is a misread. */
const ROOM_AREA_BOUNDS = { min: 1, max: 120 }

/** Footprint sanity: plan total vs satellite total may differ this much
 *  before we warn (plans include garages; footprints include eaves). */
const FOOTPRINT_TOLERANCE = 0.4

/** PURE — parse a printed dimension string into m².
 *  Handles "3.6 x 4.2", "3600 × 4200", "3.6m x 4.2m", "3,600 x 4,200".
 *  Values ≥ 100 are read as millimetres. Returns null when unparseable. */
export function parseDimensionText(text: string | undefined): number | null {
  if (!text) return null
  const cleaned = text.replace(/,/g, '').toLowerCase()
  const m = cleaned.match(/(\d+(?:\.\d+)?)\s*m?m?\s*[x×]\s*(\d+(?:\.\d+)?)/)
  if (!m) return null
  let a = Number(m[1])
  let b = Number(m[2])
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null
  if (a >= 100) a /= 1000
  if (b >= 100) b /= 1000
  const area = a * b
  if (area < ROOM_AREA_BOUNDS.min || area > ROOM_AREA_BOUNDS.max * 2) return null
  return roundTo(area, 2)
}

/** PURE — shoelace area of a polygon in page-percent² units. Only ratios
 *  between polygons on the same page are meaningful. */
export function polygonAreaPct(polygon: AcPlanPoint[]): number {
  if (polygon.length < 3) return 0
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]
    const q = polygon[(i + 1) % polygon.length]
    sum += p.x * q.y - q.x * p.y
  }
  return Math.abs(sum) / 2
}

export type ResolveAreasInput = {
  rooms: AcExtractedRoom[]
  /** Total internal area printed on the plan, when stated. */
  statedTotalM2?: number | null
  /** Floor area the tradie entered by hand, when given. */
  enteredTotalM2?: number | null
  /** Google Solar footprint-derived floor area, when available. */
  solarFloorAreaM2?: number | null
}

export type ResolveAreasResult = {
  rooms: AcResolvedRoom[]
  /** True when areas rest on printed dimensions or a stated/entered total. */
  dimensioned: boolean
  total_area_m2: number
  notes: string[]
  warnings: string[]
}

/** PURE — resolve a final area for every extracted room. */
export function resolveRoomAreas(input: ResolveAreasInput): ResolveAreasResult {
  const notes: string[] = []
  const warnings: string[] = []

  const usable = input.rooms.filter((r) => polygonAreaPct(r.polygon) > 0)
  if (usable.length < input.rooms.length) {
    warnings.push(
      `${input.rooms.length - usable.length} room(s) had a degenerate outline and were dropped.`,
    )
  }

  type Working = {
    room: AcExtractedRoom
    pctArea: number
    dimAreaM2: number | null
  }
  const working: Working[] = usable.map((room) => {
    const fromText = parseDimensionText(room.dimensions_text)
    const printed =
      typeof room.area_m2 === 'number' &&
      room.area_m2 >= ROOM_AREA_BOUNDS.min &&
      room.area_m2 <= ROOM_AREA_BOUNDS.max
        ? room.area_m2
        : null
    return {
      room,
      pctArea: polygonAreaPct(room.polygon),
      // The parsed dimension string beats the model's own arithmetic.
      dimAreaM2: fromText ?? printed,
    }
  })

  const dimensionedRooms = working.filter((w) => w.dimAreaM2 !== null)
  const undimensioned = working.filter((w) => w.dimAreaM2 === null)
  const dimensionedTotal = dimensionedRooms.reduce((acc, w) => acc + (w.dimAreaM2 as number), 0)

  // The best available whole-plan total, in trust order.
  const knownTotal =
    input.statedTotalM2 && input.statedTotalM2 > 0
      ? { value: input.statedTotalM2, label: 'total stated on the plan' }
      : input.enteredTotalM2 && input.enteredTotalM2 > 0
        ? { value: input.enteredTotalM2, label: 'floor area entered by hand' }
        : null

  const resolve = (w: Working): AcResolvedRoom => ({
    name: w.room.name,
    room_type: w.room.room_type,
    load_type: LOAD_TYPE_BY_ROOM[w.room.room_type] ?? null,
    polygon: w.room.polygon,
    area_m2: 0,
    area_source: 'dimensions',
  })

  const resolved: AcResolvedRoom[] = []

  for (const w of dimensionedRooms) {
    const r = resolve(w)
    r.area_m2 = roundTo(w.dimAreaM2 as number, 1)
    r.area_source = 'dimensions'
    resolved.push(r)
  }
  if (dimensionedRooms.length > 0) {
    notes.push(
      `${dimensionedRooms.length} of ${working.length} rooms sized from printed dimensions (${roundTo(dimensionedTotal, 1)} m2).`,
    )
  }

  if (undimensioned.length > 0) {
    const undimPct = undimensioned.reduce((acc, w) => acc + w.pctArea, 0)
    if (knownTotal && knownTotal.value > dimensionedTotal && undimPct > 0) {
      // Apportion the remaining budget by relative polygon area.
      const remaining = knownTotal.value - dimensionedTotal
      for (const w of undimensioned) {
        const r = resolve(w)
        r.area_m2 = roundTo((w.pctArea / undimPct) * remaining, 1)
        r.area_source = 'stated_total_apportioned'
        resolved.push(r)
      }
      notes.push(
        `${undimensioned.length} room(s) without printed dimensions apportioned from the ${knownTotal.label} (${roundTo(remaining, 1)} m2 remaining).`,
      )
    } else if (dimensionedRooms.length > 0) {
      // Infer m² per polygon-area unit from the dimensioned rooms.
      const dimPct = dimensionedRooms.reduce((acc, w) => acc + w.pctArea, 0)
      const scale = dimPct > 0 ? dimensionedTotal / dimPct : 0
      for (const w of undimensioned) {
        const r = resolve(w)
        r.area_m2 = roundTo(w.pctArea * scale, 1)
        r.area_source = 'scale_inferred'
        resolved.push(r)
      }
      notes.push(
        `${undimensioned.length} room(s) without printed dimensions sized from the plan scale implied by the dimensioned rooms.`,
      )
      if (scale === 0) {
        warnings.push('Plan scale could not be inferred — undimensioned rooms got zero area.')
      }
    } else if (knownTotal && undimPct > 0) {
      // No dimensions anywhere — split the known total by polygon area.
      for (const w of undimensioned) {
        const r = resolve(w)
        r.area_m2 = roundTo((w.pctArea / undimPct) * knownTotal.value, 1)
        r.area_source = 'stated_total_apportioned'
        resolved.push(r)
      }
      notes.push(
        `No printed dimensions — all rooms apportioned from the ${knownTotal.label} (${roundTo(knownTotal.value, 1)} m2).`,
      )
    } else if (input.solarFloorAreaM2 && input.solarFloorAreaM2 > 0 && undimPct > 0) {
      // Last resort: satellite footprint as the budget.
      for (const w of undimensioned) {
        const r = resolve(w)
        r.area_m2 = roundTo((w.pctArea / undimPct) * input.solarFloorAreaM2, 1)
        r.area_source = 'stated_total_apportioned'
        resolved.push(r)
      }
      notes.push(
        `No printed dimensions or stated total — rooms apportioned from the Google Solar footprint floor area (${roundTo(input.solarFloorAreaM2, 1)} m2).`,
      )
      warnings.push(
        'Room areas rest on the satellite footprint only — confirm dimensions on site.',
      )
    } else {
      warnings.push(
        `${undimensioned.length} room(s) could not be sized — the plan has no dimensions, stated total or satellite footprint to scale from.`,
      )
    }
  }

  // Clamp implausible per-room results rather than letting one misread
  // polygon swallow the whole load.
  for (const r of resolved) {
    if (r.area_m2 > ROOM_AREA_BOUNDS.max) {
      warnings.push(
        `${r.name}: resolved area ${r.area_m2} m2 exceeds the plausible single-room bound — capped at ${ROOM_AREA_BOUNDS.max} m2.`,
      )
      r.area_m2 = ROOM_AREA_BOUNDS.max
    }
  }

  const total = roundTo(
    resolved.reduce((acc, r) => acc + r.area_m2, 0),
    1,
  )

  // Sanity-check the resolved total against the satellite footprint.
  if (input.solarFloorAreaM2 && input.solarFloorAreaM2 > 0 && total > 0) {
    const ratio = total / input.solarFloorAreaM2
    if (ratio < 1 - FOOTPRINT_TOLERANCE || ratio > 1 + FOOTPRINT_TOLERANCE) {
      warnings.push(
        `Plan total (${total} m2) differs from the satellite floor-area estimate (${roundTo(input.solarFloorAreaM2, 1)} m2) by more than ${Math.round(FOOTPRINT_TOLERANCE * 100)}% — confirm which is right on site.`,
      )
    } else {
      notes.push(
        `Plan total (${total} m2) agrees with the satellite floor-area estimate (${roundTo(input.solarFloorAreaM2, 1)} m2).`,
      )
    }
  }

  const dimensioned =
    working.length > 0 &&
    (dimensionedRooms.length >= Math.ceil(working.length / 2) || knownTotal !== null)

  return { rooms: resolved, dimensioned, total_area_m2: total, notes, warnings }
}
