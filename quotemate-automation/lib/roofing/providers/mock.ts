// ════════════════════════════════════════════════════════════════════
// Roofing — mock measurement provider.
//
// Used for:
//   • local development without GEOSCAPE_API_KEY set
//   • the dashboard "demo" toggle so a tradie can dry-run the flow
//   • unit tests of the orchestrator + pricing pipeline
//
// Returns deterministic, postcode-derived results so the same address
// always returns the same metrics — useful for screencasts + demos.
// ════════════════════════════════════════════════════════════════════

import type { RoofingMeasurementProvider } from './base'
import type {
  GeoJSONPolygon,
  PitchBucket,
  RoofAddressInput,
  RoofForm,
  RoofMetrics,
  RoofingMeasurementResult,
  RoofingMultiMeasurementResult,
} from '../types'
import { slopedAreaFromFootprint } from '../pricing'

export class MockRoofingProvider implements RoofingMeasurementProvider {
  readonly name = 'mock' as const

  private readonly defaultPitch: PitchBucket

  constructor(opts: { defaultPitch?: PitchBucket } = {}) {
    this.defaultPitch = opts.defaultPitch ?? 'standard'
  }

  async measure(input: RoofAddressInput): Promise<RoofingMeasurementResult> {
    if (!input.address?.trim()) {
      throw new Error('MockRoofingProvider.measure: address is required')
    }
    // Deterministic by address: hash → footprint, form, storeys.
    const h = hash(input.address.toLowerCase() + '|' + input.postcode)
    const footprint = 110 + (h % 180)               // 110–289 m²
    const form: RoofForm = ['gable', 'hip', 'gable_hip'][h % 3] as RoofForm
    const storeys = (h % 7 === 0) ? 2 : 1
    const sloped_area_m2 = slopedAreaFromFootprint(footprint, this.defaultPitch)
    const hips = form === 'gable' ? 0 : form === 'hip' ? 4 : 2
    const valleys = form === 'gable_hip' ? 1 : 0
    return {
      ok: true,
      provider: 'mock',
      warnings: [],
      metrics: {
        footprint_m2: footprint,
        sloped_area_m2,
        storeys,
        form,
        hips,
        valleys,
        ridge_lm: null,
        polygon_geojson: synthesisePolygon(h, footprint),
        capture_date: '2025-06-01',
        buildingId: `mock-${h}-primary`,
      },
    }
  }

  /** Deterministic house + shed so the multi-structure UI / demo has two
   *  buildings to work with without a live Geoscape account. */
  async measureAll(input: RoofAddressInput): Promise<RoofingMultiMeasurementResult> {
    const primary = await this.measure(input)
    if (!primary.ok) return primary

    const h = hash(input.address.toLowerCase() + '|' + input.postcode)
    const shedFootprint = 30 + (h % 40) // 30–69 m²
    const shedMetrics: RoofMetrics = {
      footprint_m2: shedFootprint,
      sloped_area_m2: slopedAreaFromFootprint(shedFootprint, this.defaultPitch),
      storeys: 1,
      form: 'gable',
      hips: 0,
      valleys: 0,
      ridge_lm: null,
      polygon_geojson: synthesisePolygon(h * 7 + 13, shedFootprint),
      capture_date: '2025-06-01',
      buildingId: `mock-${h}-shed`,
    }

    return {
      ok: true,
      provider: 'mock',
      warnings: ['Mock provider returned a synthetic house + shed for the multi-structure demo.'],
      buildings: [
        { buildingId: `mock-${h}-primary`, role: 'primary', metrics: primary.metrics },
        { buildingId: `mock-${h}-shed`, role: 'secondary', metrics: shedMetrics },
      ],
    }
  }
}

/**
 * PURE — synthesise a deterministic GeoJSON polygon for the mock
 * provider so the dashboard map widget shows a believable building
 * overlay without needing a live Geoscape account. The polygon is
 * shaped to roughly match the declared footprint area (within ~10%)
 * and placed near central Sydney with a small per-address jitter so
 * different addresses appear in different positions.
 *
 * Stays a fixed 1.4:1 aspect ratio (typical AU residential footprint).
 * Located near central Sydney specifically because Esri World Imagery
 * has its best resolution there — gives the demo a recognisable AU
 * satellite backdrop. Real Geoscape responses use the actual property
 * coordinates, so this synthetic placement disappears once the live
 * provider is wired.
 */
export function synthesisePolygon(seed: number, footprintM2: number): GeoJSONPolygon {
  // Central Sydney baseline.
  const baseLng = 151.2093
  const baseLat = -33.8688
  // Per-address jitter — keeps polygons within ~0.01° (~1km) of CBD.
  const lng0 = baseLng + ((seed % 2000) - 1000) / 100_000
  const lat0 = baseLat + (((seed * 31) % 2000) - 1000) / 100_000
  // Shape: 1.4 (width) : 1 (height) → width = sqrt(area × 1.4).
  const widthM = Math.sqrt(footprintM2 * 1.4)
  const heightM = widthM / 1.4
  // Convert metres → degrees at lat0 using equirectangular projection.
  const mPerDegLat = 110_574
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  const dLng = widthM / mPerDegLng
  const dLat = heightM / mPerDegLat
  return {
    type: 'Polygon',
    coordinates: [[
      [lng0, lat0],
      [lng0 + dLng, lat0],
      [lng0 + dLng, lat0 - dLat],
      [lng0, lat0 - dLat],
      [lng0, lat0],
    ]],
  }
}

/** PURE — tiny deterministic string hash for the demo seed. */
export function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}
