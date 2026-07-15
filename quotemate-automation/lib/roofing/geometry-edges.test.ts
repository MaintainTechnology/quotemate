import { describe, expect, it } from 'vitest'
import {
  edgeStat,
  edgesFromGeometry,
  fillEdgesFromGeometry,
  polygonCornerCounts,
} from './geometry-edges'
import type { GeoJSONPolygon, RoofMetrics } from './types'

// Axis-aligned shapes near Sydney, ~20 m grid steps so every corner is a
// clean 90° turn (well above the collinear threshold).
const X0 = 151.2
const Y0 = -33.8
const S = 0.0002

const RECT: GeoJSONPolygon = {
  type: 'Polygon',
  coordinates: [[
    [X0, Y0],
    [X0 + 2 * S, Y0],
    [X0 + 2 * S, Y0 - 2 * S],
    [X0, Y0 - 2 * S],
    [X0, Y0],
  ]],
}

// L-shape: 6 corners, 5 convex + 1 reflex (the inside corner).
const L_SHAPE: GeoJSONPolygon = {
  type: 'Polygon',
  coordinates: [[
    [X0, Y0],
    [X0 + 2 * S, Y0],
    [X0 + 2 * S, Y0 - 1 * S],
    [X0 + 1 * S, Y0 - 1 * S],
    [X0 + 1 * S, Y0 - 2 * S],
    [X0, Y0 - 2 * S],
    [X0, Y0],
  ]],
}

function metrics(o: Partial<RoofMetrics> = {}): RoofMetrics {
  return {
    footprint_m2: 200,
    sloped_area_m2: 220,
    storeys: 1,
    form: 'unknown',
    hips: null,
    valleys: null,
    ridge_lm: null,
    polygon_geojson: RECT,
    capture_date: null,
    ...o,
  }
}

describe('polygonCornerCounts', () => {
  it('counts 4 convex / 0 reflex for a rectangle', () => {
    expect(polygonCornerCounts(RECT)).toEqual({ convex: 4, reflex: 0 })
  })
  it('counts 5 convex / 1 reflex for an L-shape', () => {
    expect(polygonCornerCounts(L_SHAPE)).toEqual({ convex: 5, reflex: 1 })
  })
  it('returns zeros for a null / degenerate polygon', () => {
    expect(polygonCornerCounts(null)).toEqual({ convex: 0, reflex: 0 })
    expect(polygonCornerCounts({ type: 'Polygon', coordinates: [[[0, 0]]] })).toEqual({ convex: 0, reflex: 0 })
  })
  it('ignores a sub-2m bay-window jog (trace noise) — a notched rectangle still counts as 4 corners', () => {
    const MLAT = 1 / 110574
    const MLNG = 1 / (111320 * Math.cos((Y0 * Math.PI) / 180))
    const bLat = 1.5 * MLAT // ~1.5 m north
    const bLng = 1.5 * MLNG // ~1.5 m east
    const NOTCHED_RECT: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [[
        [X0, Y0],
        [X0 + S, Y0],
        [X0 + S, Y0 + bLat],
        [X0 + S + bLng, Y0 + bLat],
        [X0 + S + bLng, Y0],
        [X0 + 2 * S, Y0],
        [X0 + 2 * S, Y0 - 2 * S],
        [X0, Y0 - 2 * S],
        [X0, Y0],
      ]],
    }
    expect(polygonCornerCounts(NOTCHED_RECT)).toEqual({ convex: 4, reflex: 0 })
  })
})

describe('edgesFromGeometry', () => {
  it('a rectangular hip-able roof → 4 hips, 0 valleys', () => {
    expect(edgesFromGeometry(RECT, 'unknown')).toEqual({ hips: 4, valleys: 0 })
  })
  it('a gable roof has vertical ends → 0 hips', () => {
    expect(edgesFromGeometry(RECT, 'gable')).toEqual({ hips: 0, valleys: 0 })
  })
  it('an L-shaped unknown roof → hips at convex corners, 1 valley at the inside corner', () => {
    expect(edgesFromGeometry(L_SHAPE, 'unknown')).toEqual({ hips: 5, valleys: 1 })
  })
  it('excludes the 2 gable-end convex corners for a gable_hip roof', () => {
    // RECT has 4 convex corners; a gable-hip roof's 2 gable ends are vertical
    // (not hips), so hips = 4 − 2 = 2.
    expect(edgesFromGeometry(RECT, 'gable_hip')).toEqual({ hips: 2, valleys: 0 })
  })
})

describe('fillEdgesFromGeometry', () => {
  it('fills null counts from the footprint polygon', () => {
    const out = fillEdgesFromGeometry(metrics({ hips: null, valleys: null, polygon_geojson: RECT }))
    expect(out.hips).toBe(4)
    expect(out.valleys).toBe(0)
  })
  it('leaves classifier-provided (non-null) counts untouched', () => {
    const out = fillEdgesFromGeometry(metrics({ form: 'hip', hips: 4, valleys: 0, polygon_geojson: L_SHAPE }))
    expect(out.hips).toBe(4)
    expect(out.valleys).toBe(0)
  })
  it('fills only the missing side when one is null', () => {
    const out = fillEdgesFromGeometry(metrics({ hips: 2, valleys: null, polygon_geojson: L_SHAPE }))
    expect(out.hips).toBe(2) // kept
    expect(out.valleys).toBe(1) // filled from geometry
  })
  it('does NOT guess for a complex roof (it routes to inspection)', () => {
    const out = fillEdgesFromGeometry(metrics({ form: 'complex', hips: null, valleys: null, polygon_geojson: L_SHAPE }))
    expect(out.hips).toBeNull()
    expect(out.valleys).toBeNull()
  })
})

describe('edgeStat', () => {
  it('returns filled counts plus derived linear metres', () => {
    const s = edgeStat(metrics({ form: 'unknown', hips: null, valleys: null, footprint_m2: 200 }), 'standard')
    expect(s.hips).toBe(4)
    expect(s.valleys).toBe(0)
    expect(s.hips_lm).toBeGreaterThan(0) // 4 × per-edge length
    expect(s.valleys_lm).toBe(0)
  })
})
