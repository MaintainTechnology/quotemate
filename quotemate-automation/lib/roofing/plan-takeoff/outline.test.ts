// Outline measurement (TKO-29) on drawn lines made up for each rule: the
// rectangle around a tag, the lines that don't make one, and how outlines
// become roofs. Grange's real carport is in refine.fixtures.test.ts.

import { describe, expect, it } from 'vitest'
import type { Segment } from './calibrate'
import type { PageText, TextRun } from './classify'
import { enclosingBox, measureOutlines, type MeasuredSheet } from './outline'
import type { RoofPlanTakeoff } from './schema'

const rect = (x1: number, y1: number, x2: number, y2: number): Segment[] =>
  [[x1, y1, x2, y1], [x2, y1, x2, y2], [x2, y2, x1, y2], [x1, y2, x1, y1]]
const tag = (text: string, x: number, y: number, size = 10): TextRun => ({ text, x, x2: x + size * 0.6 * text.length, y, size })
// 50 mm a point: a 60 by 110 point bay is 3000 by 5500 mm.
const sheet = (segments: Segment[], runs: TextRun[]): MeasuredSheet => ({
  file: 'A.pdf', page: 1, segments, factor: 50,
  text: { width: 1000, height: 1000, chars: 500, runs } satisfies PageText,
})
const carport = (evidence = [{ file: 'A.pdf', page: 1, text: 'RF:03', bbox: null }]): RoofPlanTakeoff => ({
  version: 1,
  scale: { stated: '1:100', sheet_size: 'A1', pdf_page: [1000, 1000], calibration: { method: 'dimension_string', reference_mm: 3000, factor: 50, delta_pct: 0 } },
  sheets: [],
  structures: [{
    id: 'S3', label: 'Carport', role: 'secondary', source: 'plans', edges: [], exclusions: [],
    planes: [{
      id: 'S3-P1', plan_dims_mm: null, polygon_mm: null, plan_area_m2: null, pitch_deg: 3, pitch_source: null,
      fall: null, profile: 'Trimdek', finish_tag: 'RF:03', sloped_area_m2: null, confidence: 'low', evidence,
    }],
  }],
  scope: { includes: [], excludes: [], questions: [] },
})

describe('enclosingBox', () => {
  const bay = rect(100, 100, 160, 210)
  const ribs: Segment[] = [110, 120, 130, 140, 150].map((x) => [x, 100, x, 210])
  const gutter: Segment[] = [[100, 214, 160, 214]]

  it('finds the outline around a point, past the sheeting ribs inside it and the gutter line outside', () => {
    expect(enclosingBox([...bay, ...ribs, ...gutter], [130, 150])).toEqual([100, 100, 160, 210])
  })
  it('finds nothing when a side is missing', () => {
    expect(enclosingBox(bay.slice(0, 3), [130, 150])).toBeNull()
  })
  it('passes over the boxes accept refuses, such as a label frame', () => {
    const frame = rect(115, 140, 145, 160)
    expect(enclosingBox([...bay, ...frame], [130, 150])).toEqual([115, 140, 145, 160])
    expect(enclosingBox([...bay, ...frame], [130, 150], (b) => b[2] - b[0] > 40)).toEqual([100, 100, 160, 210])
  })
})

