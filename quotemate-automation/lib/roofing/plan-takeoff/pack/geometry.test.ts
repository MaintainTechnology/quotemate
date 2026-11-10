import { describe, expect, it } from 'vitest'
import type { PackPlane, PackStructure } from './privacy'
import { compassFall, packGeometry, type Point } from './geometry'

const plane = (over: Partial<PackPlane> = {}): PackPlane => ({
  id: 'S1-P1',
  plan_dims_mm: [10130, 9600],
  polygon_mm: null,
  plan_area_m2: 97.25,
  pitch_deg: 5,
  pitch_source: 'note',
  fall: 'south, to the street',
  profile: 'Lysaght Custom Orb',
  finish_tag: 'RF:01',
  sloped_area_m2: 97.62,
  confidence: 'high',
  sheets: ['A1001A'],
  ...over,
})

const skillion = (over: Partial<PackStructure> = {}, planeOver: Partial<PackPlane> = {}): PackStructure => ({
  id: 'S1',
  label: 'House 1',
  role: 'primary',
  source: 'plans',
  planes: [plane(planeOver)],
  edges: [
    { type: 'eave', length_m: 10.13, source: 'measured', confidence: 'high' },
    { type: 'high_side', length_m: 10.13, source: 'measured', confidence: 'high' },
    { type: 'barge', length_m: 9.6, source: 'measured', confidence: 'high' },
    { type: 'barge', length_m: 9.6, source: 'measured', confidence: 'high' },
  ],
  exclusions: [],
  ...over,
})

const length = ([a, b]: [Point, Point]) => Math.hypot(b[0] - a[0], b[1] - a[1])
const xs = (points: Point[]) => points.map((p) => p[0])
const ys = (points: Point[]) => points.map((p) => p[1])

describe('compassFall', () => {
  it.each([
    ['south', [0, -1]],
    ['falls south, to the street', [0, -1]],
    ['to the west', [-1, 0]],
    ['Falls to E', [1, 0]],
    ['S', [0, -1]],
    ['north-east', [Math.SQRT1_2, Math.SQRT1_2]],
    ['NE', [Math.SQRT1_2, Math.SQRT1_2]],
    ['south west to the gutter', [-Math.SQRT1_2, -Math.SQRT1_2]],
  ])('reads %j as a direction downhill on plan, north up', (fall, expected) => {
    const got = compassFall(fall)!
    expect(got[0]).toBeCloseTo(expected[0], 9)
    expect(got[1]).toBeCloseTo(expected[1], 9)
  })

  it.each([null, 'FALL 1:20', 'Southern side of the house', 'falls to the gutter', ''])('finds no direction in %j', (fall) => {
    expect(compassFall(fall)).toBeNull()
  })
})

