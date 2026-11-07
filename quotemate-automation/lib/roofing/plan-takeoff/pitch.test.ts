// Pitches measured off the elevations' roof lines (TKO-30, DEC-044).

import { describe, expect, it } from 'vitest'
import type { Segment } from './calibrate'
import { elevationPitches, pitchFromElevations, type ElevationPitch } from './pitch'
import type { RoofPlanTakeoff } from './schema'

/** A stroke from (x, y), `length` points long at `deg`, rising or falling to
 *  the right; the page's y grows downwards. */
const stroke = (x: number, y: number, length: number, deg: number, rising: boolean): Segment => {
  const r = (deg * Math.PI) / 180
  return [x, y, x + length * Math.cos(r), y + (rising ? -1 : 1) * length * Math.sin(r)]
}
// Walls, ground and eave lines, and lettering's short strokes at every angle.
const frame: Segment[] = [[0, 300, 400, 300], [50, 300, 50, 200], [350, 300, 350, 200], [40, 200, 360, 200]]
const lettering = Array.from({ length: 200 }, (_, i) => stroke(10 + i, 500, 6, ((i * 37) % 80) + 5, i % 2 === 0))
/** A roof's slope as an elevation draws it: one stroke rising, its mirror falling. */
const roof = (deg: number, length: number) => [stroke(40, 200, length, deg, true), stroke(260, 150, length, deg, false)]

describe('elevationPitches', () => {
  it("finds a hip roof's pitch in its mirrored hip lines, and passes over walls, ground and lettering", () => {
    expect(elevationPitches([...frame, ...lettering, ...roof(25, 110)])).toEqual([{ deg: 25, support: 220 }])
  })

  it("finds each roof's pitch, the best supported first", () => {
    expect(elevationPitches([...frame, ...roof(25, 110), ...roof(5, 150)])).toEqual([
      { deg: 5, support: 300 },
      { deg: 25, support: 220 },
    ])
  })

  it('takes strokes all leaning one way, as stairs and hatching do, for no roof', () => {
    const stairs = Array.from({ length: 4 }, (_, i) => stroke(100 + 10 * i, 250, 40, 34, true))
    const hatch = Array.from({ length: 6 }, (_, i) => stroke(200 + 8 * i, 280, 30, 45, true))
    expect(elevationPitches([...frame, ...stairs, ...hatch])).toEqual([])
    expect(elevationPitches([...frame, ...stairs, ...hatch, ...roof(25, 110)])).toEqual([{ deg: 25, support: 220 }])
  })

  it('keeps strokes within a degree as one roof, at its length-weighted pitch to the half degree', () => {
    const drawn = [stroke(40, 200, 100, 24.7, true), stroke(260, 150, 100, 25.2, false)]
    expect(elevationPitches(drawn)).toEqual([{ deg: 25, support: 200 }])
  })

  it('finds nothing on a sheet with no sloped lines', () => {
    expect(elevationPitches([...frame, ...lettering])).toEqual([])
  })
})

type Structure = RoofPlanTakeoff['structures'][number]
type Plane = Structure['planes'][number]
const plane = (id: string, over: Partial<Plane> = {}): Plane => ({
  id, plan_dims_mm: null, polygon_mm: null, plan_area_m2: null, pitch_deg: null, pitch_source: null, fall: null,
  profile: null, finish_tag: null, sloped_area_m2: null, confidence: 'low', evidence: [], ...over,
})
const structure = (id: string, planes: Plane[]): Structure => ({
  id, label: id, role: 'primary', source: 'plans', exclusions: [], edges: [], planes,
})
const takeoff = (...structures: Structure[]): RoofPlanTakeoff => ({
  version: 1,
  scale: { stated: '1:100', sheet_size: 'A3', pdf_page: [1191, 842], calibration: { method: 'none', reference_mm: null, factor: null, delta_pct: null } },
  sheets: [],
  structures,
  scope: { includes: [], excludes: [], questions: [] },
})
const SHEET = { file: 'elevations.pdf', page: 1 }

describe('pitchFromElevations', () => {
  const found: ElevationPitch[] = [{ deg: 5, support: 300 }, { deg: 25, support: 220 }]

  it('gives a roof of several planes the steepest pitch and a roof of one plane the shallowest', () => {
    const house = structure('S1', [plane('S1-P1', { plan_area_m2: 50, confidence: 'high' }), plane('S1-P2')])
    const section = structure('S2', [plane('S2-P1')])
    const { takeoff: t, pitched } = pitchFromElevations(takeoff(house, section), found, SHEET)
    expect(pitched).toBe(3)
    const [p1, p2] = t.structures[0].planes
    expect(p1).toMatchObject({ pitch_deg: 25, pitch_source: 'elevation', sloped_area_m2: 55.17, confidence: 'medium' })
    expect(p2).toMatchObject({ pitch_deg: 25, pitch_source: 'elevation', sloped_area_m2: null, confidence: 'low' })
    expect(p1.evidence.at(-1)).toEqual({ ...SHEET, text: 'Pitch 25°: the steepest roof lines on the elevation, for a roof of several planes', bbox: null })
    expect(t.structures[1].planes[0]).toMatchObject({ pitch_deg: 5, pitch_source: 'elevation' })
    expect(t.structures[1].planes[0].evidence.at(-1)?.text).toBe('Pitch 5°: the shallowest roof lines on the elevation, for a roof of one plane')
  })

  it('keeps a pitch the reading has, and passes over a family too thinly drawn to be a roof', () => {
    const carport = structure('S3', [plane('S3-P1', { pitch_deg: 3, pitch_source: 'note' })])
    const house = structure('S1', [plane('S1-P1'), plane('S1-P2')])
    const sparse: ElevationPitch[] = [{ deg: 5, support: 1000 }, { deg: 25, support: 900 }, { deg: 40, support: 100 }]
    const { takeoff: t, pitched } = pitchFromElevations(takeoff(carport, house), sparse, SHEET)
    expect(pitched).toBe(2)
    expect(t.structures[0].planes[0]).toMatchObject({ pitch_deg: 3, pitch_source: 'note', evidence: [] })
    expect(t.structures[1].planes.map((p) => p.pitch_deg)).toEqual([25, 25])
  })

  it('leaves the reading as it is when the elevations show no roof lines', () => {
    const before = takeoff(structure('S1', [plane('S1-P1')]))
    expect(pitchFromElevations(before, [], SHEET)).toEqual({ takeoff: before, pitched: 0 })
  })
})
