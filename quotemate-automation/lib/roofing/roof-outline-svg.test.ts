import { describe, expect, it } from 'vitest'
import { buildRoofOutlineSvg, roofOutlineImageSrc, type RoofOutlineStructure } from './roof-outline-svg'
import type { GeoJSONPolygon } from './types'

const OPTS = { width: 1000, height: 750 }

/** A small axis-aligned rectangle near Sydney (closed ring, lng/lat). */
function rect(west: number, south: number, w: number, h: number): GeoJSONPolygon {
  const east = west + w
  const north = south + h
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  }
}

const SQUARE = rect(151.2, -33.8, 0.0006, 0.0005)

/** Pull every "x,y" pair out of the polygon `points=""` attributes. */
function polygonPoints(svg: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const m of svg.matchAll(/points="([^"]+)"/g)) {
    for (const pair of m[1].trim().split(/\s+/)) {
      const [x, y] = pair.split(',').map(Number)
      out.push([x, y])
    }
  }
  return out
}

describe('buildRoofOutlineSvg', () => {
  it('renders a self-contained SVG on a plain white background', () => {
    const svg = buildRoofOutlineSvg([{ polygon: SQUARE, form: 'hip', included: true }], OPTS)!
    expect(svg).toMatch(/^<svg /)
    expect(svg).toContain('viewBox="0 0 1000 750"')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    // A full-canvas white rect = the plain background (no satellite imagery).
    expect(svg).toContain('width="1000" height="750" fill="#FFFFFF"')
    // No embedded raster / remote map tiles — it's a pure vector drawing.
    expect(svg).not.toContain('<image')
    expect(svg).not.toMatch(/googleapis|arcgisonline|staticmap|data:image/)
  })

  it('draws the footprint fill + outline in the accent colour', () => {
    const svg = buildRoofOutlineSvg([{ polygon: SQUARE, form: 'hip', included: true }], OPTS)!
    expect(svg).toContain('<polygon')
    expect(svg).toContain('fill="#FFC400"')
    expect(svg).toContain('fill-opacity="0.18"')
    expect(svg).toContain('stroke="#FFC400"')
  })

  it('colours classified edges per kind, with a dark casing so white eaves read on white', () => {
    // hip ⇒ classifyEdges marks every edge an eave (#FFFFFF).
    const svg = buildRoofOutlineSvg([{ polygon: SQUARE, form: 'hip', included: true }], OPTS)!
    expect(svg).toContain('stroke="#FFFFFF"') // eave edge
    expect(svg).toContain('stroke="#2B2422"') // casing under it (legibility on white)
    expect(svg).toContain('stroke-width="4"')
    expect(svg).toContain('stroke-width="5.5"')
  })

  it('uses the ridge colour on gable ends', () => {
    // gable ⇒ the two longest edges are eaves, the short ends become 'ridge'.
    const wide = rect(151.2, -33.8, 0.0012, 0.0003)
    const svg = buildRoofOutlineSvg([{ polygon: wide, form: 'gable', included: true }], OPTS)!
    expect(svg).toContain('stroke="#FFD23D"') // ridge / gable end
    expect(svg).toContain('stroke="#FFFFFF"') // eave
  })

  it('draws excluded structures faint and dashed, with no classified edges', () => {
    const svg = buildRoofOutlineSvg([{ polygon: SQUARE, form: 'hip', included: false }], OPTS)!
    expect(svg).toContain('stroke-dasharray')
    expect(svg).toContain('#7A8699') // excluded grey
    expect(svg).not.toContain('stroke="#FFFFFF"') // no eave edges for excluded
    expect(svg).not.toContain('#2B2422') // no casing for excluded
  })

  it('places all structures in one shared frame, fully inside the padded canvas', () => {
    const a: RoofOutlineStructure = { polygon: rect(151.2, -33.8, 0.0006, 0.0005), form: 'hip', included: true }
    const b: RoofOutlineStructure = { polygon: rect(151.2015, -33.7994, 0.0004, 0.0004), form: 'hip', included: true }
    const svg = buildRoofOutlineSvg([a, b], OPTS)!
    // Two footprints drawn.
    expect((svg.match(/<polygon/g) ?? []).length).toBe(2)
    // Every projected point is finite and within the canvas bounds.
    const pts = polygonPoints(svg)
    expect(pts.length).toBeGreaterThan(0)
    for (const [x, y] of pts) {
      expect(Number.isFinite(x)).toBe(true)
      expect(Number.isFinite(y)).toBe(true)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(OPTS.width)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(OPTS.height)
    }
  })

  it('preserves aspect ratio (a metre-wide footprint is wider than tall on canvas)', () => {
    // ~0.0012° lng × 0.0003° lat near -33.8°: in metres this is far wider than
    // tall, so the drawn span must be wider than tall too (no stretch-to-fill).
    const wide = rect(151.2, -33.8, 0.0012, 0.0003)
    const svg = buildRoofOutlineSvg([{ polygon: wide, form: 'gable', included: true }], OPTS)!
    const pts = polygonPoints(svg)
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const spanX = Math.max(...xs) - Math.min(...xs)
    const spanY = Math.max(...ys) - Math.min(...ys)
    expect(spanX).toBeGreaterThan(spanY)
  })

  it('returns null when no structure has usable geometry', () => {
    expect(buildRoofOutlineSvg([], OPTS)).toBeNull()
    expect(buildRoofOutlineSvg([{ polygon: null, form: 'hip', included: true }], OPTS)).toBeNull()
    const tooFew: GeoJSONPolygon = { type: 'Polygon', coordinates: [[[151.2, -33.8], [151.2006, -33.8]]] }
    expect(buildRoofOutlineSvg([{ polygon: tooFew, form: 'hip', included: true }], OPTS)).toBeNull()
  })
})

describe('roofOutlineImageSrc', () => {
  it('wraps the SVG as a base64 data URI', () => {
    const src = roofOutlineImageSrc([{ polygon: SQUARE, form: 'hip', included: true }], OPTS)!
    expect(src).toMatch(/^data:image\/svg\+xml;base64,/)
    const decoded = Buffer.from(src.split(',')[1], 'base64').toString('utf8')
    expect(decoded).toMatch(/^<svg /)
  })

  it('returns null when there is no geometry to draw', () => {
    expect(roofOutlineImageSrc([], OPTS)).toBeNull()
  })
})
