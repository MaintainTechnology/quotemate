import { describe, it, expect } from 'vitest'
import {
  mercatorWorldPx,
  projectToPixel,
  metersPerPixel,
  segmentColor,
  buildLayoutOverlay,
  OVERLAY_MAP_ZOOM,
  MODULE_GUTTER,
  __test_only__,
} from './layout-overlay'
import type { SolarPanelPlacement, SolarRoofPlane } from './types'

const SYD = { lat: -33.8688, lng: 151.2093 }

function makePanels(n: number, segment = 0): SolarPanelPlacement[] {
  // ~0.124 m/px at Sydney zoom 20 → 0.00002° lng ≈ 1.85 m spacing.
  return Array.from({ length: n }, (_, i) => ({
    center: { lat: SYD.lat, lng: SYD.lng + i * 0.00002 },
    orientation: 'PORTRAIT' as const,
    segment_index: segment,
    yearly_energy_dc_kwh: 550,
  }))
}

const PLANES: SolarRoofPlane[] = [
  { pitch_degrees: 22, azimuth_degrees: 10, area_m2: 60, orientation: 'north' },
  { pitch_degrees: 18, azimuth_degrees: 100, area_m2: 40, orientation: 'east' },
]

const PANEL_SIZE = { height_m: 1.879, width_m: 1.045 }

describe('mercator projection', () => {
  it('world px at zoom 0: lat 0 / lng 0 is the world centre (128,128)', () => {
    const p = mercatorWorldPx({ lat: 0, lng: 0 }, 0)
    expect(p.x).toBeCloseTo(128, 6)
    expect(p.y).toBeCloseTo(128, 6)
  })

  it('lng +180 maps to the right world edge', () => {
    const p = mercatorWorldPx({ lat: 0, lng: 180 }, 0)
    expect(p.x).toBeCloseTo(256, 6)
  })

  it('projectToPixel puts the map centre at the image centre', () => {
    const px = projectToPixel(SYD, SYD)
    expect(px.x).toBeCloseTo(320, 6)
    expect(px.y).toBeCloseTo(240, 6)
  })

  it('a point east of centre lands right of centre; north lands above', () => {
    const east = projectToPixel({ lat: SYD.lat, lng: SYD.lng + 0.0002 }, SYD)
    expect(east.x).toBeGreaterThan(320)
    expect(east.y).toBeCloseTo(240, 4)
    const north = projectToPixel({ lat: SYD.lat + 0.0002, lng: SYD.lng }, SYD)
    expect(north.y).toBeLessThan(240)
  })

  it('pixel offset matches metres ÷ metres-per-pixel (ground truth)', () => {
    // 0.0002° lng at lat -33.8688 ≈ 0.0002 × 111320 × cos(lat) m east.
    const metersEast = 0.0002 * 111320 * Math.cos((SYD.lat * Math.PI) / 180)
    const expectedPx = metersEast / metersPerPixel(SYD.lat, OVERLAY_MAP_ZOOM)
    const px = projectToPixel({ lat: SYD.lat, lng: SYD.lng + 0.0002 }, SYD)
    expect(px.x - 320).toBeCloseTo(expectedPx, 1)
  })

  it('metersPerPixel: equator zoom 0 equals the Web-Mercator constant', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(__test_only__.EARTH_METERS_PER_PX_Z0, 3)
  })

  it('metersPerPixel shrinks with latitude (cos correction)', () => {
    expect(metersPerPixel(SYD.lat, 20)).toBeLessThan(metersPerPixel(0, 20))
    expect(metersPerPixel(SYD.lat, 20)).toBeCloseTo(0.124, 2)
  })
})

describe('segmentColor', () => {
  it('cycles the palette deterministically', () => {
    const n = __test_only__.SEGMENT_PALETTE.length
    expect(segmentColor(0)).toBe(__test_only__.SEGMENT_PALETTE[0])
    expect(segmentColor(n)).toBe(__test_only__.SEGMENT_PALETTE[0])
    expect(segmentColor(3)).toBe(segmentColor(3 + n))
  })
})