describe('measureOutlines', () => {
  // Two bays 4 points (200 mm) apart, a tag in a label frame in each, and the
  // same tag in a legend cell that is too small to be a roof.
  const bays = [...rect(100, 100, 160, 210), ...rect(164, 100, 224, 210)]
  const frames = [...rect(115, 140, 145, 160), ...rect(179, 140, 209, 160)]
  const legend = [...rect(600, 800, 640, 815)]
  const runs = [tag('RF:03', 115, 154), tag('RF:03', 179, 154), tag('RF:03', 605, 812)]

  it('scales each bay, splitting the one carport roof into two', () => {
    const { takeoff, measured } = measureOutlines(carport(), [sheet([...bays, ...frames, ...legend], runs)])
    expect(measured).toBe(2)
    expect(takeoff.structures.map((s) => [s.id, s.label, s.planes.map((p) => [p.id, p.plan_dims_mm, p.plan_area_m2])])).toEqual([
      ['S3-1', 'Carport, 1 of 2', [['S3-1-P1', [3000, 5500], 16.5]]],
      ['S3-2', 'Carport, 2 of 2', [['S3-2-P1', [3000, 5500], 16.5]]],
    ])
    expect(takeoff.structures[0].planes[0]).toMatchObject({
      confidence: 'medium',
      sloped_area_m2: 16.52,
      evidence: [{ text: 'RF:03' }, { text: 'RF:03: drawn outline 3000 × 5500 mm at the sheet\'s scale', bbox: [100, 100, 160, 210] }],
    })
  })

  it('makes the sides two split bays share across a wall aprons, as at Grange\'s carport (DEC-040)', () => {
    const types = (gapPt: number, fall: string | null = null) => {
      const t = carport()
      t.structures[0].planes[0].fall = fall
      const pair = [...rect(100, 100, 160, 210), ...rect(160 + gapPt, 100, 220 + gapPt, 210)]
      const tags = [tag('RF:03', 115, 154), tag('RF:03', 175 + gapPt, 154)]
      return measureOutlines(t, [sheet(pair, tags)]).takeoff.structures.map((s) => s.edges.map((e) => `${e.type} ${e.length_m}`))
    }
    // 4 points is 200 mm: the bays' facing sides run down the slope, so they are aprons.
    expect(types(4)).toEqual([
      ['eave null', 'high_side null', 'barge null', 'apron null'],
      ['eave null', 'high_side null', 'apron null', 'barge null'],
    ])
    // 2000 mm apart is no wall, and bays falling east face each other with their eave and high side.
    expect(types(40)[0]).toEqual(['eave null', 'high_side null', 'barge null', 'barge null'])
    expect(types(4, 'east, to the lane')[0]).toEqual(['eave null', 'high_side null', 'barge null', 'barge null'])
  })

  it('splits a roof read whole, with its own area, when its tag sits in outlines apart: the drawing shows two (DEC-040)', () => {
    const whole = carport()
    whole.structures[0].planes[0].plan_area_m2 = 36.4 // claude-sonnet-5-5's reading of Grange's carport
    const { takeoff, measured } = measureOutlines(whole, [sheet([...bays, ...frames, ...legend], runs)])
    expect(measured).toBe(2)
    expect(takeoff.structures.map((s) => [s.id, s.planes.map((p) => p.plan_area_m2)])).toEqual([['S3-1', [16.5]], ['S3-2', [16.5]]])
  })

  it('leaves the areas of roofs that share a finish tag, as Grange\'s two houses do', () => {
    const houses = carport()
    const second = structuredClone(houses.structures[0])
    Object.assign(second, { id: 'S4', label: 'House 2' })
    second.planes[0].id = 'S4-P1'
    houses.structures[0].label = 'House 1'
    houses.structures.push(second)
    for (const s of houses.structures) s.planes[0].plan_area_m2 = 97.25
    const { takeoff, measured } = measureOutlines(houses, [sheet([...bays, ...frames], runs)])
    expect(measured).toBe(0)
    expect(takeoff.structures.map((s) => s.planes[0].plan_area_m2)).toEqual([97.25, 97.25])
  })

  it("shares a tag's outlines among the roofs that cite it, one each, when the bays are read as two roofs", () => {
    const two = carport()
    const east = structuredClone(two.structures[0])
    Object.assign(east, { id: 'S4', label: 'Carport, east bay' })
    east.planes[0].id = 'S4-P1'
    two.structures[0].label = 'Carport, west bay'
    two.structures.push(east)
    const { takeoff, measured } = measureOutlines(two, [sheet([...bays, ...frames, ...legend], runs)])
    expect(measured).toBe(2)
    expect(takeoff.structures.map((s) => [s.id, s.label, s.planes.map((p) => [p.id, p.plan_dims_mm])])).toEqual([
      ['S3', 'Carport, west bay', [['S3-P1', [3000, 5500]]]],
      ['S4', 'Carport, east bay', [['S4-P1', [3000, 5500]]]],
    ])
    expect(takeoff.structures.map((s) => s.planes[0].evidence.at(-1)?.bbox)).toEqual([[100, 100, 160, 210], [164, 100, 224, 210]])
  })

  it('sizes an outline along its eave, then down its slope, taking the sheet as north up (DEC-040)', () => {
    const falling = (fall: string | null) => {
      const t = carport()
      t.structures[0].planes[0].fall = fall
      return measureOutlines(t, [sheet([...bays, ...frames], runs)]).takeoff.structures.map((s) => s.planes[0].plan_dims_mm)
    }
    expect(falling('south, to the parking')).toEqual([[3000, 5500], [3000, 5500]]) // the eave across the sheet
    expect(falling('east, to the lane')).toEqual([[5500, 3000], [5500, 3000]]) // the eave up the sheet
    expect(falling(null)).toEqual([[3000, 5500], [3000, 5500]])
  })

  it('keeps outlines that touch as planes of one roof, as a gable shows on plan', () => {
    const halves = [...rect(100, 100, 160, 210), ...rect(160, 100, 220, 210)]
    const { takeoff } = measureOutlines(carport(), [sheet(halves, [tag('RF:03', 115, 154), tag('RF:03', 175, 154)])])
    expect(takeoff.structures).toHaveLength(1)
    expect(takeoff.structures[0].planes.map((p) => p.id)).toEqual(['S3-P1', 'S3-P1-2'])
  })

  // Grange's carport, read as one roof of two RF:03 planes, none sized, took
  // both bays for each plane: 72 m² for its 36 (TKO-15).
  const twoPlanes = (prepare: (planes: RoofPlanTakeoff['structures'][number]['planes']) => void = () => {}) => {
    const t = carport()
    const [plane] = t.structures[0].planes
    t.structures[0].planes.push({ ...structuredClone(plane), id: 'S3-P2' })
    prepare(t.structures[0].planes)
    return t
  }
  const shape = (t: RoofPlanTakeoff) => t.structures.map((s) => [s.id, s.planes.map((p) => [p.id, p.plan_area_m2])])

  it("reads a roof of several unsized planes citing one tag as that tag's roofs, each outline measured once (TKO-15)", () => {
    const apart = measureOutlines(twoPlanes(), [sheet([...bays, ...frames, ...legend], runs)])
    expect(apart.measured).toBe(2)
    expect(shape(apart.takeoff)).toEqual([['S3-1', [['S3-1-P1', 16.5]]], ['S3-2', [['S3-2-P1', 16.5]]]])

    const halves = [...rect(100, 100, 160, 210), ...rect(160, 100, 220, 210)]
    const gable = measureOutlines(twoPlanes(), [sheet(halves, [tag('RF:03', 115, 154), tag('RF:03', 175, 154)])])
    expect(shape(gable.takeoff)).toEqual([['S3', [['S3-P1', 16.5], ['S3-P1-2', 16.5]]]])
  })

  it("measures a tag's outlines once in a roof of several planes: a second plane citing it stays as read", () => {
    // A plane sized from its own dimensions beside two the tag's outlines size.
    const mixed = twoPlanes((planes) => {
      planes.unshift({ ...structuredClone(planes[0]), id: 'S3-P0', plan_area_m2: 20, evidence: [{ file: 'A.pdf', page: 1, text: '4000 × 5000', bbox: null }] })
    })
    const halves = [...rect(100, 100, 160, 210), ...rect(160, 100, 220, 210)]
    const { takeoff, measured } = measureOutlines(mixed, [sheet(halves, [tag('RF:03', 115, 154), tag('RF:03', 175, 154)])])
    expect(measured).toBe(2)
    expect(shape(takeoff)).toEqual([['S3', [['S3-P0', 20], ['S3-P1', 16.5], ['S3-P1-2', 16.5], ['S3-P2', null]]]])

    // Fewer outlines than planes: one plane takes the one, and the other is left for C5 to flag.
    const one = measureOutlines(twoPlanes(), [sheet([...rect(100, 100, 160, 210), ...frames.slice(0, 4)], [runs[0]])])
    expect([one.measured, shape(one.takeoff)]).toEqual([1, [['S3', [['S3-P1', 16.5], ['S3-P2', null]]]]])
  })

  it('leaves a plane alone when its tag sits in no outline, or it has an area already', () => {
    const lonely = measureOutlines(carport(), [sheet(bays, [tag('RF:03', 700, 700)])])
    expect([lonely.measured, lonely.takeoff.structures[0].planes[0].plan_area_m2]).toEqual([0, null])

    // An area the reading gives stands where its tag sits in one outline.
    const sized = carport()
    sized.structures[0].planes[0].plan_area_m2 = 20
    expect(measureOutlines(sized, [sheet([...rect(100, 100, 160, 210), ...frames.slice(0, 4)], [runs[0]])]).measured).toBe(0)

    const prose = carport([{ file: 'A.pdf', page: 1, text: 'RF:03 LYSAGHT TRIMDEK', bbox: null }])
    expect(measureOutlines(prose, [sheet([...bays, ...frames], runs)]).measured).toBe(0)
  })
})
