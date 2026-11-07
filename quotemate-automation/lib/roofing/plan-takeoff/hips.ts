// A hip roof measured from its drawn hips and ridges (TKO-30's second half,
// DEC-045). A roof plan can dimension nothing and still draw a hip roof's
// lines, as Whittaker's A104 does. Every face of a hip roof has one pitch, so
// its hips, valleys and ridges are the straight skeleton of its eave outline:
// a hip runs at 45° in from each corner, a valley from each inside corner,
// and ridges join their inner ends. So the lines' outer ends are the outline's
// corners, each face is one eave and the lines between its two corners, and
// the sheet's calibrated factor sizes them. The model says which roof is
// hipped; the drawing measures it.

import type { Segment } from './calibrate'
import type { MeasuredSheet } from './outline'
import type { RoofPlanTakeoff } from './schema'

type P = [number, number]
type Takeoff = RoofPlanTakeoff
type Structure = Takeoff['structures'][number]
type Plane = Structure['planes'][number]
type Edge = Structure['edges'][number]
type Fall = 'north' | 'east' | 'south' | 'west'

export type HipLine = { type: 'hip' | 'valley' | 'ridge' | 'eave'; from: P; to: P }
/** A face in printed points, from its eave's two corners round to the lines above it. */
export type HipFace = { polygon: P[]; fall: Fall }
export type HipRoof = { outline: P[]; faces: HipFace[]; edges: HipLine[] }

const ANGLE_DEG = 1 // a hip within a degree of 45°
const MIN_LINE_MM = 1000 // a roof's hips are a metre or more on plan; a symbol's strokes aren't
const BAND_PT = 8 // a line's band strokes, drawn either side of it, lie this close
const MEET_PT = 1.5 // ends this close meet
const AXIS_PT = 0.25 // a ridge or eave this far out of square is still square
const MAX_LEAVES = 40 // more corners than a house roof has

const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1])
const signedArea = (polygon: P[]) => polygon.reduce((sum, [x, y], i) => {
  const [nx, ny] = polygon[(i + 1) % polygon.length]
  return sum + x * ny - nx * y
}, 0) / 2
const centroid = (polygon: P[]): P => [polygon.reduce((s, p) => s + p[0], 0) / polygon.length, polygon.reduce((s, p) => s + p[1], 0) / polygon.length]

/** The 45° lines a sheet draws a metre or more long, each as one stroke: a
 *  line drawn as a band of strokes is its middle one, and a band with no
 *  middle stroke isn't a line. */
