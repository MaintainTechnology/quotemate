import { describe, expect, it } from 'vitest'
import { centerForSolarEstimate } from './static-map-center'

describe('centerForSolarEstimate', () => {
  it('reads the first polygon vertex as lat/lng from a GeoJSON ring', () => {
    const center = centerForSolarEstimate({
      roof: {
        polygon_geojson: {
          type: 'Polygon',
          coordinates: [[[151.2093, -33.8688], [151.21, -33.869]]],
        },
      },
    })
    expect(center).toEqual({ lat: -33.8688, lng: 151.2093 })
  })

  it('returns null when there is no polygon (manual fallback)', () => {
    expect(centerForSolarEstimate({ roof: { polygon_geojson: null } })).toBe(null)
  })

  it('returns null when the ring is empty or malformed', () => {
    expect(
      centerForSolarEstimate({
        roof: { polygon_geojson: { type: 'Polygon', coordinates: [[]] } },
      }),
    ).toBe(null)
    expect(
      centerForSolarEstimate({
        roof: { polygon_geojson: { type: 'Polygon', coordinates: [] } },
      }),
    ).toBe(null)
  })

  it('returns null when the vertex is not a numeric pair', () => {
    expect(
      centerForSolarEstimate({
        roof: {
          polygon_geojson: {
            type: 'Polygon',
            coordinates: [[['x' as unknown as number, 'y' as unknown as number]]],
          },
        },
      }),
    ).toBe(null)
  })
})
