import { describe, it, expect } from 'vitest'
import { buildSunContext, sunAssetsEnabled, withApiKey } from './sun-assets'

describe('sunAssetsEnabled', () => {
  it('is on by default when a key exists', () => {
    expect(sunAssetsEnabled({ GOOGLE_SOLAR_API_KEY: 'k' })).toBe(true)
    expect(sunAssetsEnabled({ GOOGLE_MAPS_API_KEY: 'k' })).toBe(true)
  })

  it('is off without any key', () => {
    expect(sunAssetsEnabled({})).toBe(false)
  })

  it('SOLAR_SUN_ASSETS=false switches it off explicitly', () => {
    expect(sunAssetsEnabled({ SOLAR_SUN_ASSETS: 'false', GOOGLE_SOLAR_API_KEY: 'k' })).toBe(false)
    expect(sunAssetsEnabled({ SOLAR_SUN_ASSETS: '0', GOOGLE_SOLAR_API_KEY: 'k' })).toBe(false)
  })
})

describe('withApiKey', () => {
  it('appends &key= to a URL with a query string', () => {
    expect(withApiKey('https://x/geoTiff:get?id=abc', 'K')).toBe(
      'https://x/geoTiff:get?id=abc&key=K',
    )
  })

  it('appends ?key= to a bare URL', () => {
    expect(withApiKey('https://x/file', 'K')).toBe('https://x/file?key=K')
  })

  it('does not double-append when a key is already present', () => {
    const u = 'https://x/geoTiff:get?id=abc&key=already'
    expect(withApiKey(u, 'K')).toBe(u)
  })

  it('URL-encodes the key', () => {
    expect(withApiKey('https://x/f', 'a b')).toBe('https://x/f?key=a%20b')
  })
})

describe('buildSunContext', () => {
  it('assembles a full context.sun object', () => {
    const sun = buildSunContext({
      now: '2026-06-13T00:00:00.000Z',
      fluxImagePath: 'solar/row/flux-annual-1.png',
      flux: {
        png: new Uint8Array([1]),
        width: 4,
        height: 4,
        min_flux: 800,
        max_flux: 1800,
        roof_pixels: 12,
      },
      monthlyWeights: new Array(12).fill(1 / 12),
      shade: {
        hourly_sun_fraction: new Array(24).fill(0.5),
        monthly_midday_sun_fraction: new Array(12).fill(0.9),
        shade_free_start_hour: 9,
        shade_free_end_hour: 15,
        shade_free_hours: 7,
      },
      buildingHeight: { height_m: 6.5, storeys_hint: 2 },
      imageryDate: '2024-03-12',
      planeAnchors: [{ plane_index: 0, x_pct: 42.5, y_pct: 51.2 }],
      fluxBounds: { west: 151.2105, south: -33.8684, east: 151.2115, north: -33.8674 },
    })
    expect(sun.plane_anchors).toEqual([{ plane_index: 0, x_pct: 42.5, y_pct: 51.2 }])
    expect(sun.flux_bounds).toEqual({
      west: 151.2105,
      south: -33.8684,
      east: 151.2115,
      north: -33.8674,
    })
    expect(sun.flux_image_path).toBe('solar/row/flux-annual-1.png')
    expect(sun.min_flux).toBe(800)
    expect(sun.max_flux).toBe(1800)
    expect(sun.monthly_production_weights?.length).toBe(12)
    expect(sun.shade?.shade_free_hours).toBe(7)
    expect(sun.building_height?.storeys_hint).toBe(2)
    expect(sun.imagery_date).toBe('2024-03-12')
  })

  it('nulls every slice independently', () => {
    const sun = buildSunContext({
      now: '2026-06-13T00:00:00.000Z',
      fluxImagePath: null,
      flux: null,
      monthlyWeights: null,
      shade: null,
      buildingHeight: null,
      imageryDate: null,
    })
    expect(sun.flux_image_path).toBeNull()
    expect(sun.min_flux).toBeNull()
    expect(sun.max_flux).toBeNull()
    expect(sun.monthly_production_weights).toBeNull()
    expect(sun.shade).toBeNull()
    expect(sun.building_height).toBeNull()
    expect(sun.imagery_date).toBeNull()
    expect(sun.plane_anchors).toBeNull()
    expect(sun.flux_bounds).toBeNull()
    expect(sun.generated_at).toBe('2026-06-13T00:00:00.000Z')
  })
})
