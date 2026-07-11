// Spec quote-visual-parity R6 (interactive follow-up) — pure conversion of the
// AI layout plan into MapLibre-ready GeoJSON: tint fills, casing+colour lines
// (structure outlines, dilated perimeter rings, ridge lines), point markers.
// Geographic coordinates, so pan/zoom/rotate need no re-projection.

import { describe, it, expect } from 'vitest'
import { layoutPlanGeoJson } from './layout-geojson'
import { ZONE_COLOR_HEX } from './layout-plan'
import type { GeoJSONPolygon } from './types'

const CENTER = { lat: -27.47, lng: 153.02 }
const D = 0.0001
const square: GeoJSONPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [CENTER.lng - D, CENTER.lat - D],
      [CENTER.lng + D, CENTER.lat - D],
      [CENTER.lng + D, CENTER.lat + D],
      [CENTER.lng - D, CENTER.lat + D],
      [CENTER.lng - D, CENTER.lat - D],
    ],
  ],
}
const structures = [{ polygon: square, form: 'hip' as const }]

describe('layoutPlanGeoJson', () => {
  it('produces a tint fill for each zoned structure and one line feature per border zone', () => {
    const g = layoutPlanGeoJson({
      zones: [
        { color: 'teal', label: 'Re-sheet', placement: 'structure', structureIndex: 1 },
        { color: 'red', label: 'Scaffolding', placement: 'perimeter', structureIndex: 1 },
        { color: 'black', label: 'Whirlybirds', placement: 'ridge', structureIndex: 1 },
      ],
      structures,
    })
    expect(g.tints.features).toHaveLength(1)
    expect(g.tints.features[0].geometry.type).toBe('Polygon')
    const colors = g.lines.features.map((f) => f.properties.color)
    expect(colors).toContain(ZONE_COLOR_HEX.teal)
    expect(colors).toContain(ZONE_COLOR_HEX.red)
    expect(colors).toContain(ZONE_COLOR_HEX.black)
    // The perimeter ring is dashed and sits OUTSIDE the footprint.
    const perimeter = g.lines.features.find((f) => f.properties.color === ZONE_COLOR_HEX.red)!
    expect(perimeter.properties.dash).toBe(1)
    const ringLngs = (perimeter.geometry.coordinates as number[][]).map((c) => c[0])
    expect(Math.max(...ringLngs)).toBeGreaterThan(CENTER.lng + D)
    // Structure outline is solid.
    const outline = g.lines.features.find((f) => f.properties.color === ZONE_COLOR_HEX.teal)!
    expect(outline.properties.dash).toBe(0)
  })

  it('stacked structure zones inset inward so both colours stay visible', () => {
    const g = layoutPlanGeoJson({
      zones: [
        { color: 'teal', label: 'A', placement: 'structure', structureIndex: 1 },
        { color: 'black', label: 'B', placement: 'structure', structureIndex: 1 },
      ],
      structures,
    })
    const teal = g.lines.features.find((f) => f.properties.color === ZONE_COLOR_HEX.teal)!
    const black = g.lines.features.find((f) => f.properties.color === ZONE_COLOR_HEX.black)!
    const width = (ring: number[][]) => Math.max(...ring.map((c) => c[0])) - Math.min(...ring.map((c) => c[0]))
    expect(width(black.geometry.coordinates as number[][])).toBeLessThan(
      width(teal.geometry.coordinates as number[][]),
    )
  })

  it('point zones become clamped point features in the zone colour', () => {
    const g = layoutPlanGeoJson({
      zones: [
        { color: 'green', label: 'Solar', placement: 'point', structureIndex: 1, x_pct: 0, y_pct: 0 },
      ],
      structures,
    })
    expect(g.points.features).toHaveLength(1)
    const [lng, lat] = g.points.features[0].geometry.coordinates as [number, number]
    // Clamped inside the structure bbox despite the (0,0) canvas position.
    expect(lng).toBeGreaterThanOrEqual(CENTER.lng - D)
    expect(lng).toBeLessThanOrEqual(CENTER.lng + D)
    expect(lat).toBeGreaterThanOrEqual(CENTER.lat - D)
    expect(lat).toBeLessThanOrEqual(CENTER.lat + D)
    expect(g.points.features[0].properties.color).toBe(ZONE_COLOR_HEX.green)
  })

  it('skips zones whose structure has no geometry; empty input → empty collections', () => {
    const g = layoutPlanGeoJson({
      zones: [{ color: 'teal', label: 'A', placement: 'structure', structureIndex: 1 }],
      structures: [{ polygon: null, form: 'hip' }],
    })
    expect(g.lines.features).toHaveLength(0)
    expect(g.tints.features).toHaveLength(0)
    expect(g.points.features).toHaveLength(0)
  })
})
