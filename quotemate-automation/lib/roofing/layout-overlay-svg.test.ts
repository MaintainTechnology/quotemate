// Spec specs/quote-visual-parity.md R6d — deterministic colour-coded work-zone
// overlay drawn OVER the Google static-map aerial. Pure SVG string from stored
// polygon geometry + the parsed LayoutPlan zones (Web-Mercator projection
// agreeing with the static map's centre/zoom). No I/O, no AI.

import { describe, it, expect } from 'vitest'
import { buildLayoutOverlaySvg, layoutMapView } from './layout-overlay-svg'
import { ZONE_COLOR_HEX } from './layout-plan'
import type { GeoJSONPolygon } from './types'

// A ~20m square footprint centred on the map centre.
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

const baseArgs = {
  structures,
  center: CENTER,
  zoom: 20,
  width: 640,
  height: 480,
}

describe('buildLayoutOverlaySvg', () => {
  it('draws one coloured element per zone, in the zone colour', () => {
    const svg = buildLayoutOverlaySvg({
      ...baseArgs,
      zones: [
        { color: 'teal', label: 'Re-sheet', placement: 'structure', structureIndex: 1 },
        { color: 'red', label: 'Scaffolding', placement: 'perimeter', structureIndex: 1 },
        { color: 'black', label: 'Whirlybirds to ridgeline', placement: 'ridge', structureIndex: 1 },
      ],
    })
    expect(svg).not.toBeNull()
    expect(svg).toContain('<svg')
    expect(svg).toContain(ZONE_COLOR_HEX.teal)
    expect(svg).toContain(ZONE_COLOR_HEX.red)
    expect(svg).toContain(ZONE_COLOR_HEX.black)
  })

  it('draws no full-canvas background so the aerial shows through', () => {
    const svg = buildLayoutOverlaySvg({
      ...baseArgs,
      zones: [{ color: 'teal', label: 'Re-sheet', placement: 'structure', structureIndex: 1 }],
    })!
    // Label callout boxes are rects, but nothing may span the whole canvas
    // (that would blank out the aerial underneath).
    expect(svg).not.toMatch(/<rect[^>]*width="640"[^>]*height="480"/)
    // The roof tint is translucent, never opaque.
    expect(svg).not.toMatch(new RegExp('fill="#5B7B8C"(?![^/>]*fill-opacity)'))
  })

  it('skips zones pointing at a structure without geometry', () => {
    const svg = buildLayoutOverlaySvg({
      ...baseArgs,
      structures: [{ polygon: null, form: 'hip' as const }],
      zones: [{ color: 'teal', label: 'Re-sheet', placement: 'structure', structureIndex: 1 }],
    })
    expect(svg).toBeNull()
  })

  it('returns null for an empty zone list', () => {
    expect(buildLayoutOverlaySvg({ ...baseArgs, zones: [] })).toBeNull()
  })

  // ── Reference-style rendering (user's roof-layout example) ──────────
  it('tints the zoned structure so it pops from the aerial', () => {
    const svg = buildLayoutOverlaySvg({
      ...baseArgs,
      zones: [{ color: 'teal', label: 'Re-sheet', placement: 'structure', structureIndex: 1 }],
    })!
    // A filled footprint polygon (not just strokes) under the zone lines.
    expect(svg).toMatch(/<polygon[^>]*fill="(?!none)[^"]+"[^>]*fill-opacity/)
  })

  it('renders each zone label as a Command Centre callout: ink card, zone accent bar, mono numbering', () => {
    const svg = buildLayoutOverlaySvg({
      ...baseArgs,
      zones: [
        { color: 'teal', label: 'Install NEW Colorbond sheeting to replace existing.', placement: 'structure', structureIndex: 1 },
        { color: 'red', label: 'Ground up scaffolding for WHS.', placement: 'perimeter', structureIndex: 1 },
      ],
    })!
    // Ink card background (design-system charcoal), not white reference boxes.
    expect(svg).toMatch(/<rect[^>]*fill="#16120F"/)
    // Zone-coloured accent bars (the border-l-accent motif).
    expect(svg).toMatch(new RegExp(`<rect[^>]*fill="${ZONE_COLOR_HEX.teal}"[^>]*data-accent-bar`))
    expect(svg).toMatch(new RegExp(`<rect[^>]*fill="${ZONE_COLOR_HEX.red}"[^>]*data-accent-bar`))
    // Mono uppercase zone numbering ties callouts to the legend below.
    expect(svg).toContain('ZONE 01')
    expect(svg).toContain('ZONE 02')
    // …carrying the (wrapped) label text in off-white ink.
    expect(svg).toContain('Install NEW Colorbond')
    expect(svg).toContain('scaffolding')
    expect(svg).toMatch(/<text[^>]*fill="#F2EDE6"/)
  })

  it('escapes HTML/XML in zone labels rendered into the SVG', () => {
    const svg = buildLayoutOverlaySvg({
      ...baseArgs,
      zones: [{ color: 'teal', label: 'Replace <braced> & flashings', placement: 'structure', structureIndex: 1 }],
    })!
    expect(svg).toContain('&lt;braced&gt;')
    expect(svg).toContain('&amp;')
    expect(svg).not.toContain('<braced>')
  })

  it("draws a 'point' zone as a small marker clamped inside the structure bbox", () => {
    const svg = buildLayoutOverlaySvg({
      ...baseArgs,
      zones: [
        // Model localises the feature way outside the roof (0,0) — the marker
        // must clamp into the structure's projected bounding box.
        { color: 'black', label: 'Remove old solar HW unit', placement: 'point', structureIndex: 1, x_pct: 0, y_pct: 0 },
      ],
    })!
    const m = svg.match(/<rect[^>]*data-zone-point[^>]* x="([\d.]+)" y="([\d.]+)"/)
    expect(m).toBeTruthy()
    const x = Number(m![1])
    const y = Number(m![2])
    // The 20m square projects to roughly the canvas centre at zoom 20 —
    // a clamped marker cannot sit at the canvas origin.
    expect(x).toBeGreaterThan(200)
    expect(y).toBeGreaterThan(140)
  })

  it('stacked structure zones stay individually visible via concentric insets', () => {
    // Teal re-sheet + black penetrations both outline structure 1 — the later
    // outline must inset inward instead of painting over the earlier one.
    const svg = buildLayoutOverlaySvg({
      ...baseArgs,
      zones: [
        { color: 'teal', label: 'Re-sheet', placement: 'structure', structureIndex: 1 },
        { color: 'black', label: 'Flash penetrations', placement: 'structure', structureIndex: 1 },
      ],
    })!
    expect(svg).toContain(ZONE_COLOR_HEX.teal)
    expect(svg).toContain(ZONE_COLOR_HEX.black)
    const outlines = [...svg.matchAll(/<polygon points="([^"]+)" fill="none"/g)].map((m) => m[1])
    // 2 zones × (casing + colour) = 4 stroked polygons, in 2 distinct geometries.
    expect(outlines.length).toBe(4)
    expect(new Set(outlines).size).toBe(2)
  })

  it('draws hairline borders — visible but not chunky', () => {
    const svg = buildLayoutOverlaySvg({
      ...baseArgs,
      zones: [{ color: 'teal', label: 'Re-sheet', placement: 'structure', structureIndex: 1 }],
    })!
    const widths = [...svg.matchAll(/stroke-width="([\d.]+)"/g)]
      .map((m) => Number(m[1]))
      .filter((w) => w > 1) // ignore the 1px label-card border
    expect(Math.max(...widths)).toBeLessThanOrEqual(3.5)
  })

  it('projection keeps the on-centre square inside the canvas', () => {
    const svg = buildLayoutOverlaySvg({
      ...baseArgs,
      zones: [{ color: 'teal', label: 'Re-sheet', placement: 'structure', structureIndex: 1 }],
    })!
    // Every projected coordinate should be within the 640×480 viewport.
    const nums = [...svg.matchAll(/points="([^"]+)"/g)]
      .flatMap((m) => m[1].split(' '))
      .flatMap((pair) => pair.split(',').map(Number))
    expect(nums.length).toBeGreaterThan(0)
    for (let i = 0; i < nums.length; i += 2) {
      expect(nums[i]).toBeGreaterThan(0)
      expect(nums[i]).toBeLessThan(640)
      expect(nums[i + 1]).toBeGreaterThan(0)
      expect(nums[i + 1]).toBeLessThan(480)
    }
  })
})

