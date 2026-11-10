// A hip roof measured from its drawn hips and ridges (TKO-30's second half,
// DEC-045), on a drawing made up for each rule: an L-shaped hip roof drawn as
// Whittaker's A104 draws one, each hip, valley and ridge a centre line between
// two band strokes, the eaves as gutters, and sheeting ribs between. Whittaker
// itself is in refine.fixtures.test.ts.

import { describe, expect, it } from 'vitest'
import type { Segment } from './calibrate'
import type { PageText } from './classify'
import { hipRoofs, measureHipRoofs } from './hips'
import type { MeasuredSheet } from './outline'
import type { RoofPlanTakeoff } from './schema'

type P = [number, number]
const BAND = 2.9 // a line's band strokes, either side of it

/** A hip, valley or ridge as drawn: its centre line, and a band stroke each
 *  side stopping short of its ends. */
function banded(a: P, b: P, from: P = a): Segment[] {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const length = Math.hypot(dx, dy)
  const [ux, uy] = [dx / length, dy / length]
  const [nx, ny] = [-uy * BAND, ux * BAND]
  const side = (s: number): Segment => [from[0] + 3 * ux + s * nx, from[1] + 3 * uy + s * ny, b[0] - 3 * ux + s * nx, b[1] - 3 * uy + s * ny]
  return [[from[0], from[1], b[0], b[1]], side(1), side(-1)]
}

// The roof, 50 mm a point: a main block 200 by 240 points with a wing 100 by
// 120 to the east of its southern half. The page's y grows downwards (south).
const NW: P = [100, 100], NE: P = [300, 100], R: P = [300, 220], WNE: P = [400, 220], SE: P = [400, 340], SW: P = [100, 340]
const N1: P = [200, 200], N2: P = [200, 240], N3: P = [240, 280], N4: P = [340, 280]
const OUTLINE = [NW, NE, R, WNE, SE, SW]
const skeleton = (nwFrom: P = NW): Segment[] => [
  ...banded(NW, N1, nwFrom), ...banded(NE, N1), ...banded(SW, N2), ...banded(N2, N3),
  ...banded(R, N3), ...banded(WNE, N4), ...banded(SE, N4), ...banded(N1, N2), ...banded(N3, N4),
]
/** Each eave as a gutter: the roof's edge, and its outer line 2.8 points out. */
const gutters = (skip: (corner: P) => boolean = () => false): Segment[] => OUTLINE.flatMap((a, i) => {
  const b = OUTLINE[(i + 1) % OUTLINE.length]
  if (skip(a) || skip(b)) return []
  const [ox, oy] = a[1] === b[1] ? [0, a[1] < 220 ? -2.8 : 2.8] : [a[0] < 250 ? -2.8 : 2.8, 0]
  return [[a[0], a[1], b[0], b[1]], [a[0] + ox, a[1] + oy, b[0] + ox, b[1] + oy]] as Segment[]
})
// Ribs down the north face, from its gutter to the hips' bands.
const ribs: Segment[] = [120, 140, 160, 180, 220, 240, 260, 280].map((x) => [x, 100, x, 100 + Math.min(x - 100, 300 - x) - 3])
// A lower roof's hip, in line with the SW hip beyond its corner, and a 0.8 m
// symbol at 45°: neither is the roof's.
const distractors: Segment[] = [...banded([96, 344], [40, 400]), ...banded([600, 600], [611.3, 611.3]), [0, 700, 900, 700], [900, 0, 900, 700]]
const DRAWING = [...skeleton(), ...gutters(), ...ribs, ...distractors]

const areaOf = (polygon: P[]) => Math.abs(polygon.reduce((sum, [x, y], i) => {
  const [nx, ny] = polygon[(i + 1) % polygon.length]
  return sum + x * ny - nx * y
}, 0)) / 2
const near = (a: P[], b: P[]) => a.length === b.length && a.every((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]) < 0.01)

