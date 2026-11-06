// Scales the roofs the drawings don't dimension from their drawn outlines
// (TKO-29, DEC-020). The reading cites a roof tag, such as RF:03, for a plane
// it couldn't size. The tag sits inside the roof's outline on the plan, so the
// smallest rectangle of drawn edges around it, at the sheet's calibrated
// scale, is that roof. The model only points; the drawing measures.

import type { Segment } from './calibrate'
import type { PageText, TextRun } from './classify'
import { compassFall } from './pack/geometry'
import type { RoofPlanTakeoff } from './schema'

/** A rectangle in printed points: left, top, right, bottom. */
export type Box = [x1: number, y1: number, x2: number, y2: number]

/** A calibrated plan sheet to measure on. */
export type MeasuredSheet = { file: string; page: number; text: PageText; segments: Segment[]; factor: number }

// Lines this close are one edge, and ends this close meet: about 35 mm at 1:100.
const TOLERANCE_PT = 1
// A roof outline is 1 m to 100 m a side, so a legend cell holding a tag isn't one.
const SIDE_MM = { min: 1000, max: 100_000 }
// A roof tag as drawings write one: RF:03, R1, RT-2.
const TAG = /^[A-Z]{1,4}\s*[:.-]?\s*\d{1,3}[A-Z]?$/i

type Line = { at: number; from: number; to: number }
type Takeoff = RoofPlanTakeoff
type Structure = Takeoff['structures'][number]
type Plane = Structure['planes'][number]

const round = (n: number, places = 0) => Math.round(n * 10 ** places) / 10 ** places

/** The page's horizontal and vertical lines, verticals indexed by x.
 *  ponytail: one segment per side; merge collinear pieces when a drawing
 *  splits a roof's edge. */
function linesOf(segments: Segment[]) {
  const horizontal: Line[] = []
  const vertical = new Map<number, Line[]>()
  for (const [x1, y1, x2, y2] of segments) {
    if (Math.abs(y1 - y2) <= TOLERANCE_PT / 4 && Math.abs(x2 - x1) > TOLERANCE_PT) {
      horizontal.push({ at: (y1 + y2) / 2, from: Math.min(x1, x2), to: Math.max(x1, x2) })
    } else if (Math.abs(x1 - x2) <= TOLERANCE_PT / 4 && Math.abs(y2 - y1) > TOLERANCE_PT) {
      const key = Math.round((x1 + x2) / 2)
      vertical.set(key, [...(vertical.get(key) ?? []), { at: (x1 + x2) / 2, from: Math.min(y1, y2), to: Math.max(y1, y2) }])
    }
  }
  return { horizontal, vertical }
}

/** Whether vertical lines at x run unbroken from y1 to y2, joined end to end. */
function joined(vertical: Map<number, Line[]>, x: number, y1: number, y2: number): boolean {
  const near = [-1, 0, 1].flatMap((d) => vertical.get(Math.round(x) + d) ?? [])
    .filter((l) => Math.abs(l.at - x) <= TOLERANCE_PT)
    .sort((a, b) => a.from - b.from)
  let reach = y1
  for (const line of near) {
    if (line.from > reach + TOLERANCE_PT) break
    reach = Math.max(reach, line.to)
    if (reach >= y2 - TOLERANCE_PT) return true
  }
  return false
}

/** The smallest rectangle of drawn edges around a point that `accept` allows:
 *  horizontal lines above and below it with the same ends, joined at both
 *  ends by vertical lines. Lines inside it, such as sheeting ribs, don't make
 *  one. */
