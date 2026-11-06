// The pack's drawing (TKO-18, DEC-037): each roof's planes as outlines in
// millimetres, north up, one slot for each roof, so the DXF and the brief's
// key plan draw the same thing. A plane is drawn from its outline when the
// reading gives one, else as a rectangle from its size, turned to its fall
// when the fall names a compass direction. Plans aren't georeferenced, so the
// slots keep roofs apart rather than placing them on the site.
//
// An edge is drawn on its type's layer only where the takeoff fixes it. The
// takeoff gives each edge a type and a length but no position, so only a
// one-plane roof drawn from its size with a compass fall places any: its low
// side is the eave, its high side the high side, and its two sides take a
// type when both are listed with the same one. Every edge is in the CSV.

import type { RoofPlanTakeoff } from '../schema'
import type { PackPlane, PackStructure } from './privacy'

export type Point = [number, number]
/** A rectangle in millimetres: left, bottom, right, top. */
export type Box = [number, number, number, number]
type EdgeType = RoofPlanTakeoff['structures'][number]['edges'][number]['type']

export type DrawnPlane = {
  id: string
  outline: Point[] | null
  from: 'polygon' | 'size' | null
  centre: Point | null
  /** Downhill on plan, as a unit vector with north up; null when the fall names no direction. */
  fall: Point | null
}
/** An edge the takeoff fixes, and which of the structure's edges it is. */
export type DrawnEdge = { type: EdgeType; from: Point; to: Point; index: number }
export type DrawnStructure = { id: string; label: string; box: Box | null; planes: DrawnPlane[]; edges: DrawnEdge[]; footprint: Point[] | null }
export type PackGeometry = { structures: DrawnStructure[]; extent: Box }

const SLOT_GAP_MM = 3000
const PLANE_GAP_MM = 1000
/** No roof is 100 km long: a larger value is a bad correction, not a drawing. */
const LIMIT_MM = 1e8
const EARTH_MM = 6_378_137_000
const TOLERANCE = 0.05

const CARDINAL: Record<string, Point> = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] }
const LETTERS: Record<string, string[]> = { N: ['north'], S: ['south'], E: ['east'], W: ['west'], NE: ['north', 'east'], NW: ['north', 'west'], SE: ['south', 'east'], SW: ['south', 'west'] }
const WORDS = /\b(north|south)[\s-]?(east|west)\b|\b(north|south|east|west)\b/i
const ABBREVIATION = /\b(NE|NW|SE|SW|N|S|E|W)\b/

/** The direction a plane falls, downhill on plan with north up, from a fall
 *  such as "south, to the street" or "NE"; null when it names none. */
export function compassFall(fall: string | null): Point | null {
  if (!fall) return null
  const word = WORDS.exec(fall)
  const names = word
    ? (word[3] ? [word[3]] : [word[1], word[2]]).map((w) => w.toLowerCase())
    : (LETTERS[ABBREVIATION.exec(fall)?.[1] ?? ''] ?? null)
  if (!names) return null
  const [x, y] = names.map((n) => CARDINAL[n]).reduce((a, b) => [a[0] + b[0], a[1] + b[1]])
  const length = Math.hypot(x, y)
  return [x / length, y / length]
}

const finite = (n: number) => Number.isFinite(n) && Math.abs(n) <= LIMIT_MM
const close = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE * Math.max(Math.abs(a), Math.abs(b))
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]]
const scale = (a: Point, k: number): Point => [a[0] * k, a[1] * k]
const boxOf = (points: Point[]): Box => [
  Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])),
  Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1])),
]
const centroid = (points: Point[]): Point => scale(points.reduce(add, [0, 0]), 1 / points.length)

type Shape = { outline: Point[]; plane?: number; footprint?: true }

/** A rectangle from a plane's size: along the eave across its fall when it has
 *  one, else as the size reads. Its corners run low left, low right, high
 *  right, high left, so its sides are the eave, a side, the high side and a side. */
function rectangle(plane: PackPlane, structure: PackStructure): { outline: Point[]; eave: number; run: number; fall: Point | null } | null {
  const dims = plane.plan_dims_mm
  if (!dims || !dims.every((d) => finite(d) && d > 0)) return null
  const fall = compassFall(plane.fall)
  const low = structure.edges.find((e) => (e.type === 'eave' || e.type === 'box_gutter') && e.length_m !== null)
  const lowMm = low?.length_m != null ? low.length_m * 1000 : null
  const [eave, run] = lowMm !== null && close(lowMm, dims[1]) && !close(lowMm, dims[0]) ? [dims[1], dims[0]] : [dims[0], dims[1]]
  if (!fall) return { outline: [[0, 0], [dims[0], 0], [dims[0], dims[1]], [0, dims[1]]], eave, run, fall: null }
  const across: Point = [-fall[1], fall[0]]
  const lowSide = scale(fall, run / 2)
  const highSide = scale(fall, -run / 2)
  const half = scale(across, eave / 2)
  const back = scale(across, -eave / 2)
  return { outline: [add(lowSide, back), add(lowSide, half), add(highSide, half), add(highSide, back)], eave, run, fall }
}

