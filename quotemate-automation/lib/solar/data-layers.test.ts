import { describe, it, expect } from 'vitest'
import { fetchSolarDataLayers, parseDataLayersResponse } from './data-layers'

const META = { radius: 50, pixelSize: 0.5, view: 'FULL_LAYERS' }

// A trimmed Google Solar dataLayers:get success body.
const OK_BODY = {
  imageryDate: { year: 2024, month: 3, day: 7 },
  imageryProcessedDate: { year: 2024, month: 4, day: 1 },
  dsmUrl: 'https://solar.googleapis.com/v1/geoTiff:get?id=dsm',
  rgbUrl: 'https://solar.googleapis.com/v1/geoTiff:get?id=rgb',
  maskUrl: 'https://solar.googleapis.com/v1/geoTiff:get?id=mask',
  annualFluxUrl: 'https://solar.googleapis.com/v1/geoTiff:get?id=annual',
  monthlyFluxUrl: 'https://solar.googleapis.com/v1/geoTiff:get?id=monthly',
  hourlyShadeUrls: Array.from({ length: 12 }, (_, i) => `https://x/${i}`),
  imageryQuality: 'HIGH',
}

describe('parseDataLayersResponse', () => {
  it('maps a full body onto an available summary (no GeoTIFF URLs persisted)', () => {
    const s = parseDataLayersResponse(OK_BODY, META)
    expect(s.status).toBe('available')
    expect(s.imagery_quality).toBe('HIGH')
    expect(s.imagery_date).toBe('2024-03-07')
    expect(s.imagery_processed_date).toBe('2024-04-01')
    expect(s.layers).toEqual({
      dsm: true,
      rgb: true,
      mask: true,
      annual_flux: true,
      monthly_flux: true,
      hourly_shade_months: 12,
    })
    expect(s.radius_meters).toBe(50)
    expect(s.pixel_size_meters).toBe(0.5)
    expect(s.view).toBe('FULL_LAYERS')
    // The summary must not leak any signed GeoTIFF URLs.
    expect(JSON.stringify(s)).not.toContain('geoTiff')
  })

  it('records absent layers as false and missing dates as null', () => {
    const s = parseDataLayersResponse({ imageryQuality: 'MEDIUM' }, META)
    expect(s.status).toBe('available')
    expect(s.imagery_quality).toBe('MEDIUM')
    expect(s.imagery_date).toBeNull()
    expect(s.layers.dsm).toBe(false)
    expect(s.layers.hourly_shade_months).toBe(0)
  })

  it('returns unavailable on a non-object body', () => {
    const s = parseDataLayersResponse(null, META)
    expect(s.status).toBe('unavailable')
    expect(s.detail).toBeTruthy()
  })
})

describe('fetchSolarDataLayers', () => {
  it('skips (no fetch) when the key is missing', async () => {
    let called = false
    const fetchImpl = async () => {
      called = true
      return new Response('{}', { status: 200 })
    }
    const s = await fetchSolarDataLayers(
      { lat: -33.8, lng: 151.2 },
      { apiKey: undefined, fetchImpl },
    )
    expect(called).toBe(false)
    expect(s.status).toBe('skipped')
  })

  it('fetches and parses an available summary', async () => {
    let calledUrl = ''
    const fetchImpl = async (u: RequestInfo | URL) => {
      calledUrl = String(u)
      return new Response(JSON.stringify(OK_BODY), { status: 200 })
    }
    const s = await fetchSolarDataLayers(
      { lat: -33.8688, lng: 151.2093 },
      { apiKey: 'KEY', fetchImpl },
    )
    expect(calledUrl).toContain('location.latitude=-33.8688')
    expect(calledUrl).toContain('radiusMeters=50')
    expect(calledUrl).toContain('key=KEY')
    expect(s.status).toBe('available')
    expect(s.imagery_quality).toBe('HIGH')
  })

  it('returns unavailable on a non-2xx response', async () => {
    const fetchImpl = async () => new Response('nope', { status: 500 })
    const s = await fetchSolarDataLayers(
      { lat: 1, lng: 2 },
      { apiKey: 'KEY', fetchImpl },
    )
    expect(s.status).toBe('unavailable')
    expect(s.detail).toContain('500')
  })

  it('returns unavailable on a network error (never throws)', async () => {
    const fetchImpl = async () => {
      throw new Error('boom')
    }
    const s = await fetchSolarDataLayers(
      { lat: 1, lng: 2 },
      { apiKey: 'KEY', fetchImpl },
    )
    expect(s.status).toBe('unavailable')
  })
})