export function enclosingBox(segments: Segment[], [px, py]: [number, number], accept: (box: Box) => boolean = () => true): Box | null {
  const { horizontal, vertical } = linesOf(segments)
  const spanning = horizontal.filter((h) => h.from - TOLERANCE_PT <= px && px <= h.to + TOLERANCE_PT)
  const above = spanning.filter((h) => h.at < py)
  const below = spanning.filter((h) => h.at > py)
  let best: Box | null = null
  let bestArea = Infinity
  for (const top of above) {
    for (const bottom of below) {
      if (Math.abs(top.from - bottom.from) > TOLERANCE_PT || Math.abs(top.to - bottom.to) > TOLERANCE_PT) continue
      const box: Box = [Math.max(top.from, bottom.from), top.at, Math.min(top.to, bottom.to), bottom.at]
      const area = (box[2] - box[0]) * (box[3] - box[1])
      if (area >= bestArea || !accept(box)) continue
      if (joined(vertical, box[0], box[1], box[3]) && joined(vertical, box[2], box[1], box[3])) {
        best = box
        bestArea = area
      }
    }
  }
  return best
}

/** Where a tag's text sits: the middle of its glyphs, above the baseline. */
const middle = (run: TextRun): [number, number] => [(run.x + run.x2) / 2, run.y - run.size * 0.35]

/** Whether two boxes share an edge, as two planes of one roof do. */
function touching(a: Box, b: Box): boolean {
  const overlapX = Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > TOLERANCE_PT
  const overlapY = Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > TOLERANCE_PT
  const side = Math.abs(a[2] - b[0]) <= TOLERANCE_PT || Math.abs(b[2] - a[0]) <= TOLERANCE_PT
  const end = Math.abs(a[3] - b[1]) <= TOLERANCE_PT || Math.abs(b[3] - a[1]) <= TOLERANCE_PT
  return (side && overlapY) || (end && overlapX)
}

/** Boxes in groups that touch: each group is one roof, each box a plane. */
function roofs(boxes: Box[]): Box[][] {
  const groups: Box[][] = []
  for (const box of boxes) {
    const joinedTo = groups.filter((g) => g.some((other) => touching(box, other)))
    for (const g of joinedTo) groups.splice(groups.indexOf(g), 1)
    groups.push([box, ...joinedTo.flat()])
  }
  const byPlace = (a: Box, b: Box) => a[0] - b[0] || a[1] - b[1]
  return groups.map((g) => g.sort(byPlace)).sort((a, b) => byPlace(a[0], b[0]))
}

/** Whether a box could be the roof around a tag. Not the tag's own label
 *  frame, which hugs its text; not a sheet border or title block, which spans
 *  half the sheet; and a roof's size at the sheet's scale.
 *  ponytail: a roof smaller than its tag's frame (under three text heights)
 *  reads as the frame; measure frames by their contents if a plan needs it. */
function roofLike(box: Box, tag: TextRun, sheet: MeasuredSheet): boolean {
  const [width, height] = [box[2] - box[0], box[3] - box[1]]
  if (width <= tag.x2 - tag.x + 2 * tag.size && height <= 3 * tag.size) return false
  if (width > sheet.text.width / 2 || height > sheet.text.height / 2) return false
  return [width, height].every((pt) => pt * sheet.factor >= SIDE_MM.min && pt * sheet.factor <= SIDE_MM.max)
}

/** The outlines a plane's roof tag sits in, on the calibrated sheets it cites. */
function outlinesFor(plane: Plane, sheets: MeasuredSheet[]): { tag: string; sheet: MeasuredSheet; boxes: Box[] } | null {
  for (const cited of plane.evidence) {
    const tag = (cited.text ?? '').trim()
    const sheet = sheets.find((s) => s.file === cited.file && s.page === cited.page)
    if (!sheet || !TAG.test(tag)) continue
    const key = tag.replace(/\s+/g, '').toUpperCase()
    const boxes: Box[] = []
    for (const run of sheet.text.runs.filter((r) => r.text.replace(/\s+/g, '').toUpperCase() === key)) {
      const box = enclosingBox(sheet.segments, middle(run), (b) => roofLike(b, run, sheet))
      if (box && !boxes.some((b) => b.every((v, i) => Math.abs(v - box[i]) <= TOLERANCE_PT))) boxes.push(box)
    }
    if (boxes.length) return { tag, sheet, boxes }
  }
  return null
}

