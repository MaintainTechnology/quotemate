// ════════════════════════════════════════════════════════════════════
// Air-conditioning — deterministic indicative layout engine.
//
// Resolved plan rooms (+ per-room loads from sizing.ts) → where the
// ducted unit, supply outlets, return air, split heads and outdoor unit
// sit on the plan, all in page-percent coordinates ready for the SVG
// overlay. PURE GEOMETRY — no LLM, no randomness, no prices. This is the
// engineering artifact; Gemini image-gen never draws it.
// ════════════════════════════════════════════════════════════════════

import { roundTo } from './sizing'
import type {
  AcDuctedLayout,
  AcDuctRun,
  AcPlacedUnit,
  AcPlanDesign,
  AcPlanPoint,
  AcResolvedRoom,
  AcSplitLayout,
  AcZoneGroup,
  CeilingHeight,
  RoomLoad,
} from './types'

/** Ducted loads at/above this usually need 3-phase supply in AU homes. */
export const THREE_PHASE_KW = 12

/** Practical ceiling on indoor heads sharing multi-split outdoor units. */
export const MAX_SPLIT_HEADS = 5

const clampPct = (n: number) => Math.min(100, Math.max(0, roundTo(n, 1)))
const point = (x: number, y: number): AcPlanPoint => ({ x: clampPct(x), y: clampPct(y) })

/** PURE — polygon centroid (shoelace), vertex mean for degenerate shapes. */
export function polygonCentroid(polygon: AcPlanPoint[]): AcPlanPoint {
  if (polygon.length === 0) return { x: 50, y: 50 }
  let twiceArea = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]
    const q = polygon[(i + 1) % polygon.length]
    const cross = p.x * q.y - q.x * p.y
    twiceArea += cross
    cx += (p.x + q.x) * cross
    cy += (p.y + q.y) * cross
  }
  if (Math.abs(twiceArea) < 1e-6) {
    const mx = polygon.reduce((acc, p) => acc + p.x, 0) / polygon.length
    const my = polygon.reduce((acc, p) => acc + p.y, 0) / polygon.length
    return point(mx, my)
  }
  return point(cx / (3 * twiceArea), cy / (3 * twiceArea))
}

type Bbox = { minX: number; maxX: number; minY: number; maxY: number }

function bboxOf(points: AcPlanPoint[]): Bbox {
  if (points.length === 0) return { minX: 0, maxX: 100, minY: 0, maxY: 100 }
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  }
}

/** Place a point just outside the building bbox, on the edge nearest `from`. */
function outsideNearestEdge(from: AcPlanPoint, box: Bbox, offset = 3): AcPlanPoint {
  const dLeft = from.x - box.minX
  const dRight = box.maxX - from.x
  const dTop = from.y - box.minY
  const dBottom = box.maxY - from.y
  const min = Math.min(dLeft, dRight, dTop, dBottom)
  if (min === dLeft) return point(box.minX - offset, from.y)
  if (min === dRight) return point(box.maxX + offset, from.y)
  if (min === dTop) return point(from.x, box.minY - offset)
  return point(from.x, box.maxY + offset)
}

/** Midpoint of the polygon edge whose midpoint sits farthest from the
 *  building centre — a deterministic stand-in for "an external wall". */
function externalWallPoint(polygon: AcPlanPoint[], buildingCentre: AcPlanPoint): AcPlanPoint {
  if (polygon.length < 2) return polygonCentroid(polygon)
  let best: AcPlanPoint = polygon[0]
  let bestDist = -1
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]
    const q = polygon[(i + 1) % polygon.length]
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
    const d = (mid.x - buildingCentre.x) ** 2 + (mid.y - buildingCentre.y) ** 2
    if (d > bestDist) {
      bestDist = d
      best = mid
    }
  }
  return point(best.x, best.y)
}

function buildZones(rooms: AcResolvedRoom[]): AcZoneGroup[] {
  const living = rooms.filter((r) => r.load_type === 'living').map((r) => r.name)
  const beds = rooms.filter((r) => r.load_type === 'bedroom').map((r) => r.name)
  const zones: AcZoneGroup[] = []
  if (living.length > 0) zones.push({ name: 'Living zone', rooms: living })
  if (beds.length > 4) {
    const half = Math.ceil(beds.length / 2)
    zones.push({ name: 'Sleeping zone A', rooms: beds.slice(0, half) })
    zones.push({ name: 'Sleeping zone B', rooms: beds.slice(half) })
  } else if (beds.length > 0) {
    zones.push({ name: 'Sleeping zone', rooms: beds })
  }
  return zones
}

