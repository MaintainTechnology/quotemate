import { describe, it, expect } from 'vitest'
import {
  panelRectangleGeoCorners,
  buildPanelMarkupPaths,
} from './panel-marked-map'
import { buildStaticMapUrl } from '../roofing/google-maps'
import type { SolarPanelPlacement, SolarRoofPlane } from './types'

const SYD = { lat: -33.8688, lng: 151.2093 }
const PANEL_SIZE = { height_m: 1.879, width_m: 1.045 }

function panel(over: Partial<SolarPanelPlacement> = {}): SolarPanelPlacement {
  return {
    center: SYD,
    orientation: 'PORTRAIT',
    segment_index: 0,
    yearly_energy_dc_kwh: 550,
    ...over,
  }
}

const FLAT_PLANE: SolarRoofPlane = {
  pitch_degrees: 0,
  azimuth_degrees: 0,
  area_m2: 80,
  orientation: 'flat',
}

/** Ground distance between two lat/lngs, metres (small-angle). */
function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = (a.lat - b.lat) * 111_320
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot(dLat, dLng)
}

describe('panelRectangleGeoCorners', () => {
  it('flat plane, azimuth 0, PORTRAIT: 1.045 m wide × 1.879 m tall', () => {
    const c = panelRectangleGeoCorners({
      panel: panel(),
      plane: FLAT_PLANE,
      panel_size_m: PANEL_SIZE,
    })!
    expect(c).toHaveLength(4)
    // Top edge length = panel width; side edge = panel height.
    expect(metersBetween(c[0], c[1])).toBeCloseTo(1.045, 2)
    expect(metersBetween(c[1], c[2])).toBeCloseTo(1.879, 2)
    // Centroid stays on the panel centre.
    const cx = c.reduce((a, p) => a + p.lng, 0) / 4
    const cy = c.reduce((a, p) => a + p.lat, 0) / 4
    expect(cx).toBeCloseTo(SYD.lng, 8)
    expect(cy).toBeCloseTo(SYD.lat, 8)
  })

  it('LANDSCAPE swaps the axes', () => {
    const c = panelRectangleGeoCorners({
      panel: panel({ orientation: 'LANDSCAPE' }),
      plane: FLAT_PLANE,
      panel_size_m: PANEL_SIZE,
    })!
    expect(metersBetween(c[0], c[1])).toBeCloseTo(1.879, 2)
    expect(metersBetween(c[1], c[2])).toBeCloseTo(1.045, 2)
  })

  it('pitch foreshortens the slope dimension by cos(pitch)', () => {
    const steep: SolarRoofPlane = { ...FLAT_PLANE, pitch_degrees: 45, orientation: 'north' }
    const c = panelRectangleGeoCorners({
      panel: panel(),
      plane: steep,
      panel_size_m: PANEL_SIZE,
    })!
    expect(metersBetween(c[1], c[2])).toBeCloseTo(1.879 * Math.cos(Math.PI / 4), 2)
    expect(metersBetween(c[0], c[1])).toBeCloseTo(1.045, 2) // across-row unchanged
  })

  it('rotates with the plane azimuth (90° turns the top edge north-south)', () => {
    const east: SolarRoofPlane = { ...FLAT_PLANE, azimuth_degrees: 90, orientation: 'east' }
    const c = panelRectangleGeoCorners({
      panel: panel(),
      plane: east,
      panel_size_m: PANEL_SIZE,
    })!
    // Pre-rotation the top edge ran east-west (Δlng); now it runs
    // north-south (Δlat dominates).
    const dLat = Math.abs(c[0].lat - c[1].lat) * 111_320
    const dLng = Math.abs(c[0].lng - c[1].lng) * 111_320
    expect(dLat).toBeGreaterThan(dLng * 100)
  })

  it('null on unusable dimensions or a bad centre', () => {
    expect(
      panelRectangleGeoCorners({
        panel: panel(),
        plane: FLAT_PLANE,
        panel_size_m: { height_m: 0, width_m: 1 },
      }),
    ).toBeNull()
    expect(
      panelRectangleGeoCorners({
        panel: panel({ center: { lat: Number.NaN, lng: 151 } }),
        plane: FLAT_PLANE,
        panel_size_m: PANEL_SIZE,
      }),
    ).toBeNull()
  })
})

