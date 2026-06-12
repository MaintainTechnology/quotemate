import { describe, it, expect } from 'vitest'
import {
  offsetLatLng,
  panelRectangleRing,
  buildPanelLayoutGeoJson,
  buildPlaneMarkersGeoJson,
  buildPropertyPinGeoJson,
  panelLayoutFsl,
  fluxRasterFsl,
  dsmHillshadeFsl,
  planeMarkersFsl,
  feltMapTitle,
  headlinePanelCount,
  __test_only__,
} from './felt-map'
import { COVERED_ROOF_FACTS } from './__fixtures__/building-insights'
import type { SolarEstimate, SolarRoofFacts } from './types'

const CENTER = { lat: -33.8688, lng: 151.2093 }

/** COVERED_ROOF_FACTS extended with per-panel geometry (premium fields). */
const ROOF_WITH_PANELS: SolarRoofFacts = {
  ...COVERED_ROOF_FACTS,
  panels: [
    { center: CENTER, orientation: 'PORTRAIT', segment_index: 0, yearly_energy_dc_kwh: 612.3 },
    {
      center: { lat: CENTER.lat, lng: CENTER.lng + 0.00002 },
      orientation: 'LANDSCAPE',
      segment_index: 0,
      yearly_energy_dc_kwh: 600.1,
    },
    {
      center: { lat: CENTER.lat - 0.0001, lng: CENTER.lng },
      orientation: 'PORTRAIT',
      segment_index: 1,
      yearly_energy_dc_kwh: 420.9,
    },
  ],
  panel_size_m: { height_m: 1.879, width_m: 1.045 },
}

describe('offsetLatLng', () => {
  it('100 m north ≈ +0.000898° lat, lng unchanged', () => {
    const p = offsetLatLng(CENTER, 0, 100)
    expect(p.lat).toBeCloseTo(CENTER.lat + 100 / __test_only__.M_PER_DEG_LAT, 8)
    expect(p.lng).toBeCloseTo(CENTER.lng, 10)
  })

  it('east offset shrinks with latitude (cos scaling)', () => {
    const atEquator = offsetLatLng({ lat: 0, lng: 0 }, 100, 0)
    const atSydney = offsetLatLng({ lat: -33.8688, lng: 0 }, 100, 0)
    expect(atSydney.lng).toBeGreaterThan(atEquator.lng) // needs more degrees
  })
})

describe('panelRectangleRing', () => {
  it('returns a closed 5-point ring', () => {
    const ring = panelRectangleRing(CENTER, 1.045, 1.879, 0)
    expect(ring).toHaveLength(5)
    expect(ring[0]).toEqual(ring[4])
  })

  it('azimuth 0 (north) → width spans east-west, height north-south', () => {
    const ring = panelRectangleRing(CENTER, 1.0, 2.0, 0)
    const lngs = ring.map(([lng]) => lng)
    const lats = ring.map(([, lat]) => lat)
    const lngSpanM =
      (Math.max(...lngs) - Math.min(...lngs)) *
      __test_only__.M_PER_DEG_LAT *
      Math.cos((CENTER.lat * Math.PI) / 180)
    const latSpanM = (Math.max(...lats) - Math.min(...lats)) * __test_only__.M_PER_DEG_LAT
    expect(lngSpanM).toBeCloseTo(1.0, 2)
    expect(latSpanM).toBeCloseTo(2.0, 2)
  })

  it('azimuth 90 (east) swaps the spans', () => {
    const ring = panelRectangleRing(CENTER, 1.0, 2.0, 90)
    const lngs = ring.map(([lng]) => lng)
    const lats = ring.map(([, lat]) => lat)
    const lngSpanM =
      (Math.max(...lngs) - Math.min(...lngs)) *
      __test_only__.M_PER_DEG_LAT *
      Math.cos((CENTER.lat * Math.PI) / 180)
    const latSpanM = (Math.max(...lats) - Math.min(...lats)) * __test_only__.M_PER_DEG_LAT
    expect(lngSpanM).toBeCloseTo(2.0, 2)
    expect(latSpanM).toBeCloseTo(1.0, 2)
  })
})

describe('buildPanelLayoutGeoJson', () => {
  it('one polygon per panel with rounded yearly_kwh', () => {
    const fc = buildPanelLayoutGeoJson(ROOF_WITH_PANELS)
    expect(fc).not.toBeNull()
    expect(fc!.features).toHaveLength(3)
    const f = fc!.features[0]
    expect(f.geometry.type).toBe('Polygon')
    expect(f.properties.yearly_kwh).toBe(612.3)
    expect(f.properties.segment_index).toBe(0)
  })

  it('slices to the headline panel count', () => {
    const fc = buildPanelLayoutGeoJson(ROOF_WITH_PANELS, 2)
    expect(fc!.features).toHaveLength(2)
  })

  it('uses the plane azimuth per panel (south plane rotated)', () => {
    const fc = buildPanelLayoutGeoJson(ROOF_WITH_PANELS)
    // Panel 2 sits on plane 1 (azimuth 180) — ring must still close.
    const ring = (fc!.features[2].geometry as { coordinates: number[][][] }).coordinates[0]
    expect(ring[0]).toEqual(ring[4])
  })

  it('manual path (no panels) → null', () => {
    expect(buildPanelLayoutGeoJson(COVERED_ROOF_FACTS)).toBeNull()
    expect(buildPanelLayoutGeoJson({ ...COVERED_ROOF_FACTS, panels: [] })).toBeNull()
  })
})