/** The plane at a box's size, with the outline as evidence. Its size runs
 *  along its eave, then down its slope (DEC-040): a plane falling east or west
 *  has its eave up the sheet. ponytail: the sheet is taken as north up, so a
 *  plan drawn otherwise orients its measured skillions wrongly; reading the
 *  north point is the upgrade. */
function sized(plane: Plane, id: string, box: Box, found: { tag: string; sheet: MeasuredSheet }): Plane {
  const [across, up] = [box[2] - box[0], box[3] - box[1]].map((pt) => round(pt * found.sheet.factor))
  const fall = compassFall(plane.fall)
  const [width, length] = fall && Math.abs(fall[0]) > Math.abs(fall[1]) ? [up, across] : [across, up]
  const area = round((width * length) / 1e6, 2)
  return {
    ...plane,
    id,
    plan_dims_mm: [width, length],
    plan_area_m2: area,
    sloped_area_m2: plane.pitch_deg === null ? null : round(area / Math.cos((plane.pitch_deg * Math.PI) / 180), 2),
    confidence: 'medium',
    evidence: [
      ...plane.evidence,
      {
        file: found.sheet.file,
        page: found.sheet.page,
        text: `${found.tag}: drawn outline ${across} × ${up} mm at the sheet's scale`,
        bbox: box.map((v) => round(v, 1)) as Box,
      },
    ],
  }
}

type Found = NonNullable<ReturnType<typeof outlinesFor>>
type Edge = Structure['edges'][number]

/** A gap between bays this narrow is a wall between them, such as Grange's
 *  190 mm block wall between its carport bays. */
const WALL_MM = 400

/** A skillion bay's edge types, its lengths left for skillionEdges to work out
 *  from its size: an eave, a high side, and its two sides down its run, each a
 *  barge, or an apron where it meets another bay across a wall (DEC-040). Its
 *  run follows its fall as `sized` takes it, so bays falling towards each
 *  other face with their eaves, and no side is a wall's. */
function bayEdges(box: Box, bays: Box[], plane: Plane, factor: number): Edge[] {
  const fall = compassFall(plane.fall)
  const runAcross = !!fall && Math.abs(fall[0]) > Math.abs(fall[1])
  const near = (gap: number) => gap >= -TOLERANCE_PT && gap <= WALL_MM / factor
  const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.min(a2, b2) - Math.max(a1, b1) > TOLERANCE_PT
  const walled = (side: 0 | 1 | 2 | 3) => bays.some((o) => o !== box && (
    side === 0 ? near(box[0] - o[2]) && overlap(box[1], box[3], o[1], o[3])
      : side === 2 ? near(o[0] - box[2]) && overlap(box[1], box[3], o[1], o[3])
        : side === 1 ? near(box[1] - o[3]) && overlap(box[0], box[2], o[0], o[2])
          : near(o[1] - box[3]) && overlap(box[0], box[2], o[0], o[2])))
  const edge = (type: Edge['type']): Edge => ({ type, length_m: null, source: 'derived', confidence: 'medium' })
  const sides = (runAcross ? [1, 3] : [0, 2]) as Array<0 | 1 | 2 | 3>
  return [edge('eave'), edge('high_side'), ...sides.map((side) => edge(walled(side) ? 'apron' : 'barge'))]
}

/** The outlines each one-plane roof is measured from (DEC-040).
 *  - A roof with no area takes its tag's roofs, shared among the roofs that
 *    cite the tag: each takes the next, and the last takes the rest. So a
 *    carport read as one roof splits by its outlines, and one read as two bays
 *    takes one each, where each would otherwise split again.
 *  - A roof read with an area keeps it, unless it alone cites a tag that sits
 *    in outlines apart: then the reading has one roof where the drawing shows
 *    several, and the drawing measures. A tag is a finish code several roofs
 *    can share, as Grange's two houses do, so roofs that each have an area
 *    keep theirs. */
