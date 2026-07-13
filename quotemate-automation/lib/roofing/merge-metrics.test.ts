import { describe, it, expect } from 'vitest'
import { roofMaterialFromGeoscape, mergeMeasurement, fuseExistingSolar } from './merge-metrics'
import type { GeoscapeBuildingAttributes, RoofMetrics, RoofUserInputs } from './types'

const attrs = (over: Partial<GeoscapeBuildingAttributes> = {}): GeoscapeBuildingAttributes => ({
  roof_material: null,
  roof_complexity: null,
  max_roof_height_m: null,
  eave_height_m: null,
  ground_elevation_m: null,
  roof_rise_m: null,
  solar_panel: null,
  overhanging_tree: null,
  ...over,
})

const baseMetrics = (over: Partial<RoofMetrics> = {}): RoofMetrics => ({
  footprint_m2: 160,
  sloped_area_m2: 176,
  storeys: 1,
  form: 'hip',
  hips: 4,
  valleys: 0,
  ridge_lm: 12,
  polygon_geojson: null,
  capture_date: null,
  ...over,
})

const inputs = (over: Partial<RoofUserInputs> = {}): RoofUserInputs => ({
  material: 'colorbond_corrugated',
  pitch: 'standard',
  intent: 'full_reroof',
  ...over,
})

describe('roofMaterialFromGeoscape', () => {
  it('maps metal-family strings to colorbond corrugated', () => {
    for (const s of ['Metal', 'Colorbond', 'Corrugated steel', 'Tin', 'Zincalume']) {
      expect(roofMaterialFromGeoscape(s)).toBe('colorbond_corrugated')
    }
  })
  it('maps tile families', () => {
    expect(roofMaterialFromGeoscape('Terracotta')).toBe('terracotta_tile')
    expect(roofMaterialFromGeoscape('Concrete')).toBe('concrete_tile')
    expect(roofMaterialFromGeoscape('Tile')).toBe('concrete_tile')
    expect(roofMaterialFromGeoscape('Slate')).toBe('concrete_tile')
  })
  it('maps fibre-cement/asbestos strings to cement_sheet (the asbestos gate)', () => {
    for (const s of ['Fibre cement', 'Fibro', 'Asbestos cement', 'Cement sheet']) {
      expect(roofMaterialFromGeoscape(s)).toBe('cement_sheet')
    }
  })
  it('returns null for empty/unknown so we never assert false confidence', () => {
    expect(roofMaterialFromGeoscape(null)).toBeNull()
    expect(roofMaterialFromGeoscape('')).toBeNull()
    expect(roofMaterialFromGeoscape('Unclassified')).toBeNull()
  })
})

describe('mergeMeasurement — provenance', () => {
  it('marks pitch/area as google_solar when the Solar path measured them', () => {
    const m = baseMetrics({ pitch_source: 'measured', area_source: 'measured' })
    const { metrics } = mergeMeasurement({ metrics: m, inputs: inputs() })
    expect(metrics.field_sources?.pitch).toBe('google_solar')
    expect(metrics.field_sources?.sloped_area).toBe('google_solar')
    expect(metrics.field_sources?.footprint).toBe('geoscape')
  })

  it('falls back to declared pitch + derived area when Solar did not apply', () => {
    const { metrics } = mergeMeasurement({ metrics: baseMetrics(), inputs: inputs() })
    expect(metrics.field_sources?.pitch).toBe('declared')
    expect(metrics.field_sources?.sloped_area).toBe('derived')
  })

  it('measured pitch but derived (cos-θ) area → pitch google_solar, area derived', () => {
    const m = baseMetrics({ pitch_source: 'measured', area_source: 'derived' })
    const { metrics } = mergeMeasurement({ metrics: m, inputs: inputs() })
    expect(metrics.field_sources?.pitch).toBe('google_solar')
    expect(metrics.field_sources?.sloped_area).toBe('derived')
  })

  it('attributes form/storeys to geoscape only when present', () => {
    const known = mergeMeasurement({ metrics: baseMetrics(), inputs: inputs() }).metrics
    expect(known.field_sources?.form).toBe('geoscape')
    expect(known.field_sources?.storeys).toBe('geoscape')
    // Undetermined form/storeys are OMITTED (no declared form/storeys exists) —
    // never mislabelled as a tradie declaration.
    const unknown = mergeMeasurement({
      metrics: baseMetrics({ form: 'unknown', storeys: null }),
      inputs: inputs(),
    }).metrics
    expect(unknown.field_sources?.form).toBeUndefined()
    expect(unknown.field_sources?.storeys).toBeUndefined()
  })

  it('records existing_solar provenance from the Geoscape flag', () => {
    const withFlag = mergeMeasurement({
      metrics: baseMetrics({ building_attributes: attrs({ solar_panel: true }) }),
      inputs: inputs(),
    }).metrics
    expect(withFlag.field_sources?.existing_solar).toBe('geoscape')
    const without = mergeMeasurement({ metrics: baseMetrics(), inputs: inputs() }).metrics
    expect(without.field_sources?.existing_solar).toBeUndefined()
  })
})

describe('mergeMeasurement — material suggestion + asbestos safety', () => {
  it('suggests the Geoscape material without changing the declared pricing input', () => {
    const { metrics } = mergeMeasurement({
      metrics: baseMetrics({ building_attributes: attrs({ roof_material: 'Tile' }) }),
      inputs: inputs({ material: 'colorbond_corrugated' }),
    })
    expect(metrics.suggested_material).toBe('concrete_tile')
    // Pricing input untouched — provenance still 'declared'.
    expect(metrics.field_sources?.material).toBe('declared')
  })

  it('warns (does not silently reprice) when Geoscape reads asbestos but declared differs', () => {
    const { metrics, warnings } = mergeMeasurement({
      metrics: baseMetrics({ building_attributes: attrs({ roof_material: 'Fibre cement' }) }),
      inputs: inputs({ material: 'colorbond_corrugated' }),
    })
    expect(metrics.suggested_material).toBe('cement_sheet')
    expect(warnings.join(' ')).toMatch(/asbestos/i)
  })

  it('no asbestos warning when the tradie already declared cement_sheet', () => {
    const { warnings } = mergeMeasurement({
      metrics: baseMetrics({ building_attributes: attrs({ roof_material: 'Asbestos cement' }) }),
      inputs: inputs({ material: 'cement_sheet' }),
    })
    expect(warnings).toEqual([])
  })
})

describe('fuseExistingSolar', () => {
  it('either source claiming panels wins (conservative for the allowance)', () => {
    expect(fuseExistingSolar({ geoscapeFlag: true, visionDetected: false })).toEqual({ hasSolar: true, source: 'geoscape' })
    expect(fuseExistingSolar({ geoscapeFlag: false, visionDetected: true })).toEqual({ hasSolar: true, source: 'vision' })
    expect(fuseExistingSolar({ geoscapeFlag: true, visionDetected: true })).toEqual({ hasSolar: true, source: 'both' })
    expect(fuseExistingSolar({ geoscapeFlag: null, visionDetected: null })).toEqual({ hasSolar: false, source: 'none' })
  })
})
