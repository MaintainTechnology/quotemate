import { describe, it, expect } from 'vitest'
import {
  detectPropertyBuildings,
  mapMeasuredBuildings,
  labelForBuilding,
  polygonCentroid,
  OUTBUILDING_MAX_AREA_M2,
} from './buildings'
import type {
  GeoJSONPolygon,
  RoofMeasuredBuilding,
  RoofMetrics,
  RoofingMultiMeasurementResult,
} from '../roofing/types'
import type { SolarAddressInput } from './types'

// ── fixtures ──────────────────────────────────────────────────────────

/** Axis-aligned ~square footprint near Sydney; centroid ≈ (lat0, lng0). */
function square(lat0: number, lng0: number, d = 0.0005): GeoJSONPolygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng0 - d, lat0 - d],
        [lng0 + d, lat0 - d],
        [lng0 + d, lat0 + d],
        [lng0 - d, lat0 + d],
        [lng0 - d, lat0 - d],
      ],
    ],
  }
}

function metrics(over: Partial<RoofMetrics> = {}): RoofMetrics {
  return {
    footprint_m2: 180,
    sloped_area_m2: 200,
    storeys: 1,
    form: 'hip',
    hips: null,
    valleys: null,
    ridge_lm: null,
    polygon_geojson: square(-33.8, 151.2),
    capture_date: null,
    ...over,
  }
}

function measured(over: Partial<RoofMeasuredBuilding> = {}): RoofMeasuredBuilding {
  return { buildingId: 'bld-1', role: 'primary', metrics: metrics(), ...over }
}

const ADDR: SolarAddressInput = {
  address: '1 Test St, Sydney',
  postcode: '2000',
  state: 'NSW',
}

// ── polygonCentroid ───────────────────────────────────────────────────

describe('polygonCentroid', () => {
  it('returns the centre of a square footprint', () => {
    const c = polygonCentroid(square(-33.8, 151.2))
    expect(c).not.toBeNull()
    expect(c!.lat).toBeCloseTo(-33.8, 4)
    expect(c!.lng).toBeCloseTo(151.2, 4)
  })

  it('keeps an irregular Chandler roof centroid inside the footprint bbox', () => {
    const roof: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [[
        [153.162290561, -27.502202762],
        [153.162530794, -27.502237321],
        [153.162535956, -27.502208777],
        [153.162555881, -27.502098659],
        [153.162315648, -27.5020641],
        [153.162295723, -27.502174219],
        [153.162290561, -27.502202762],
      ]],
    }
    const c = polygonCentroid(roof)
    expect(c).not.toBeNull()
    expect(c!.lat).toBeGreaterThanOrEqual(-27.502237321)
    expect(c!.lat).toBeLessThanOrEqual(-27.5020641)
    expect(c!.lng).toBeGreaterThanOrEqual(153.162290561)
    expect(c!.lng).toBeLessThanOrEqual(153.162555881)
    expect(c!.lat).toBeCloseTo(-27.5021507, 6)
    expect(c!.lng).toBeCloseTo(153.1624232, 6)
  })

  it('returns null for a null polygon or a degenerate ring', () => {
    expect(polygonCentroid(null)).toBeNull()
    expect(
      polygonCentroid({ type: 'Polygon', coordinates: [[[151, -33]]] }),
    ).toBeNull()
  })
})

// ── labelForBuilding ──────────────────────────────────────────────────

describe('labelForBuilding', () => {
  it('labels the primary structure the main building', () => {
    expect(labelForBuilding({ role: 'primary', areaM2: 200, secondaryIndex: 0 })).toBe(
      'Main building',
    )
  })

  it('labels a small secondary an outbuilding', () => {
    expect(
      labelForBuilding({
        role: 'secondary',
        areaM2: OUTBUILDING_MAX_AREA_M2 - 1,
        secondaryIndex: 1,
      }),
    ).toBe('Outbuilding 1')
  })

  it('labels a large secondary a numbered secondary building', () => {
    expect(
      labelForBuilding({ role: 'secondary', areaM2: 120, secondaryIndex: 2 }),
    ).toBe('Secondary building 2')
  })
})

// ── mapMeasuredBuildings ──────────────────────────────────────────────

describe('mapMeasuredBuildings', () => {
  it('maps a primary + secondary into DetectedBuilding[] with contiguous numbering', () => {
    const out = mapMeasuredBuildings([
      measured({ buildingId: 'bld-house', role: 'primary' }),
      measured({
        buildingId: 'bld-shed',
        role: 'secondary',
        metrics: metrics({ footprint_m2: 25, polygon_geojson: square(-33.801, 151.201), form: 'skillion', storeys: 1 }),
      }),
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      building_id: 'bld-house',
      role: 'primary',
      label: 'Main building',
      area_m2: 180,
      roof_shape: 'hip',
      solar_status: 'pending',
    })
    expect(out[0].centroid.lat).toBeCloseTo(-33.8, 3)
    expect(out[1]).toMatchObject({
      building_id: 'bld-shed',
      role: 'secondary',
      label: 'Outbuilding 1',
      area_m2: 25,
      roof_shape: 'skillion',
    })
  })

  it('drops structures that have no footprint polygon (no centroid to query)', () => {
    const out = mapMeasuredBuildings([
      measured({ buildingId: 'ok', role: 'primary' }),
      measured({
        buildingId: 'nogeo',
        role: 'secondary',
        metrics: metrics({ polygon_geojson: null }),
      }),
    ])
    expect(out.map((b) => b.building_id)).toEqual(['ok'])
  })

  it('falls back to a synthetic id when the provider omits buildingId', () => {
    const out = mapMeasuredBuildings([
      measured({ buildingId: null, role: 'primary', metrics: metrics({ buildingId: null }) }),
    ])
    expect(out[0].building_id).toBe('b0')
  })
})

// ── detectPropertyBuildings (injected provider) ───────────────────────

describe('detectPropertyBuildings', () => {
  it('maps a successful multi-structure measurement', async () => {
    const result: RoofingMultiMeasurementResult = {
      ok: true,
      provider: 'geoscape',
      warnings: [],
      buildings: [measured({ role: 'primary' }), measured({ buildingId: 'bld-2', role: 'secondary' })],
    }
    const out = await detectPropertyBuildings(ADDR, { measureAll: async () => result })
    expect(out).toHaveLength(2)
    expect(out[0].role).toBe('primary')
  })

  it('returns [] when the provider reports a failure', async () => {
    const out = await detectPropertyBuildings(ADDR, {
      measureAll: async () => ({ ok: false, code: 'provider_unavailable', detail: 'no key' }),
    })
    expect(out).toEqual([])
  })

  it('returns [] when the provider throws', async () => {
    const out = await detectPropertyBuildings(ADDR, {
      measureAll: async () => {
        throw new Error('network down')
      },
    })
    expect(out).toEqual([])
  })
})