/** A one-plane roof's edges where its rectangle fixes them. */
function placedEdges(structure: PackStructure, outline: Point[], eave: number, run: number, pitch: number | null): DrawnEdge[] {
  const [lowLeft, lowRight, highRight, highLeft] = outline
  const used = new Set<number>()
  const pick = (types: EdgeType[], lengthMm: number[]) => {
    for (const type of types) {
      const index = structure.edges.findIndex((e, i) =>
        !used.has(i) && e.type === type && e.length_m !== null && lengthMm.some((l) => close(e.length_m! * 1000, l)))
      if (index >= 0) { used.add(index); return index }
    }
    return -1
  }
  const edges: DrawnEdge[] = []
  const eaveAt = pick(['eave', 'box_gutter'], [eave])
  if (eaveAt >= 0) edges.push({ type: structure.edges[eaveAt].type, from: lowLeft, to: lowRight, index: eaveAt })
  const highAt = pick(['high_side', 'apron', 'parapet'], [eave])
  if (highAt >= 0) edges.push({ type: structure.edges[highAt].type, from: highRight, to: highLeft, index: highAt })
  // The sides, on plan or down the slope.
  const runs = pitch !== null && pitch > 0 && pitch < 90 ? [run, run / Math.cos((pitch * Math.PI) / 180)] : [run]
  const sides = structure.edges
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => !used.has(i) && ['barge', 'apron', 'parapet'].includes(e.type) && e.length_m !== null && runs.some((l) => close(e.length_m! * 1000, l)))
  if (sides.length === 2 && sides[0].e.type === sides[1].e.type) {
    edges.push({ type: sides[0].e.type, from: lowRight, to: highRight, index: sides[0].i })
    edges.push({ type: sides[1].e.type, from: highLeft, to: lowLeft, index: sides[1].i })
  }
  return edges
}

/** A roof's aerial footprint in millimetres about its own centre, north up:
 *  an equirectangular projection, true to well under a millimetre a metre at
 *  a house's size. The ring's closing point isn't repeated. */
function footprintOf(structure: PackStructure): Point[] | null {
  const ring = structure.aerial?.polygon?.coordinates[0]
  if (!ring) return null
  const points = ring.filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)
  if (points.length > 1 && points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1]) points.pop()
  if (points.length < 3) return null
  const [lon0, lat0] = centroid(points.map((p) => [p[0], p[1]] as Point))
  const rad = Math.PI / 180
  const k = Math.cos(lat0 * rad)
  return points.map((p) => [EARTH_MM * (p[0] - lon0) * rad * k, EARTH_MM * (p[1] - lat0) * rad])
}

/** Every roof's drawing, each in its own slot: left to right, 3 m apart, on
 *  y = 0. A roof with nothing to draw has no box. */
export function packGeometry(structures: PackStructure[]): PackGeometry {
  let cursor = 0
  const drawn = structures.map((structure): DrawnStructure => {
    // Shapes in groups: the planes' own outlines share the reading's frame;
    // the footprint and each sized plane have their own.
    const groups: Shape[][] = []
    const planes: DrawnPlane[] = structure.planes.map((plane) => ({ id: plane.id, outline: null, from: null, centre: null, fall: compassFall(plane.fall) }))
    const fromOutline: Shape[] = []
    let sized: { index: number; eave: number; run: number } | null = null
    structure.planes.forEach((plane, i) => {
      const polygon = plane.polygon_mm
      if (polygon && polygon.length >= 3 && polygon.every((p) => finite(p[0]) && finite(p[1]))) {
        planes[i].from = 'polygon'
        fromOutline.push({ outline: polygon.map((p) => [p[0], p[1]]), plane: i })
        return
      }
      const rect = rectangle(plane, structure)
      if (!rect) return
      planes[i].from = 'size'
      planes[i].fall = rect.fall
      groups.push([{ outline: rect.outline, plane: i }])
      if (structure.planes.length === 1) sized = { index: i, eave: rect.eave, run: rect.run }
    })
    if (fromOutline.length) groups.unshift(fromOutline)
    const footprint = footprintOf(structure)
    if (footprint) groups.push([{ outline: footprint, footprint: true }])

    // Each group set beside the last, its bottom on y = 0, then the roof
    // moved into its slot.
    const placed: Shape[] = []
    let x = 0
    for (const group of groups) {
      const [x1, y1, x2] = boxOf(group.flatMap((s) => s.outline))
      for (const shape of group) placed.push({ ...shape, outline: shape.outline.map((p) => [p[0] - x1 + x, p[1] - y1]) })
      x += x2 - x1 + PLANE_GAP_MM
    }
    if (!placed.length) return { id: structure.id, label: structure.label, box: null, planes, edges: [], footprint: null }
    const own = boxOf(placed.flatMap((s) => s.outline))
    const shift: Point = [cursor - own[0], -own[1]]
    const move = (points: Point[]) => points.map((p) => add(p, shift))
    let footprintAt: Point[] | null = null
    for (const shape of placed) {
      if (shape.footprint) { footprintAt = move(shape.outline); continue }
      const outline = move(shape.outline)
      planes[shape.plane!].outline = outline
      planes[shape.plane!].centre = centroid(outline)
    }
    const box: Box = [own[0] + shift[0], own[1] + shift[1], own[2] + shift[0], own[3] + shift[1]]
    cursor = box[2] + SLOT_GAP_MM
    const one = sized as { index: number; eave: number; run: number } | null
    const edges = one && planes[one.index].fall
      ? placedEdges(structure, planes[one.index].outline!, one.eave, one.run, structure.planes[one.index].pitch_deg)
      : []
    return { id: structure.id, label: structure.label, box, planes, edges, footprint: footprintAt }
  })
  const boxes = drawn.flatMap((s) => (s.box ? [s.box] : []))
  const extent: Box = boxes.length
    ? [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]
    : [0, 0, 0, 0]
  return { structures: drawn, extent }
}