function loneShares(takeoff: Takeoff, sheets: MeasuredSheet[]): Map<Plane, { found: Found; groups: Box[][] }> {
  const key = (f: Found) => `${f.sheet.file}#${f.sheet.page}#${f.tag.replace(/\s+/g, '').toUpperCase()}`
  const count = (keys: string[]) => keys.reduce((n, k) => n.set(k, (n.get(k) ?? 0) + 1), new Map<string, number>())
  const cited = takeoff.structures.flatMap(({ planes }) => {
    const found = planes.length === 1 ? outlinesFor(planes[0], sheets) : null
    return found ? [{ plane: planes[0], found, key: key(found) }] : []
  })
  const citers = count(cited.map((c) => c.key))
  const measured = cited.filter(({ plane, found, key: k }) => plane.plan_area_m2 === null || (citers.get(k) === 1 && roofs(found.boxes).length > 1))
  const left = count(measured.map((c) => c.key))
  const taken = new Map<string, number>()
  const shares = new Map<Plane, { found: Found; groups: Box[][] }>()
  for (const { plane, found, key: k } of measured) {
    const groups = roofs(found.boxes)
    const [from, remaining] = [taken.get(k) ?? 0, left.get(k) ?? 1]
    const share = remaining > 1 ? groups.slice(from, from + 1) : groups.slice(from)
    taken.set(k, from + share.length)
    left.set(k, remaining - 1)
    shares.set(plane, { found, groups: share })
  }
  return shares
}

/** Fills each plane that has no area from the drawn outlines its roof tag
 *  sits in. Outlines that touch are planes of one roof; outlines apart are
 *  separate roofs, so a one-plane structure splits into one per roof. */
export function measureOutlines(takeoff: Takeoff, sheets: MeasuredSheet[]): { takeoff: Takeoff; measured: number } {
  let measured = 0
  const shares = loneShares(takeoff, sheets)
  const structures = takeoff.structures.flatMap((structure): Structure[] => {
    const lone = structure.planes.length === 1
    const planes: Plane[] = []
    let split: Structure[] = []
    for (const plane of structure.planes) {
      const found = lone ? shares.get(plane)?.found ?? null : plane.plan_area_m2 === null ? outlinesFor(plane, sheets) : null
      const groups = lone ? shares.get(plane)?.groups ?? [] : found ? roofs(found.boxes) : []
      if (!found || !groups.length) {
        planes.push(plane)
        continue
      }
      measured += groups.flat().length
      // ponytail: only a structure of one plane splits into several roofs; a
      // plane among others takes its outlines as more planes of the same roof.
      if (lone && groups.length > 1) {
        // Bays of one outline each are skillions, so each gets its own edge
        // types, an apron where it meets another across a wall; any other
        // split keeps the reading's edges and exclusions on its first roof.
        const bays = groups.every((group) => group.length === 1) ? groups.map(([box]) => box) : null
        split = groups.map((group, i) => ({
          ...structure,
          id: `${structure.id}-${i + 1}`,
          label: `${structure.label}, ${i + 1} of ${groups.length}`,
          edges: bays ? bayEdges(bays[i], bays, plane, found.sheet.factor) : i === 0 ? structure.edges : [],
          exclusions: i === 0 ? structure.exclusions : [],
          planes: group.map((box, j) => sized(plane, `${structure.id}-${i + 1}-P${j + 1}`, box, found)),
        }))
      } else {
        planes.push(...groups.flat().map((box, j) => sized(plane, j ? `${plane.id}-${j + 1}` : plane.id, box, found)))
      }
    }
    return split.length ? split : [{ ...structure, planes }]
  })
  return { takeoff: { ...takeoff, structures }, measured }
}
