// Geoscape multi-structure path — the pure helpers (splitMultiPolygon,
// pickAllPolygons, rankBuildingSummaries) plus measureAll() via a stubbed
// fetch. Covers BOTH sources of secondary structures: separate buildings
// in the Buildings list, and extra sub-polygons in one building's
// MultiPolygon footprint (the shed-circled-in-red case).

import { describe, expect, it, vi } from 'vitest'
import {
  GeoscapeProvider,
  MAX_BUILDINGS,
  SECONDARY_MIN_AREA_M2,
  pickAllPolygons,
  polygonAreaM2,
  rankBuildingSummaries,
  splitMultiPolygon,
  type BuildingSummary,
} from './geoscape'

// ~20m × 20m ≈ 400 m² and ~10m × 10m ≈ 100 m² rectangles at Sydney lat.
const LAT = -33.8
const BIG: number[][][] = [[
  [151.21, LAT],
  [151.2102162, LAT],
  [151.2102162, LAT - 0.000180901],
  [151.21, LAT - 0.000180901],
  [151.21, LAT],
]]
const SMALL: number[][][] = [[
  [151.2, LAT],
  [151.2001081, LAT],
  [151.2001081, LAT - 0.0000904506],
  [151.2, LAT - 0.0000904506],
  [151.2, LAT],
]]

describe('splitMultiPolygon', () => {
  it('returns every sub-polygon, largest first', () => {
    const out = splitMultiPolygon([SMALL, BIG])
    expect(out).toHaveLength(2)
    expect(out[0].coordinates).toEqual(BIG) // largest first
    expect(out[1].coordinates).toEqual(SMALL)
  })
  it('drops sub-polygons below minAreaM2 but always keeps the largest', () => {
    const TINY: number[][][] = [[
      [151.3, LAT], [151.30001, LAT], [151.30001, LAT - 0.00001], [151.3, LAT - 0.00001], [151.3, LAT],
    ]]
    const out = splitMultiPolygon([BIG, TINY], { minAreaM2: 50 })
    expect(out).toHaveLength(1) // tiny (~1 m²) dropped
    expect(out[0].coordinates).toEqual(BIG)
  })
  it('returns [] for empty input', () => {
    expect(splitMultiPolygon([])).toEqual([])
  })
})

describe('pickAllPolygons', () => {
  it('returns all sub-polygons of a typeless MultiPolygon (real footprint2d shape)', () => {
    const polys = pickAllPolygons({ coordinates: [BIG, SMALL] })
    expect(polys).toHaveLength(2)
    expect(polys[0].coordinates).toEqual(BIG)
  })
  it('returns a single-element array for a plain Polygon', () => {
    const polys = pickAllPolygons({ type: 'Polygon', coordinates: SMALL })
    expect(polys).toHaveLength(1)
  })
  it('unwraps { data: { ... } }', () => {
    const polys = pickAllPolygons({ data: { coordinates: [BIG, SMALL] } })
    expect(polys).toHaveLength(2)
  })
  it('returns [] when no polygon present', () => {
    expect(pickAllPolygons({ type: 'Point', coordinates: [1, 2] })).toEqual([])
  })
})

describe('rankBuildingSummaries', () => {
  it('orders most-specific (fewest related addresses) first, stable on ties', () => {
    const s: BuildingSummary[] = [
      { buildingId: 'mid', relatedAddressCount: 30, links: {} },
      { buildingId: 'tieA', relatedAddressCount: 5, links: {} },
      { buildingId: 'tieB', relatedAddressCount: 5, links: {} },
      { buildingId: 'big', relatedAddressCount: 70, links: {} },
    ]
    expect(rankBuildingSummaries(s).map((x) => x.buildingId)).toEqual(['tieA', 'tieB', 'mid', 'big'])
  })
  it('does not mutate the input', () => {
    const s: BuildingSummary[] = [
      { buildingId: 'b', relatedAddressCount: 9, links: {} },
      { buildingId: 'a', relatedAddressCount: 1, links: {} },
    ]
    rankBuildingSummaries(s)
    expect(s[0].buildingId).toBe('b')
  })
})

describe('constants', () => {
  it('bounds building count and secondary-structure size', () => {
    expect(MAX_BUILDINGS).toBeGreaterThanOrEqual(2)
    expect(SECONDARY_MIN_AREA_M2).toBeGreaterThan(0)
    expect(polygonAreaM2({ type: 'Polygon', coordinates: SMALL })).toBeGreaterThan(SECONDARY_MIN_AREA_M2)
  })
})