function diagonals(segments: Segment[], factor: number): Array<[P, P]> {
  const min = MIN_LINE_MM / factor
  type Stroke = { k: 45 | 135; off: number; from: number; to: number; ends: [P, P] }
  const strokes: Stroke[] = []
  for (const [x1, y1, x2, y2] of segments) {
    if (Math.hypot(x2 - x1, y2 - y1) < min) continue
    const deg = (((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI) + 180) % 180
    const k = Math.abs(deg - 45) <= ANGLE_DEG ? 45 : Math.abs(deg - 135) <= ANGLE_DEG ? 135 : null
    if (!k) continue
    const [ux, uy] = k === 45 ? [Math.SQRT1_2, Math.SQRT1_2] : [Math.SQRT1_2, -Math.SQRT1_2]
    const [t1, t2] = [x1 * ux + y1 * uy, x2 * ux + y2 * uy]
    strokes.push({ k, off: ((y1 + y2) / 2) * ux - ((x1 + x2) / 2) * uy, from: Math.min(t1, t2), to: Math.max(t1, t2), ends: [[x1, y1], [x2, y2]] })
  }
  const overlap = (a: Stroke, b: Stroke) => Math.min(a.to, b.to) - Math.max(a.from, b.from) > 0
  const bands: Stroke[][] = []
  for (const s of strokes.sort((a, b) => a.off - b.off)) {
    const band = bands.find((b) => b[0].k === s.k && s.off - b[0].off <= BAND_PT && b.some((o) => overlap(o, s)))
    if (band) band.push(s)
    else bands.push([s])
  }
  return bands.flatMap((band) => {
    const middle = (band[0].off + band.at(-1)!.off) / 2
    const centre = band.reduce((a, b) => (Math.abs(b.off - middle) < Math.abs(a.off - middle) ? b : a))
    return Math.abs(centre.off - middle) <= MEET_PT / 3 ? [centre.ends] : []
  })
}

/** Points within MEET_PT of each other as one, by index. */
function joiner() {
  const points: P[] = []
  return {
    points,
    at(p: P): number {
      const i = points.findIndex((q) => dist(p, q) <= MEET_PT)
      if (i >= 0) return i
      points.push(p)
      return points.length - 1
    },
  }
}

/** Each hip roof a sheet draws: its outline, one face per eave and its lines,
 *  all in printed points. A roof whose lines don't close into one, a gable's
 *  ridge running to its barge, or a roof drawn off square is passed over.
 *  ponytail: a ridge drawn as one stroke through a T-junction breaks its roof;
 *  split ridges at the nodes on them if a plan draws one. */
export function hipRoofs(segments: Segment[], factor: number): HipRoof[] {
  const lines = diagonals(segments, factor)
  // Nodes: where two or more lines' ends meet, which a ridge runs between;
  // an eave runs between corners, where one line ends.
  const ends = joiner()
  const count = new Map<number, number>()
  for (const end of lines.flat()) count.set(ends.at(end), (count.get(ends.at(end)) ?? 0) + 1)
  const nodes = ends.points.filter((_, i) => (count.get(i) ?? 0) >= 2)
  const atNode = (p: P) => nodes.some((n) => dist(n, p) <= MEET_PT)
  const ridges: Array<[P, P]> = nodes.length < 2 ? [] : segments.flatMap(([x1, y1, x2, y2]): Array<[P, P]> =>
    (Math.abs(x1 - x2) <= AXIS_PT || Math.abs(y1 - y2) <= AXIS_PT) && Math.hypot(x2 - x1, y2 - y1) > MEET_PT && atNode([x1, y1]) && atNode([x2, y2])
      ? [[[x1, y1], [x2, y2]]] : [])

  const v = joiner()
  const edges = new Map<string, { u: number; w: number; ridge: boolean }>()
  for (const [list, ridge] of [[lines, false], [ridges, true]] as const) {
    for (const [a, b] of list) {
      const [u, w] = [v.at(a), v.at(b)]
      if (u !== w) edges.set(u < w ? `${u}-${w}` : `${w}-${u}`, { u, w, ridge })
    }
  }
  const adjacent: number[][] = v.points.map(() => [])
  for (const { u, w } of edges.values()) {
    adjacent[u].push(w)
    adjacent[w].push(u)
  }
  const angle = (from: number, to: number) => Math.atan2(v.points[to][1] - v.points[from][1], v.points[to][0] - v.points[from][0])
  adjacent.forEach((around, i) => around.sort((a, b) => angle(i, a) - angle(i, b)))
  const edgeOf = (a: number, b: number) => edges.get(a < b ? `${a}-${b}` : `${b}-${a}`)!

  const roofs: HipRoof[] = []
  const seen = new Set<number>()
  for (let start = 0; start < v.points.length; start++) {
    if (seen.has(start) || !adjacent[start].length) continue
    const part: number[] = []
    for (const stack = [start]; stack.length;) {
      const at = stack.pop()!
      if (seen.has(at)) continue
      seen.add(at)
      part.push(at)
      stack.push(...adjacent[at])
    }
    const roof = closeRoof(part, adjacent, v.points, edgeOf, segments)
    if (roof) roofs.push(roof)
  }
  return roofs
}

/** One drawn skeleton as a roof, or null when it doesn't close into one. */
function closeRoof(part: number[], adjacent: number[][], at: P[], edgeOf: (a: number, b: number) => { ridge: boolean }, segments: Segment[]): HipRoof | null {
  const edgeCount = part.reduce((n, i) => n + adjacent[i].length, 0) / 2
  const leaves = part.filter((i) => adjacent[i].length === 1)
  // A tree of lines with an even number of corners. A ridge runs between
  // nodes, so every corner is a hip's or a valley's.
  if (edgeCount !== part.length - 1 || leaves.length < 4 || leaves.length % 2 || leaves.length > MAX_LEAVES) return null

  // The corners in order round the roof: walk round the tree, each line out
  // and back, turning the same way at each node.
  const order = [leaves[0]]
  let [prev, cur] = [leaves[0], adjacent[leaves[0]][0]]
  for (let steps = 0; cur !== leaves[0] && steps <= 4 * part.length; steps++) {
    const around = adjacent[cur]
    if (around.length === 1) {
      order.push(cur)
      ;[prev, cur] = [cur, prev]
    } else {
      ;[prev, cur] = [cur, around[(around.indexOf(prev) + 1) % around.length]]
    }
  }
  if (cur !== leaves[0] || order.length !== leaves.length) return null

  // Eaves run square, across the sheet then along it in turn, so each pair of
  // corners shares a y or an x. A corner whose hip a roof drawn over it cuts
  // short shares neither: it is where its hip meets the eaves through the
  // corners beside it, so it must lie on its hip's line, beyond its drawn end,
  // and that end on the edge of what's drawn over it. A line that just stops
  // is a skeleton missing its next lines, not one hidden.
  const crossed = (p: P, q: P) => segments.some(([x1, y1, x2, y2]) => {
    const length = Math.hypot(x2 - x1, y2 - y1)
    if (length < 4 * MEET_PT) return false
    const [ux, uy] = [(x2 - x1) / length, (y2 - y1) / length]
    const t = (p[0] - x1) * ux + (p[1] - y1) * uy
    const [hx, hy] = [(p[0] - q[0]) / dist(p, q), (p[1] - q[1]) / dist(p, q)]
    return t >= 2 * MEET_PT && t <= length - 2 * MEET_PT && Math.abs((p[0] - x1) * uy - (p[1] - y1) * ux) <= MEET_PT && Math.abs(ux * hy - uy * hx) > 0.5
  })
  const n = order.length
  const wrap = (i: number) => ((i % n) + n) % n
  const end = (i: number) => at[order[wrap(i)]]
  const agrees = (i: number, across: boolean) => Math.abs(end(i)[across ? 1 : 0] - end(i + 1)[across ? 1 : 0]) <= MEET_PT
  const fits = (across: boolean) => order.filter((_, i) => agrees(i, (i % 2 === 0) === across)).length
  if (fits(true) === fits(false)) return null
  const firstAcross = fits(true) > fits(false)
  const across = (i: number) => (wrap(i) % 2 === 0) === firstAcross // eave i, from corner i to i + 1
  const trusted = (i: number) => agrees(i - 1, across(i - 1)) || agrees(i, across(i))
  const level: number[] = []
  for (let i = 0; i < n; i++) {
    const axis = across(i) ? 1 : 0
    const from = [i, i + 1].filter(trusted).map((j) => end(j)[axis])
    if (!from.length) return null
    level.push(from.reduce((a, b) => a + b, 0) / from.length)
  }
  let corners: P[] = order.map((_, i) => (across(i) ? [level[wrap(i - 1)], level[i]] : [level[i], level[wrap(i - 1)]]))
  for (let i = 0; i < n; i++) {
    const [p, q, c] = [end(i), at[adjacent[order[i]][0]], corners[i]]
    const length = dist(p, q)
    const [ux, uy] = [(p[0] - q[0]) / length, (p[1] - q[1]) / length]
    if (Math.abs((c[0] - q[0]) * uy - (c[1] - q[1]) * ux) > MEET_PT) return null
    if ((c[0] - q[0]) * ux + (c[1] - q[1]) * uy < length - MEET_PT) return null
    if (dist(c, p) > MEET_PT && !crossed(p, q)) return null
    if (dist(c, corners[wrap(i + 1)]) <= MEET_PT) return null
  }

  // Clockwise on the sheet from its top left corner, as the faces go.
  let leaf = [...order]
  if (signedArea(corners) < 0) {
    corners = [corners[0], ...corners.slice(1).reverse()]
    leaf = [leaf[0], ...leaf.slice(1).reverse()]
  }
  const top = corners.reduce((best, c, i) => (c[1] < corners[best][1] - MEET_PT || (Math.abs(c[1] - corners[best][1]) <= MEET_PT && c[0] < corners[best][0]) ? i : best), 0)
  corners = [...corners.slice(top), ...corners.slice(0, top)]
  leaf = [...leaf.slice(top), ...leaf.slice(0, top)]
  const position = (i: number) => (leaf.includes(i) ? corners[leaf.indexOf(i)] : at[i])

  // Each face: its eave, then the tree's path back between its corners.
  const pathBetween = (from: number, to: number): number[] => {
    const parent = new Map<number, number>([[from, from]])
    for (const queue = [from]; queue.length;) {
      const here = queue.shift()!
      for (const next of adjacent[here]) {
        if (parent.has(next)) continue
        parent.set(next, here)
        queue.push(next)
      }
    }
    const path = [to]
    while (path.at(-1) !== from) path.push(parent.get(path.at(-1)!)!)
    return path.reverse()
  }
  const faces = corners.map((a, i) => {
    const b = corners[wrap(i + 1)]
    const ids = [leaf[i], ...pathBetween(leaf[wrap(i + 1)], leaf[i]).slice(0, -1)]
    const polygon = ids.map(position)
    const [cx, cy] = centroid(polygon)
    const fall: Fall = a[1] === b[1] ? (cy > a[1] ? 'north' : 'south') : (cx > a[0] ? 'west' : 'east')
    return { ids, polygon, fall }
  })
  const total = faces.reduce((sum, f) => sum + signedArea(f.polygon), 0)
  if (Math.abs(total / signedArea(corners) - 1) > 0.005 || faces.some((f) => signedArea(f.polygon) <= 0)) return null

  // A line is a hip where the faces either side fall away from it, a valley
  // where they fall towards it; a square one between nodes is a ridge.
  const DOWN: Record<Fall, P> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }
  const lines: HipLine[] = corners.map((c, i) => ({ type: 'eave' as const, from: c, to: corners[wrap(i + 1)] }))
  for (const u of part) {
    for (const w of adjacent[u]) {
      if (w < u) continue
      const [from, to] = [position(u), position(w)]
      if (edgeOf(u, w).ridge) {
        lines.push({ type: 'ridge', from, to })
        continue
      }
      const face = faces.find((f) => f.ids.some((id, j) => {
        const next = f.ids[(j + 1) % f.ids.length]
        return (id === u && next === w) || (id === w && next === u)
      }))
      if (!face) return null
      const [cx, cy] = centroid(face.polygon)
      const [dx, dy] = [to[0] - from[0], to[1] - from[1]]
      const inward: P = (cx - from[0]) * dy - (cy - from[1]) * dx > 0 ? [dy, -dx] : [-dy, dx]
      const down = DOWN[face.fall]
      lines.push({ type: inward[0] * down[0] + inward[1] * down[1] > 0 ? 'hip' : 'valley', from, to })
    }
  }
  return { outline: corners, faces: faces.map(({ polygon, fall }) => ({ polygon, fall })), edges: lines }
}