// Fit-to-geometry view: the Google image and the overlay must share one
// centre + zoom that frames EVERY measured structure.
describe('layoutMapView', () => {
  const squareAt = (lng: number, lat: number, d = 0.0001): GeoJSONPolygon => ({
    type: 'Polygon',
    coordinates: [
      [
        [lng - d, lat - d],
        [lng + d, lat - d],
        [lng + d, lat + d],
        [lng - d, lat + d],
        [lng - d, lat - d],
      ],
    ],
  })

  it('a single small roof keeps the close-up zoom (clamped to 20)', () => {
    const view = layoutMapView([{ polygon: squareAt(153.02, -27.47), form: 'hip' }], { width: 640, height: 480 })!
    expect(view.zoom).toBe(20)
    expect(view.center.lat).toBeCloseTo(-27.47, 4)
    expect(view.center.lng).toBeCloseTo(153.02, 4)
  })

  it('a far-apart second structure zooms out until both fit', () => {
    // ~330m apart — cannot fit in 640×480 at zoom 20 (~0.13 m/px → ~85px per 20m…
    // 330m ≈ 2500px), so the view must zoom out.
    const structures = [
      { polygon: squareAt(153.02, -27.47), form: 'hip' as const },
      { polygon: squareAt(153.023, -27.4715), form: 'gable' as const },
    ]
    const view = layoutMapView(structures, { width: 640, height: 480 })!
    expect(view.zoom).toBeLessThan(20)
    expect(view.zoom).toBeGreaterThanOrEqual(15)
    // Both squares project inside the canvas under the returned view.
    const svg = buildLayoutOverlaySvg({
      zones: [
        { color: 'teal', label: 'A', placement: 'structure', structureIndex: 1 },
        { color: 'green', label: 'B', placement: 'structure', structureIndex: 2 },
      ],
      structures,
      center: view.center,
      zoom: view.zoom,
      width: 640,
      height: 480,
    })!
    const nums = [...svg.matchAll(/<polygon points="([^"]+)" fill="none"/g)]
      .flatMap((m) => m[1].split(' '))
      .flatMap((pair) => pair.split(',').map(Number))
    for (let i = 0; i < nums.length; i += 2) {
      expect(nums[i]).toBeGreaterThanOrEqual(0)
      expect(nums[i]).toBeLessThanOrEqual(640)
      expect(nums[i + 1]).toBeGreaterThanOrEqual(0)
      expect(nums[i + 1]).toBeLessThanOrEqual(480)
    }
  })

  it('returns null when no structure carries geometry', () => {
    expect(layoutMapView([{ polygon: null, form: 'hip' }], { width: 640, height: 480 })).toBeNull()
  })
})
