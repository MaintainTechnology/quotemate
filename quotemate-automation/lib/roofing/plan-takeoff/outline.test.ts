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

  it('keeps outlines that touch as planes of one roof, as a gable shows on plan', () => {
    const halves = [...rect(100, 100, 160, 210), ...rect(160, 100, 220, 210)]
    const { takeoff } = measureOutlines(carport(), [sheet(halves, [tag('RF:03', 115, 154), tag('RF:03', 175, 154)])])
    expect(takeoff.structures).toHaveLength(1)
    expect(takeoff.structures[0].planes.map((p) => p.id)).toEqual(['S3-P1', 'S3-P1-2'])
  })

  it('leaves a plane alone when its tag sits in no outline, or it has an area already', () => {
    const lonely = measureOutlines(carport(), [sheet(bays, [tag('RF:03', 700, 700)])])
    expect([lonely.measured, lonely.takeoff.structures[0].planes[0].plan_area_m2]).toEqual([0, null])

    const sized = carport()
    sized.structures[0].planes[0].plan_area_m2 = 20
    expect(measureOutlines(sized, [sheet([...bays, ...frames], runs)]).measured).toBe(0)

    const prose = carport([{ file: 'A.pdf', page: 1, text: 'RF:03 LYSAGHT TRIMDEK', bbox: null }])
    expect(measureOutlines(prose, [sheet([...bays, ...frames], runs)]).measured).toBe(0)
  })
})