describe('packGeometry', () => {
  it('draws a skillion from its size, turned to its fall, with its edges where they belong', () => {
    const [s] = packGeometry([skillion()]).structures
    const outline = s.planes[0].outline!
    expect(s.planes[0].from).toBe('size')
    expect(Math.max(...xs(outline)) - Math.min(...xs(outline))).toBeCloseTo(10130, 6)
    expect(Math.max(...ys(outline)) - Math.min(...ys(outline))).toBeCloseTo(9600, 6)
    const byType = (type: string) => s.edges.filter((e) => e.type === type)
    const [eave] = byType('eave')
    const [high] = byType('high_side')
    expect(length([eave.from, eave.to])).toBeCloseTo(10130, 6)
    // South is down: the eave is the low side, the high side the top.
    expect(eave.from[1]).toBeCloseTo(Math.min(...ys(outline)), 6)
    expect(high.from[1]).toBeCloseTo(Math.max(...ys(outline)), 6)
    expect(byType('barge')).toHaveLength(2)
    expect(byType('barge').map((e) => length([e.from, e.to]))).toEqual([expect.closeTo(9600, 6), expect.closeTo(9600, 6)])
    expect(s.edges.map((e) => e.index).sort()).toEqual([0, 1, 2, 3])
  })

  it('takes the size the eave matches as the side along the eave', () => {
    const [s] = packGeometry([skillion({}, { plan_dims_mm: [9600, 10130] })]).structures
    const outline = s.planes[0].outline!
    expect(Math.max(...xs(outline)) - Math.min(...xs(outline))).toBeCloseTo(10130, 6)
    expect(s.edges.find((e) => e.type === 'eave')).toBeDefined()
  })

  it('puts the eave on the east side of a roof that falls east', () => {
    const [s] = packGeometry([skillion({}, { fall: 'falls east' })]).structures
    const outline = s.planes[0].outline!
    const eave = s.edges.find((e) => e.type === 'eave')!
    expect(eave.from[0]).toBeCloseTo(Math.max(...xs(outline)), 6)
    expect(eave.to[0]).toBeCloseTo(Math.max(...xs(outline)), 6)
    expect(Math.max(...ys(outline)) - Math.min(...ys(outline))).toBeCloseTo(10130, 6)
  })

  it('types no side the takeoff leaves open', () => {
    const mixed = skillion({
      edges: [
        { type: 'eave', length_m: 10.13, source: 'measured', confidence: 'high' },
        { type: 'high_side', length_m: 10.13, source: 'measured', confidence: 'high' },
        { type: 'barge', length_m: 9.6, source: 'derived', confidence: 'medium' },
        { type: 'apron', length_m: 9.6, source: 'derived', confidence: 'medium' },
      ],
    })
    const [s] = packGeometry([mixed]).structures
    expect(s.edges.map((e) => e.type).sort()).toEqual(['eave', 'high_side'])
  })

  it('draws the outline alone when the fall names no direction, or no edges are listed', () => {
    const [noFall, noEdges] = packGeometry([skillion({}, { fall: 'FALL 1:20' }), skillion({ id: 'S2', edges: [] })]).structures
    expect(noFall.planes[0].outline).toHaveLength(4)
    expect(noFall.planes[0].fall).toBeNull()
    expect(noFall.edges).toEqual([])
    expect(noEdges.planes[0].outline).toHaveLength(4)
    expect(noEdges.edges).toEqual([])
  })

  it('draws a plane from its outline when it has one, and leaves out a plane with neither', () => {
    const polygon: Point[] = [[0, 0], [6000, 0], [6000, 4000], [3000, 6000], [0, 4000]]
    const [s] = packGeometry([skillion({ edges: [] }, { polygon_mm: polygon, plan_dims_mm: null })]).structures
    const outline = s.planes[0].outline!
    expect(s.planes[0].from).toBe('polygon')
    expect(outline).toHaveLength(5)
    expect(length([outline[0], outline[1]])).toBeCloseTo(6000, 6)
    const [none] = packGeometry([skillion({}, { polygon_mm: null, plan_dims_mm: null })]).structures
    expect(none.planes[0]).toMatchObject({ outline: null, from: null })
    expect(none.box).toBeNull()
  })

  it('refuses a size or outline no roof could have', () => {
    const [huge] = packGeometry([skillion({}, { plan_dims_mm: [1e12, 5000] })]).structures
    expect(huge.planes[0].outline).toBeNull()
    const [nan] = packGeometry([skillion({ edges: [] }, { polygon_mm: [[0, 0], [Number.NaN, 0], [1, 1]], plan_dims_mm: null })]).structures
    expect(nan.planes[0].outline).toBeNull()
  })

  it('gives each roof its own slot, left to right and 3 m apart, on the x axis', () => {
    const geometry = packGeometry([skillion(), skillion({ id: 'S2' }, { plan_dims_mm: [3219, 5599] }), skillion({ id: 'S3', edges: [] }, { plan_dims_mm: null })])
    const [a, b, c] = geometry.structures
    expect(a.box![0]).toBeCloseTo(0, 6)
    expect(a.box![1]).toBeCloseTo(0, 6)
    expect(b.box![0] - a.box![2]).toBeCloseTo(3000, 6)
    expect(b.box![1]).toBeCloseTo(0, 6)
    expect(c.box).toBeNull()
    expect(geometry.extent).toEqual([0, 0, b.box![2], Math.max(a.box![3], b.box![3])])
  })

  it('sets the planes of one roof side by side when only their sizes are known', () => {
    const [s] = packGeometry([skillion({ edges: [] }, {})].map((st) => ({ ...st, planes: [plane(), plane({ id: 'S1-P2', plan_dims_mm: [4000, 3000] })] }))).structures
    const [p1, p2] = s.planes.map((p) => p.outline!)
    expect(Math.min(...xs(p2))).toBeGreaterThanOrEqual(Math.max(...xs(p1)) + 999)
  })

  it('projects an aerial footprint into millimetres, north up', () => {
    // A 10 m square near Sampleton: 10 m is 0.0000898° of latitude.
    const lat = -27.59
    const dLat = 10 / 111_320
    const dLon = dLat / Math.cos((lat * Math.PI) / 180)
    const ring = [[152.75, lat], [152.75 + dLon, lat], [152.75 + dLon, lat + dLat], [152.75, lat + dLat], [152.75, lat]]
    const hybrid = skillion({ source: 'hybrid', edges: [], aerial: { building_id: 'bld1', footprint_m2: 100, drawn_plan_m2: 97, polygon: { type: 'Polygon', coordinates: [ring] } } }, { polygon_mm: null, plan_dims_mm: null })
    const [s] = packGeometry([hybrid]).structures
    const footprint = s.footprint!
    expect(footprint).toHaveLength(4) // the closing point isn't repeated
    expect(Math.max(...xs(footprint)) - Math.min(...xs(footprint))).toBeCloseTo(10_000, -2)
    expect(Math.max(...ys(footprint)) - Math.min(...ys(footprint))).toBeCloseTo(10_000, -2)
    expect(footprint[2][1]).toBeGreaterThan(footprint[1][1]) // north is up
    expect(s.box![0]).toBeCloseTo(0, 6)
  })
})