describe('buildPlaneMarkersGeoJson', () => {
  it('one point per plane that has panels, with sun labels', () => {
    const fc = buildPlaneMarkersGeoJson(ROOF_WITH_PANELS)
    expect(fc).not.toBeNull()
    expect(fc!.features).toHaveLength(2)
    const north = fc!.features[0]
    expect(north.properties.plane_index).toBe(0)
    expect(north.properties.orientation).toBe('north')
    expect(north.properties.panels_count).toBe(2)
    // North plane is the best plane → relative 100 → 'Excellent sun'.
    expect(north.properties.sun_label).toBe('Excellent sun')
    expect(north.properties.sun_relative_pct).toBe(100)
    const south = fc!.features[1]
    expect(south.properties.plane_index).toBe(1)
    // South median 1200 / north 1600 = 75% → 'Good sun'.
    expect(south.properties.sun_label).toBe('Good sun')
  })

  it('marker sits at the centroid of the plane panels', () => {
    const fc = buildPlaneMarkersGeoJson(ROOF_WITH_PANELS)
    const [lng, lat] = (fc!.features[0].geometry as { coordinates: number[] }).coordinates
    expect(lat).toBeCloseTo(CENTER.lat, 6)
    expect(lng).toBeCloseTo(CENTER.lng + 0.00001, 6)
  })

  it('no panels → null', () => {
    expect(buildPlaneMarkersGeoJson(COVERED_ROOF_FACTS)).toBeNull()
  })
})

describe('buildPropertyPinGeoJson', () => {
  it('builds a Place element at the location', () => {
    const fc = buildPropertyPinGeoJson(CENTER, '1 Test St')
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties['felt:type']).toBe('Place')
    expect(fc.features[0].properties['felt:text']).toBe('1 Test St')
  })

  it('null address → generic label', () => {
    const fc = buildPropertyPinGeoJson(CENTER, null)
    expect(fc.features[0].properties['felt:text']).toBe('Property')
  })
})

describe('FSL builders', () => {
  it('panel FSL is a continuous numeric ramp on yearly_kwh', () => {
    const fsl = panelLayoutFsl()
    expect(fsl.type).toBe('numeric')
    expect((fsl.config as Record<string, unknown>).numericAttribute).toBe('yearly_kwh')
  })

  it('flux FSL carries band 1 + min/max steps when bounds exist', () => {
    const fsl = fluxRasterFsl(800, 1900)
    expect(fsl.type).toBe('numeric')
    expect((fsl.config as Record<string, unknown>).band).toBe(1)
    expect((fsl.config as Record<string, unknown>).steps).toEqual([800, 1900])
  })

  it('flux FSL omits steps on missing/degenerate bounds', () => {
    expect((fluxRasterFsl(null, null).config as Record<string, unknown>).steps).toBeUndefined()
    expect((fluxRasterFsl(5, 5).config as Record<string, unknown>).steps).toBeUndefined()
  })

  it('DSM FSL is a hillshade', () => {
    expect(dsmHillshadeFsl().type).toBe('hillshade')
  })

  it('plane markers FSL is categorical on sun_label', () => {
    const fsl = planeMarkersFsl()
    expect(fsl.type).toBe('categorical')
    expect((fsl.config as Record<string, unknown>).categoricalAttribute).toBe('sun_label')
  })
})

describe('feltMapTitle', () => {
  it('never includes a customer name — state/postcode/kW only', () => {
    expect(feltMapTitle({ state: 'NSW', postcode: '2000', systemKw: 6.6 })).toBe(
      'Solar estimate — NSW 2000 — 6.6 kW',
    )
  })

  it('degrades gracefully on missing parts', () => {
    expect(feltMapTitle({ state: null, postcode: null, systemKw: null })).toBe('Solar estimate')
    expect(feltMapTitle({ state: 'QLD', postcode: null, systemKw: 0 })).toBe(
      'Solar estimate — QLD',
    )
  })
})

describe('headlinePanelCount', () => {
  it('picks the largest tier (last in good→best order)', () => {
    const estimate = {
      sizing: {
        tiers: [
          { tier: 'good', panels_count: 16 },
          { tier: 'better', panels_count: 24 },
          { tier: 'best', panels_count: 30 },
        ],
      },
    } as unknown as Pick<SolarEstimate, 'sizing'>
    expect(headlinePanelCount(estimate)).toBe(30)
  })

  it('no tiers → null', () => {
    expect(
      headlinePanelCount({ sizing: { tiers: [] } } as unknown as Pick<SolarEstimate, 'sizing'>),
    ).toBeNull()
  })
})