export type AcDesignArgs = {
  /** 1-based plan page the polygons belong to. */
  page: number
  /** Every resolved room — unconditioned ones still steer the geometry
   *  (halls host the return air; the bbox includes garages). */
  rooms: AcResolvedRoom[]
  /** Per-room loads from sizeAircon (plan path: carries room names). */
  loads: RoomLoad[]
  /** Central-unit size (connected × diversity) — drives the 3-phase gate. */
  ducted_kw: number
  ceiling_height: CeilingHeight
  storeys: number
}

/** PURE — deterministic indicative ducted + split layouts over the plan. */
export function designAcLayout(args: AcDesignArgs): AcPlanDesign {
  const conditioned = args.rooms.filter((r) => r.load_type !== null)
  const kwByName = new Map(args.loads.map((l) => [l.name ?? '', l.kw]))
  const buildingBox = bboxOf(args.rooms.flatMap((r) => r.polygon))
  const buildingCentre = point(
    (buildingBox.minX + buildingBox.maxX) / 2,
    (buildingBox.minY + buildingBox.maxY) / 2,
  )

  const sharedWarnings: string[] = []
  if (conditioned.length === 0) {
    sharedWarnings.push('No conditioned rooms were found on the plan — nothing to lay out.')
  }

  // ── Ducted ───────────────────────────────────────────────────────
  const outlets: AcPlacedUnit[] = conditioned.map((r) => ({
    room: r.name,
    at: polygonCentroid(r.polygon),
    kw: kwByName.get(r.name) ?? 0,
  }))

  // Indoor unit: kW-weighted centroid of the outlets — sits the trunk
  // duct over the biggest loads. Falls back to the building centre.
  const totalKw = outlets.reduce((acc, o) => acc + o.kw, 0)
  const unit =
    outlets.length === 0
      ? buildingCentre
      : totalKw > 0
        ? point(
            outlets.reduce((acc, o) => acc + o.at.x * o.kw, 0) / totalKw,
            outlets.reduce((acc, o) => acc + o.at.y * o.kw, 0) / totalKw,
          )
        : polygonCentroid(outlets.map((o) => o.at))

  // Return air: the largest hallway when the plan has one (standard AU
  // practice), otherwise beside the unit.
  const halls = args.rooms
    .filter((r) => r.room_type === 'hall')
    .sort((a, b) => b.area_m2 - a.area_m2)
  const returnAir = halls.length > 0 ? polygonCentroid(halls[0].polygon) : point(unit.x, unit.y + 4)

  const runs: AcDuctRun[] = outlets.map((o) => ({ room: o.room, from: unit, to: o.at }))

  const ductedWarnings = [...sharedWarnings]
  if (args.ceiling_height === 'raked') {
    ductedWarnings.push(
      'Raked/cathedral ceilings rarely leave a usable roof cavity — ducted needs a cavity (≥500 mm) confirmed on site.',
    )
  }
  if (args.ducted_kw >= THREE_PHASE_KW) {
    ductedWarnings.push(
      `Central unit ≈ ${roundTo(args.ducted_kw, 1)} kW — at ${THREE_PHASE_KW} kW+ most homes need 3-phase power; confirm the supply on site.`,
    )
  }
  if (args.storeys >= 3) {
    ductedWarnings.push('3+ levels — duct risers and roof-space access must be checked on site.')
  }

  const ducted: AcDuctedLayout = {
    unit,
    return_air: returnAir,
    outdoor: outsideNearestEdge(unit, buildingBox),
    outlets,
    runs,
    zones: buildZones(conditioned),
    warnings: ductedWarnings,
  }

  // ── Split ────────────────────────────────────────────────────────
  const heads: AcPlacedUnit[] = conditioned.map((r) => ({
    room: r.name,
    at: externalWallPoint(r.polygon, buildingCentre),
    kw: kwByName.get(r.name) ?? 0,
  }))
  const headsCentre =
    heads.length > 0
      ? point(
          heads.reduce((acc, h) => acc + h.at.x, 0) / heads.length,
          heads.reduce((acc, h) => acc + h.at.y, 0) / heads.length,
        )
      : buildingCentre

  const splitWarnings = [...sharedWarnings]
  if (heads.length > MAX_SPLIT_HEADS) {
    splitWarnings.push(
      `${heads.length} indoor heads — beyond ${MAX_SPLIT_HEADS} a multi-split gets impractical; ducted is usually the better fit.`,
    )
  }

  const split: AcSplitLayout = {
    heads,
    outdoor: outsideNearestEdge(headsCentre, buildingBox),
    warnings: splitWarnings,
  }

  return { page: args.page, ducted, split }
}
