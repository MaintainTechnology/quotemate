import { describe, expect, it } from 'vitest'
import {
  SolarPropertyProvider,
  parseFootprintM2,
  parseGeocode,
  parseImageryDate,
} from './solar'
import type { PaintAddressInput } from '../types'

const ADDR: PaintAddressInput = { address: '28 Greens Rd, Coorparoo', postcode: '4151', state: 'QLD' }

/** Build a fetch impl that returns canned geocode + solar responses by URL. */
function makeFetch(opts: {
  geocode: unknown
  solar: { status: number; body: unknown }
}) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input)
    if (url.includes('/geocode/')) {
      return { ok: true, status: 200, json: async () => opts.geocode } as unknown as Response
    }
    // buildingInsights
    return {
      ok: opts.solar.status >= 200 && opts.solar.status < 300,
      status: opts.solar.status,
      json: async () => opts.solar.body,
    } as unknown as Response
  }
}

const OK_GEOCODE = {
  status: 'OK',
  results: [{ geometry: { location: { lat: -27.5, lng: 153.06 } } }],
}

const OK_SOLAR = {
  imageryDate: { year: 2023, month: 5, day: 1 },
  solarPotential: { wholeRoofStats: { groundAreaMeters2: 182.4, areaMeters2: 205.1 } },
}

describe('parseGeocode', () => {
  it('extracts lat/lng from an OK response', () => {
    const r = parseGeocode(OK_GEOCODE)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.location).toEqual({ lat: -27.5, lng: 153.06 })
  })

  it('fails on ZERO_RESULTS', () => {
    const r = parseGeocode({ status: 'ZERO_RESULTS', results: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe('ZERO_RESULTS')
  })

  it('fails when the location is missing', () => {
    const r = parseGeocode({ status: 'OK', results: [{ geometry: {} }] })
    expect(r.ok).toBe(false)
  })
})

describe('parseFootprintM2', () => {
  it('prefers the ground-projected roof area', () => {
    expect(parseFootprintM2(OK_SOLAR)).toBe(182.4)
  })

  it('falls back to buildingStats.groundAreaMeters2', () => {
    expect(
      parseFootprintM2({ solarPotential: { buildingStats: { groundAreaMeters2: 150 } } }),
    ).toBe(150)
  })

  it('falls back to roof areaMeters2 only as a last resort', () => {
    expect(parseFootprintM2({ solarPotential: { wholeRoofStats: { areaMeters2: 210 } } })).toBe(210)
  })

  it('returns null when there is no usable area', () => {
    expect(parseFootprintM2({ solarPotential: {} })).toBeNull()
    expect(parseFootprintM2(null)).toBeNull()
  })
})

describe('parseImageryDate', () => {
  it('formats YYYY-MM', () => {
    expect(parseImageryDate(OK_SOLAR)).toBe('2023-05')
  })
  it('returns null when absent', () => {
    expect(parseImageryDate({})).toBeNull()
  })
})

describe('SolarPropertyProvider.lookup', () => {
  it('returns a footprint fact on the happy path', async () => {
    const p = new SolarPropertyProvider({
      apiKey: 'test-key',
      fetchImpl: makeFetch({ geocode: OK_GEOCODE, solar: { status: 200, body: OK_SOLAR } }),
    })
    const r = await p.lookup(ADDR)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.facts.footprint_m2).toBe(182) // rounded
      expect(r.facts.source).toBe('solar')
      expect(r.facts.storeys).toBeNull() // Solar can't infer storeys
      expect(r.warnings.length).toBeGreaterThan(0)
    }
  })

  it('fails address_not_resolved when geocoding finds nothing', async () => {
    const p = new SolarPropertyProvider({
      apiKey: 'test-key',
      fetchImpl: makeFetch({ geocode: { status: 'ZERO_RESULTS', results: [] }, solar: { status: 200, body: OK_SOLAR } }),
    })
    const r = await p.lookup(ADDR)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('address_not_resolved')
  })

  it('maps a Solar 404 to no_data_for_address', async () => {
    const p = new SolarPropertyProvider({
      apiKey: 'test-key',
      fetchImpl: makeFetch({ geocode: OK_GEOCODE, solar: { status: 404, body: { error: { message: 'NOT_FOUND' } } } }),
    })
    const r = await p.lookup(ADDR)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('no_data_for_address')
  })

  it('fails provider_unavailable when no API key is available', async () => {
    const saved = process.env.GOOGLE_MAPS_API_KEY
    delete process.env.GOOGLE_MAPS_API_KEY
    try {
      const p = new SolarPropertyProvider({
        fetchImpl: makeFetch({ geocode: OK_GEOCODE, solar: { status: 200, body: OK_SOLAR } }),
      })
      const r = await p.lookup(ADDR)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('provider_unavailable')
    } finally {
      if (saved !== undefined) process.env.GOOGLE_MAPS_API_KEY = saved
    }
  })
})