const round = (n: number, places = 0) => Math.round(n * 10 ** places) / 10 ** places || 0
const MEASURED = new Set<Edge['type']>(['hip', 'valley', 'ridge', 'eave'])

/** The one value every plane shares, else null. */
function shared<K extends keyof Plane>(planes: Plane[], key: K): Plane[K] | null {
  const values = new Set(planes.map((p) => JSON.stringify(p[key])))
  return values.size === 1 ? planes[0][key] : null
}

/** Gives the reading's hipped roof its drawn faces and lines: the one roof of
 *  several planes the reading couldn't size, on the one hip roof drawn on the
 *  plan sheets its planes cite. Its planes become one per face, at the pitch
 *  they shared; its hips and valleys are measured along the roof at that
 *  pitch (DEC-039), so without one they stay unknown. A roof the reading sized
 *  stays as read, and so does everything where the match isn't one to one.
 *  ponytail: one hip roof a job; match several by where the reading points. */
export function measureHipRoofs(takeoff: Takeoff, sheets: MeasuredSheet[]): { takeoff: Takeoff; hipped: number } {
  const unsized = (p: Plane) => p.plan_area_m2 === null && !p.plan_dims_mm && !p.polygon_mm
  const candidates = takeoff.structures.filter((s) => s.planes.length > 1 && s.planes.every(unsized))
  if (candidates.length !== 1) return { takeoff, hipped: 0 }
  const [structure] = candidates
  const cited = sheets.filter((sheet) => structure.planes.some((p) => p.evidence.some((e) => e.file === sheet.file && e.page === sheet.page)))
  const found = cited.flatMap((sheet) => hipRoofs(sheet.segments, sheet.factor).map((roof) => ({ roof, sheet })))
  if (found.length !== 1) return { takeoff, hipped: 0 }
  const [{ roof, sheet }] = found

  const f = sheet.factor
  const pitch = shared(structure.planes, 'pitch_deg')
  const slope = pitch === null ? null : Math.sqrt(1 + Math.tan((pitch * Math.PI) / 180) ** 2 / 2)
  const [left, bottom] = [Math.min(...roof.outline.map((p) => p[0])), Math.max(...roof.outline.map((p) => p[1]))]
  // The planes' citations once each, leaving room for the measurement's (the schema holds 50).
  const evidence = [...new Map(structure.planes.flatMap((p) => p.evidence).map((e) => [JSON.stringify(e), e])).values()].slice(0, 49)
  const planes = roof.faces.map((face, i): Plane => {
    const area = round((Math.abs(signedArea(face.polygon)) * f * f) / 1e6, 2)
    const xs = face.polygon.map((p) => p[0])
    const ys = face.polygon.map((p) => p[1])
    return {
      id: `${structure.id}-P${i + 1}`,
      plan_dims_mm: null,
      polygon_mm: face.polygon.map(([x, y]) => [round((x - left) * f), round((bottom - y) * f)]),
      plan_area_m2: area,
      pitch_deg: pitch,
      pitch_source: shared(structure.planes, 'pitch_source'),
      fall: face.fall,
      profile: shared(structure.planes, 'profile'),
      finish_tag: shared(structure.planes, 'finish_tag'),
      sloped_area_m2: pitch === null ? null : round(area / Math.cos((pitch * Math.PI) / 180), 2),
      confidence: 'medium',
      evidence: [...evidence, {
        file: sheet.file,
        page: sheet.page,
        text: `Hip roof: drawn hips and ridges, face ${i + 1} of ${roof.faces.length}, ${area} m² on plan`,
        bbox: [round(Math.min(...xs), 1), round(Math.min(...ys), 1), round(Math.max(...xs), 1), round(Math.max(...ys), 1)],
      }],
    }
  })
  const edges: Edge[] = roof.edges.map((line) => {
    const plan = (dist(line.from, line.to) * f) / 1000
    const along = line.type === 'hip' || line.type === 'valley' ? (slope === null ? null : plan * slope) : plan
    return { type: line.type, length_m: along === null ? null : round(along, 3), source: 'measured', confidence: 'medium' }
  })
  const measured: Structure = { ...structure, planes, edges: [...edges, ...structure.edges.filter((e) => !MEASURED.has(e.type))] }
  return { takeoff: { ...takeoff, structures: takeoff.structures.map((s) => (s === structure ? measured : s)) }, hipped: planes.length }
}