describe('buildPanelMarkupPaths', () => {
  const planes = [FLAT_PLANE]
  const panels = Array.from({ length: 10 }, (_, i) =>
    panel({ center: { lat: SYD.lat, lng: SYD.lng + i * 0.00002 } }),
  )

  it('one closed orange path per panel, capped to the headline tier', () => {
    const paths = buildPanelMarkupPaths({
      panels,
      planes,
      panel_size_m: PANEL_SIZE,
      panel_limit: 6,
    })
    expect(paths).toHaveLength(6)
    for (const p of paths) {
      expect(p.points).toHaveLength(5) // 4 corners + closing point
      expect(p.points[0]).toEqual(p.points[4])
      expect(p.color).toBe('0xFF5F00FF')
      expect(p.fillColor).toBe('0xFF5F0090')
    }
  })

  it('empty when geometry or dimensions are missing (degradation §4.6)', () => {
    expect(
      buildPanelMarkupPaths({ panels: [], planes, panel_size_m: PANEL_SIZE }),
    ).toEqual([])
    expect(
      buildPanelMarkupPaths({ panels, planes, panel_size_m: null }),
    ).toEqual([])
  })

  it('renders into a Static Maps URL via the path params', () => {
    const paths = buildPanelMarkupPaths({
      panels: panels.slice(0, 2),
      planes,
      panel_size_m: PANEL_SIZE,
    })
    const url = buildStaticMapUrl(
      { center: SYD, zoom: 20, size: { width: 640, height: 480 }, paths },
      { apiKey: 'test-key' },
    )
    const parsed = new URL(url)
    const pathParams = parsed.searchParams.getAll('path')
    expect(pathParams).toHaveLength(2)
    expect(pathParams[0]).toContain('color:0xFF5F00FF')
    expect(pathParams[0]).toContain('fillcolor:0xFF5F0090')
    // 5 points, 6-decimal precision.
    expect(pathParams[0].match(/-33\.\d{6},151\.\d{6}/g)?.length).toBe(5)
    // Same centre/zoom/frame as the hero + overlays.
    expect(parsed.searchParams.get('zoom')).toBe('20')
    expect(parsed.searchParams.get('size')).toBe('640x480')
  })

  it('uses the same contiguous-panel selection as the quote overlay when requested', () => {
    const northPlane = FLAT_PLANE
    const eastPlane: SolarRoofPlane = { ...FLAT_PLANE, azimuth_degrees: 90, orientation: 'east' }
    const northPanels = Array.from({ length: 15 }, (_, i) =>
      panel({
        center: { lat: SYD.lat, lng: SYD.lng + i * 0.00002 },
        segment_index: 0,
        yearly_energy_dc_kwh: 550,
      }),
    )
    const eastPanels = Array.from({ length: 2 }, (_, i) =>
      panel({
        center: { lat: SYD.lat + 0.001, lng: SYD.lng + i * 0.00002 },
        segment_index: 1,
        yearly_energy_dc_kwh: 555,
      }),
    )
    const paths = buildPanelMarkupPaths({
      panels: [...northPanels.slice(0, 13), ...eastPanels, ...northPanels.slice(13)],
      planes: [northPlane, eastPlane],
      panel_size_m: PANEL_SIZE,
      panel_limit: 15,
      prefer_contiguous_layout: true,
    })
    expect(paths).toHaveLength(15)
    for (const path of paths) {
      const avgLat = path.points.slice(0, 4).reduce((sum, p) => sum + p.lat, 0) / 4
      expect(avgLat).toBeCloseTo(SYD.lat, 6)
    }
  })
})