describe('buildLayoutOverlay', () => {
  it('draws one rect per panel, capped to panel_limit', () => {
    const out = buildLayoutOverlay({
      panels: makePanels(10),
      panel_size_m: PANEL_SIZE,
      planes: PLANES,
      center: SYD,
      panel_limit: 6,
    })
    expect(out).not.toBeNull()
    expect(out!.panels_drawn).toBe(6)
    expect(out!.svg.match(/<rect /g)?.length).toBe(6)
  })

  it('rotates rectangles to the plane azimuth', () => {
    const out = buildLayoutOverlay({
      panels: makePanels(2, 1), // plane 1: azimuth 100°
      panel_size_m: PANEL_SIZE,
      planes: PLANES,
      center: SYD,
    })
    expect(out!.svg).toContain('rotate(100')
  })

  it('legend groups by segment with plane orientation + pitch labels', () => {
    const panels = [...makePanels(4, 0), ...makePanels(3, 1)]
    const out = buildLayoutOverlay({
      panels,
      panel_size_m: PANEL_SIZE,
      planes: PLANES,
      center: SYD,
    })
    expect(out!.legend).toHaveLength(2)
    expect(out!.legend[0]).toMatchObject({ segment_index: 0, panels_count: 4 })
    expect(out!.legend[0].plane_label).toBe('North · 22°')
    expect(out!.legend[1]).toMatchObject({ segment_index: 1, panels_count: 3 })
    expect(out!.legend[1].color).not.toBe(out!.legend[0].color)
  })

  it('foreshortens the slope dimension by cos(pitch)', () => {
    const flatPlanes: SolarRoofPlane[] = [
      { pitch_degrees: 0, azimuth_degrees: 0, area_m2: 60, orientation: 'flat' },
    ]
    const steepPlanes: SolarRoofPlane[] = [
      { pitch_degrees: 45, azimuth_degrees: 0, area_m2: 60, orientation: 'north' },
    ]
    const flat = buildLayoutOverlay({
      panels: makePanels(1),
      panel_size_m: PANEL_SIZE,
      planes: flatPlanes,
      center: SYD,
    })!
    const steep = buildLayoutOverlay({
      panels: makePanels(1),
      panel_size_m: PANEL_SIZE,
      planes: steepPlanes,
      center: SYD,
    })!
    const heightOf = (svg: string) => Number(/height="([\d.]+)"/.exec(svg.split('<rect')[1])![1])
    // PORTRAIT long side ≈ 1.879 / 0.124 ≈ 15.2 px flat; ×cos45 ≈ 10.7 steep.
    expect(heightOf(steep.svg)).toBeCloseTo(heightOf(flat.svg) * Math.cos(Math.PI / 4), 1)
  })

  it('LANDSCAPE swaps the rectangle axes', () => {
    const landscape: SolarPanelPlacement[] = [
      { center: SYD, orientation: 'LANDSCAPE', segment_index: 0, yearly_energy_dc_kwh: 550 },
    ]
    const flatPlanes: SolarRoofPlane[] = [
      { pitch_degrees: 0, azimuth_degrees: 0, area_m2: 60, orientation: 'flat' },
    ]
    const out = buildLayoutOverlay({
      panels: landscape,
      panel_size_m: PANEL_SIZE,
      planes: flatPlanes,
      center: SYD,
    })!
    const w = Number(/width="([\d.]+)"/.exec(out.svg.split('<rect')[1])![1])
    const h = Number(/height="([\d.]+)"/.exec(out.svg.split('<rect')[1])![1])
    expect(w).toBeGreaterThan(h) // long side horizontal
  })

  it('insets each module by MODULE_GUTTER so neighbours keep a visible gap', () => {
    const flatPlanes: SolarRoofPlane[] = [
      { pitch_degrees: 0, azimuth_degrees: 0, area_m2: 60, orientation: 'flat' },
    ]
    const out = buildLayoutOverlay({
      panels: makePanels(1),
      panel_size_m: PANEL_SIZE,
      planes: flatPlanes,
      center: SYD,
    })!
    const mpp = metersPerPixel(SYD.lat, OVERLAY_MAP_ZOOM)
    const fullShort = PANEL_SIZE.width_m / mpp // PORTRAIT → short side is the width
    const w = Number(/width="([\d.]+)"/.exec(out.svg.split('<rect')[1])![1])
    expect(MODULE_GUTTER).toBeGreaterThan(0)
    expect(MODULE_GUTTER).toBeLessThan(1)
    expect(w).toBeCloseTo(fullShort * MODULE_GUTTER, 1)
    expect(w).toBeLessThan(fullShort) // strictly inset — leaves the walkway gap
  })

  it('renders one crisp white-edged module per panel (no translucent smear)', () => {
    const out = buildLayoutOverlay({
      panels: makePanels(4),
      panel_size_m: PANEL_SIZE,
      planes: PLANES,
      center: SYD,
    })!
    expect(out.svg.match(/<rect /g)?.length).toBe(4) // still one rect per panel
    expect(out.svg).toContain('stroke="#FFFFFF"')
    expect(out.svg).not.toContain('fill-opacity="0.55"') // old smeary style gone
  })

  it('degrades to null: empty panels, missing dimensions, bad centre', () => {
    expect(
      buildLayoutOverlay({ panels: [], panel_size_m: PANEL_SIZE, planes: PLANES, center: SYD }),
    ).toBeNull()
    expect(
      buildLayoutOverlay({
        panels: makePanels(2),
        panel_size_m: null,
        planes: PLANES,
        center: SYD,
      }),
    ).toBeNull()
    expect(
      buildLayoutOverlay({
        panels: makePanels(2),
        panel_size_m: PANEL_SIZE,
        planes: PLANES,
        center: { lat: Number.NaN, lng: 151 },
      }),
    ).toBeNull()
  })

  it('is deterministic — identical input, identical SVG', () => {
    const args = {
      panels: makePanels(5),
      panel_size_m: PANEL_SIZE,
      planes: PLANES,
      center: SYD,
    }
    expect(buildLayoutOverlay(args)!.svg).toBe(buildLayoutOverlay(args)!.svg)
  })
})