describe('hipRoofs', () => {
  it("finds the eave outline from the hips' ends, and one face per eave", () => {
    const [roof, ...others] = hipRoofs(DRAWING, 50)
    expect(others).toEqual([])
    expect(near(roof.outline, OUTLINE)).toBe(true)
    expect(roof.faces.map((f) => areaOf(f.polygon))).toEqual([10000, 10400, 6000, 3600, 16000, 14000])
    expect(roof.faces.map((f) => f.fall)).toEqual(['north', 'east', 'north', 'east', 'south', 'west'])
  })

  it('types each line: hips from the corners and between the ridges, the valley from the inside corner, the ridges', () => {
    const [roof] = hipRoofs(DRAWING, 50)
    const total = (type: string) => Math.round(roof.edges.filter((e) => e.type === type).reduce((sum, e) => sum + Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]), 0) * 100) / 100
    expect(roof.edges.filter((e) => e.type === 'hip')).toHaveLength(6)
    expect([total('hip'), total('valley'), total('ridge'), total('eave')]).toEqual([650.54, 84.85, 140, 1080])
  })

  it('finds a corner a roof drawn over it hides, where its hip meets the eaves through the corners beside it', () => {
    const hidden = (p: P) => p === NW
    // A deck roof's edges over the north-west corner: its hip is drawn to them.
    const deck: Segment[] = [[130, 40, 130, 260], [40, 260, 130, 260]]
    const [roof] = hipRoofs([...skeleton([130, 130]), ...gutters(hidden), ...ribs, ...deck], 50)
    expect(near(roof.outline, OUTLINE)).toBe(true)
    expect(areaOf(roof.outline)).toBe(60000)
    // With nothing drawn over it, a hip that stops short is a broken drawing.
    expect(hipRoofs([...skeleton([130, 130]), ...gutters(hidden), ...ribs], 50)).toEqual([])
  })

  it("measures nothing where the lines don't close into a hip roof", () => {
    // Without its valley, the wing's lines are apart from the house's, and the
    // house's hip stops where the valley met it.
    const noValley = DRAWING.filter((s) => !(s[0] === R[0] && s[1] === R[1]))
    expect(hipRoofs(noValley, 50)).toEqual([])
    expect(hipRoofs([...gutters(), ...ribs, ...distractors], 50)).toEqual([])
  })
})

// 50 mm a point, so the main block is 10 by 12 m and the wing 5 by 6 m.
const sheet = (segments: Segment[]): MeasuredSheet => ({
  file: 'A104.pdf', page: 1, segments, factor: 50,
  text: { width: 1000, height: 800, chars: 500, runs: [] } satisfies PageText,
})
const cite = { file: 'A104.pdf', page: 1, text: 'FALL', bbox: null }
const plane = (id: string, over: Partial<RoofPlanTakeoff['structures'][number]['planes'][number]> = {}) => ({
  id, plan_dims_mm: null, polygon_mm: null, plan_area_m2: null, pitch_deg: 25, pitch_source: 'elevation' as const,
  fall: null, profile: null, finish_tag: null, sloped_area_m2: null, confidence: 'low' as const, evidence: [cite], ...over,
})
const takeoff = (planes = [plane('S1-P1'), plane('S1-P2'), plane('S1-P3')]): RoofPlanTakeoff => ({
  version: 1,
  scale: { stated: '1:50', sheet_size: 'A1', pdf_page: [1000, 800], calibration: { method: 'title_block', reference_mm: null, factor: 50, delta_pct: null } },
  sheets: [],
  structures: [
    { id: 'S1', label: 'House, hipped roof', role: 'primary', source: 'plans', planes, edges: [{ type: 'hip', length_m: null, source: 'derived', confidence: 'low' }, { type: 'apron', length_m: 2, source: 'derived', confidence: 'low' }], exclusions: [] },
    { id: 'S2', label: 'Skillion', role: 'secondary', source: 'plans', planes: [plane('S2-P1', { pitch_deg: 5 })], edges: [], exclusions: [] },
  ],
  scope: { includes: [], excludes: [], questions: [] },
})