describe('GeoscapeProvider.measureAll — two separate buildings at one address', () => {
  function fetchTwoBuildings() {
    return vi.fn().mockImplementation((url: RequestInfo | URL) => {
      const s = String(url)
      if (s.includes('/addresses?')) {
        return Promise.resolve(new Response(JSON.stringify({ data: [{ addressId: 'a1' }] }), { status: 200 }))
      }
      if (s.includes('/buildings?addressId')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: [
            { buildingId: 'house', relatedAddressIds: ['a1'], links: {
              footprint2d: '/v1/buildings/house/footprint2d', roofShape: '/v1/buildings/house/roofShape',
              estimatedLevels: '/v1/buildings/house/estimatedLevels', area: '/v1/buildings/house/area' } },
            { buildingId: 'shed', relatedAddressIds: ['a1', 'a2', 'a3', 'a4', 'a5'], links: {
              footprint2d: '/v1/buildings/shed/footprint2d', roofShape: '/v1/buildings/shed/roofShape',
              estimatedLevels: '/v1/buildings/shed/estimatedLevels', area: '/v1/buildings/shed/area' } },
          ],
        }), { status: 200 }))
      }
      if (s.includes('/buildings/house/')) {
        if (s.endsWith('/footprint2d')) return Promise.resolve(new Response(JSON.stringify({ coordinates: BIG }), { status: 200 }))
        if (s.endsWith('/roofShape')) return Promise.resolve(new Response(JSON.stringify({ roofShape: 'hip' }), { status: 200 }))
        if (s.endsWith('/estimatedLevels')) return Promise.resolve(new Response(JSON.stringify({ estimatedLevels: 1 }), { status: 200 }))
        if (s.endsWith('/area')) return Promise.resolve(new Response(JSON.stringify({ area: 400 }), { status: 200 }))
      }
      if (s.includes('/buildings/shed/')) {
        if (s.endsWith('/footprint2d')) return Promise.resolve(new Response(JSON.stringify({ coordinates: SMALL }), { status: 200 }))
        if (s.endsWith('/roofShape')) return Promise.resolve(new Response(JSON.stringify({ roofShape: 'gable' }), { status: 200 }))
        if (s.endsWith('/estimatedLevels')) return Promise.resolve(new Response(JSON.stringify({ estimatedLevels: 1 }), { status: 200 }))
        if (s.endsWith('/area')) return Promise.resolve(new Response(JSON.stringify({ area: 100 }), { status: 200 }))
      }
      return Promise.resolve(new Response('miss', { status: 404 }))
    })
  }

  it('returns both structures with primary + secondary roles and stable buildingIds', async () => {
    const p = new GeoscapeProvider({ apiKey: 'fake', fetchImpl: fetchTwoBuildings() })
    const r = await p.measureAll({ address: '1 Test St', postcode: '2000', state: 'NSW' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.buildings).toHaveLength(2)
      const primary = r.buildings.find((b) => b.role === 'primary')!
      const secondary = r.buildings.find((b) => b.role === 'secondary')!
      expect(primary.buildingId).toBe('house') // fewest related addresses → primary
      expect(primary.metrics.footprint_m2).toBe(400)
      expect(secondary.buildingId).toBe('shed')
      expect(secondary.metrics.footprint_m2).toBe(100)
      expect(primary.metrics.buildingId).toBe('house') // surfaced onto the metrics too
    }
  })
})

describe('GeoscapeProvider.measureAll — one building, MultiPolygon footprint (house + shed)', () => {
  it('splits the extra footprint polygon out as a secondary structure', async () => {
    const fetchImpl = vi.fn().mockImplementation((url: RequestInfo | URL) => {
      const s = String(url)
      if (s.includes('/addresses?')) {
        return Promise.resolve(new Response(JSON.stringify({ data: [{ addressId: 'a1' }] }), { status: 200 }))
      }
      if (s.includes('/buildings?addressId')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: [{ buildingId: 'b1', relatedAddressIds: ['a1'], links: {
            footprint2d: '/v1/buildings/b1/footprint2d', roofShape: '/v1/buildings/b1/roofShape',
            estimatedLevels: '/v1/buildings/b1/estimatedLevels', area: '/v1/buildings/b1/area' } }],
        }), { status: 200 }))
      }
      if (s.endsWith('/footprint2d')) return Promise.resolve(new Response(JSON.stringify({ coordinates: [BIG, SMALL] }), { status: 200 }))
      if (s.endsWith('/roofShape')) return Promise.resolve(new Response(JSON.stringify({ roofShape: 'hip' }), { status: 200 }))
      if (s.endsWith('/estimatedLevels')) return Promise.resolve(new Response(JSON.stringify({ estimatedLevels: 1 }), { status: 200 }))
      if (s.endsWith('/area')) return Promise.resolve(new Response(JSON.stringify({ area: 400 }), { status: 200 }))
      return Promise.resolve(new Response('miss', { status: 404 }))
    })
    const p = new GeoscapeProvider({ apiKey: 'fake', fetchImpl })
    const r = await p.measureAll({ address: '1 Test St', postcode: '2000', state: 'NSW' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.buildings).toHaveLength(2)
      expect(r.buildings[0].role).toBe('primary')
      expect(r.buildings[0].metrics.footprint_m2).toBe(400) // largest sub-polygon
      expect(r.buildings[1].role).toBe('secondary')
      expect(r.buildings[1].buildingId).toBe('b1#1') // synthetic sub-polygon id
      expect(r.buildings[1].metrics.footprint_m2).toBeGreaterThan(90)
      expect(r.buildings[1].metrics.footprint_m2).toBeLessThan(110)
    }
  })

  it('throws on empty address, returns provider_unavailable without a key', async () => {
    const p = new GeoscapeProvider({ apiKey: 'fake' })
    await expect(p.measureAll({ address: '', postcode: '2000', state: 'NSW' })).rejects.toThrow(/address is required/)
    const noKey = new GeoscapeProvider({ apiKey: '', fetchImpl: vi.fn() as never })
    const r = await noKey.measureAll({ address: '1 Test St', postcode: '2000', state: 'NSW' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('provider_unavailable')
  })
})
