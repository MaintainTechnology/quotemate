import { describe, it, expect } from 'vitest'
import {
  mercatorWorldPx,
  projectLatLngToImagePct,
  imagePctToLatLng,
  polygonToImagePctPath,
  type StaticMapParams,
} from './project-latlng'
import type { GeoJSONPolygon } from '../roofing/types'

const SYD = { lat: -33.8688, lng: 151.2093 }

// The framing the /api/solar/q/[token]/static-map route renders with:
// centre on the roof, zoom 20, 640×480, scale 2.
const MAP: StaticMapParams = {
  center: SYD,
  zoom: 20,
  width: 640,
  height: 480,
  scale: 2,
}

describe('projectLatLngToImagePct', () => {
  it('projects the map centre to ~50% / 50%', () => {
    const p = projectLatLngToImagePct(SYD, MAP)
    expect(p.x_pct).toBeCloseTo(50, 6)
    expect(p.y_pct).toBeCloseTo(50, 6)
  })

  it('a point one tile east at the given zoom moves to the right', () => {
    // One 256-px tile east in world space = 360 / 2^zoom degrees of lng.
    const tileLngDeg = 360 / 2 ** MAP.zoom
    const east = { lat: SYD.lat, lng: SYD.lng + tileLngDeg }
    const p = projectLatLngToImagePct(east, MAP)
    expect(p.x_pct).toBeGreaterThan(50)
    // y unchanged (same latitude).
    expect(p.y_pct).toBeCloseTo(50, 6)
  })

  it('a point north moves up (smaller y%)', () => {
    const north = { lat: SYD.lat + 0.0001, lng: SYD.lng }
    const p = projectLatLngToImagePct(north, MAP)
    expect(p.y_pct).toBeLessThan(50)
  })

  it('percentages are scale-invariant', () => {
    const east = { lat: SYD.lat, lng: SYD.lng + 0.00005 }
    const a = projectLatLngToImagePct(east, { ...MAP, scale: 1 })
    const b = projectLatLngToImagePct(east, { ...MAP, scale: 2 })
    expect(a.x_pct).toBeCloseTo(b.x_pct, 9)
    expect(a.y_pct).toBeCloseTo(b.y_pct, 9)
  })
})

describe('imagePctToLatLng (inverse of projectLatLngToImagePct)', () => {
  it('the image centre (50%/50%) maps back to the map centre', () => {
    const ll = imagePctToLatLng({ x_pct: 50, y_pct: 50 }, MAP)
    expect(ll.lat).toBeCloseTo(SYD.lat, 9)
    expect(ll.lng).toBeCloseTo(SYD.lng, 9)
  })

  it('round-trips: project a point then un-project returns the same point', () => {
    const cases = [
      { map: MAP, pt: { lat: SYD.lat + 0.0002, lng: SYD.lng - 0.0003 } },
      { map: MAP, pt: { lat: SYD.lat - 0.00015, lng: SYD.lng + 0.00025 } },
      // Brisbane centre — a different latitude band, to exercise the mercator y.
      { map: { ...MAP, center: { lat: -27.47, lng: 153.02 } }, pt: { lat: -27.4698, lng: 153.0251 } },
    ]
    for (const { map, pt } of cases) {
      const back = imagePctToLatLng(projectLatLngToImagePct(pt, map), map)
      expect(back.lat).toBeCloseTo(pt.lat, 7)
      expect(back.lng).toBeCloseTo(pt.lng, 7)
    }
  })

  it('a tap right of centre resolves to a larger longitude (further east)', () => {
    const ll = imagePctToLatLng({ x_pct: 75, y_pct: 50 }, MAP)
    expect(ll.lng).toBeGreaterThan(SYD.lng)
    expect(ll.lat).toBeCloseTo(SYD.lat, 6)
  })

  it('a tap above centre resolves to a larger latitude (further north)', () => {
    const ll = imagePctToLatLng({ x_pct: 50, y_pct: 25 }, MAP)
    expect(ll.lat).toBeGreaterThan(SYD.lat)
    expect(ll.lng).toBeCloseTo(SYD.lng, 6)
  })
})

describe('mercatorWorldPx', () => {
  it('lat 0 / lng 0 is the world centre at zoom 0 (128,128)', () => {
    const p = mercatorWorldPx({ lat: 0, lng: 0 }, 0)
    expect(p.x).toBeCloseTo(128, 6)
    expect(p.y).toBeCloseTo(128, 6)
  })
})

describe('polygonToImagePctPath', () => {
  it('a small square footprint yields 4 finite points within/near 0–100', () => {
    // ~11 m square around the Sydney centre (0.0001° ≈ 11 m).
    const d = 0.0001
    const poly: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [SYD.lng - d, SYD.lat - d],
          [SYD.lng + d, SYD.lat - d],
          [SYD.lng + d, SYD.lat + d],
          [SYD.lng - d, SYD.lat + d],
        ],
      ],
    }
    const path = polygonToImagePctPath(poly, MAP)
    expect(path).toHaveLength(4)
    for (const pt of path) {
      expect(Number.isFinite(pt.x_pct)).toBe(true)
      expect(Number.isFinite(pt.y_pct)).toBe(true)
      // A small footprint near centre stays comfortably on-image.
      expect(pt.x_pct).toBeGreaterThan(-10)
      expect(pt.x_pct).toBeLessThan(110)
      expect(pt.y_pct).toBeGreaterThan(-10)
      expect(pt.y_pct).toBeLessThan(110)
    }
    // The square is centred → its mean is ~50/50.
    const meanX = path.reduce((s, p) => s + p.x_pct, 0) / path.length
    const meanY = path.reduce((s, p) => s + p.y_pct, 0) / path.length
    expect(meanX).toBeCloseTo(50, 4)
    expect(meanY).toBeCloseTo(50, 4)
  })

  it('returns [] for a null / empty polygon', () => {
    expect(polygonToImagePctPath(null, MAP)).toEqual([])
    expect(polygonToImagePctPath({ type: 'Polygon', coordinates: [] }, MAP)).toEqual([])
  })

  it('skips non-finite vertices rather than emitting NaN points', () => {
    const poly: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [SYD.lng, SYD.lat],
          [Number.NaN, SYD.lat],
          [SYD.lng + 0.0001, SYD.lat + 0.0001],
        ],
      ],
    }
    const path = polygonToImagePctPath(poly, MAP)
    expect(path).toHaveLength(2)
    for (const pt of path) {
      expect(Number.isFinite(pt.x_pct)).toBe(true)
      expect(Number.isFinite(pt.y_pct)).toBe(true)
    }
  })
})
