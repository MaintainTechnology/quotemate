// ════════════════════════════════════════════════════════════════════
// Painting — mock property-data provider.
//
// Used for:
//   • local development without any property-data API key set
//   • unit tests of the orchestrator + area + pricing pipeline
//
// Returns deterministic, address-derived facts so the same address
// always returns the same numbers — useful for screencasts + demos.
// Produces a realistic listing-style record (with a building/floor area)
// so the end-to-end estimate works before any real provider is wired.
// ════════════════════════════════════════════════════════════════════

import type { PropertyDataProvider } from './base'
import type {
  PaintAddressInput,
  PropertyLookupResult,
} from '../types'

export class MockPropertyProvider implements PropertyDataProvider {
  readonly name = 'mock' as const

  async lookup(input: PaintAddressInput): Promise<PropertyLookupResult> {
    if (!input.address?.trim()) {
      throw new Error('MockPropertyProvider.lookup: address is required')
    }
    const h = hash(input.address.toLowerCase() + '|' + input.postcode)

    const bedrooms = 2 + (h % 4) // 2–5
    const bathrooms = 1 + (h % 3) // 1–3
    const storeys = h % 5 === 0 ? 2 : 1
    const footprint = 90 + (h % 110) // 90–199 m²
    const floorArea = Math.round(footprint * storeys * 0.92)
    const yearBuilt = 1955 + (h % 70) // 1955–2024

    return {
      ok: true,
      provider: 'mock',
      warnings: ['Demo data from the deterministic mock provider.'],
      facts: {
        floor_area_m2: floorArea,
        floor_area_source: 'listing',
        footprint_m2: footprint,
        storeys,
        bedrooms,
        bathrooms,
        year_built: yearBuilt,
        property_type: 'House',
        land_size_m2: 300 + (h % 500),
        has_floor_plan: h % 2 === 0,
        source: 'mock',
        capture_note: 'Synthetic demo record — not a real property.',
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
