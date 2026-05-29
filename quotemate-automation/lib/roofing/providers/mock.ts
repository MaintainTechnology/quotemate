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
  PitchBucket,
  RoofAddressInput,
  RoofForm,
  RoofingMeasurementResult,
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
        polygon_geojson: null,
        capture_date: '2025-06-01',
      },
    }
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