describe('measureHipRoofs', () => {
  it("gives the reading's hipped roof one plane per drawn face, at its pitch, and its lines along the roof", () => {
    const { takeoff: measured, hipped } = measureHipRoofs(takeoff(), [sheet(DRAWING)])
    expect(hipped).toBe(6)
    const [house, skillion] = measured.structures
    expect(house.planes.map((p) => [p.id, p.plan_area_m2, p.fall])).toEqual([
      ['S1-P1', 25, 'north'], ['S1-P2', 26, 'east'], ['S1-P3', 15, 'north'], ['S1-P4', 9, 'east'], ['S1-P5', 40, 'south'], ['S1-P6', 35, 'west'],
    ])
    expect(house.planes[0]).toMatchObject({ pitch_deg: 25, pitch_source: 'elevation', sloped_area_m2: 27.58, confidence: 'medium' })
    // In millimetres, north up, from the roof's south-west corner.
    expect(house.planes[0].polygon_mm).toEqual([[0, 12000], [10000, 12000], [5000, 7000]])
    expect(house.planes[0].evidence).toEqual([cite, { file: 'A104.pdf', page: 1, text: 'Hip roof: drawn hips and ridges, face 1 of 6, 25 m² on plan', bbox: [100, 100, 300, 200] }])

    // A 45° hip between 25° faces is 1.053 times its plan length (DEC-039).
    const total = (type: string) => Math.round(house.edges.filter((e) => e.type === type).reduce((sum, e) => sum + (e.length_m ?? 0), 0) * 1000) / 1000
    expect([total('hip'), total('valley'), total('ridge'), total('eave'), total('apron')]).toEqual([34.25, 4.467, 7, 54, 2])
    expect(house.edges.every((e) => e.type === 'apron' || (e.source === 'measured' && e.confidence === 'medium'))).toBe(true)
    expect(skillion).toEqual(takeoff().structures[1])
  })

  it('leaves the hips unmeasured along the roof when the roof has no pitch', () => {
    const unpitched = [plane('S1-P1', { pitch_deg: null, pitch_source: null }), plane('S1-P2', { pitch_deg: null, pitch_source: null })]
    const [house] = measureHipRoofs(takeoff(unpitched), [sheet(DRAWING)]).takeoff.structures
    expect(house.planes[0]).toMatchObject({ plan_area_m2: 25, pitch_deg: null, sloped_area_m2: null })
    expect(house.edges.filter((e) => e.type === 'hip').every((e) => e.length_m === null)).toBe(true)
    expect(house.edges.filter((e) => e.type === 'eave').every((e) => e.length_m !== null)).toBe(true)
  })

  it("leaves a roof the reading sized, one it doesn't cite the sheet for, and two that could each be the hip roof", () => {
    const sized = takeoff([plane('S1-P1', { plan_area_m2: 60 }), plane('S1-P2')])
    expect(measureHipRoofs(sized, [sheet(DRAWING)])).toEqual({ takeoff: sized, hipped: 0 })
    const elsewhere = takeoff([plane('S1-P1', { evidence: [{ ...cite, page: 2 }] }), plane('S1-P2', { evidence: [] })])
    expect(measureHipRoofs(elsewhere, [sheet(DRAWING)])).toEqual({ takeoff: elsewhere, hipped: 0 })
    const two = takeoff()
    two.structures[1] = { ...two.structures[0], id: 'S2' }
    expect(measureHipRoofs(two, [sheet(DRAWING)])).toEqual({ takeoff: two, hipped: 0 })
    expect(measureHipRoofs(takeoff(), [sheet([...gutters(), ...ribs])])).toEqual({ takeoff: takeoff(), hipped: 0 })
  })
})
