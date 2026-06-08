// ════════════════════════════════════════════════════════════════════
// Solar — coverage gate.
//
// Given a resolved lat/lng, ask Google's buildingInsights:findClosest
// whether we have usable roof imagery. MEDIUM is the money-path floor;
// LOW imagery or a 404 means "uncovered" and the orchestrator branches
// to the manual-roof fallback (never a hard fail — spec §7).
//
// Reuses the existing solar-api client (fetchBuildingInsights) verbatim —
// this module only maps its SolarApiResult onto the solar coverage union.
//
// PURE-ish: the one network call is delegated to the injectable client;
// this function adds no I/O of its own and never throws.
// ════════════════════════════════════════════════════════════════════

import { fetchBuildingInsights } from '../roofing/solar-api'
import type { ImageryQuality } from '../roofing/solar-api'
import type { ResolvedSolarOpts } from '../roofing/solar-api'
import type {
  LatLng,
  SolarCoverageResult,
  SolarImageryQuality,
} from './types'

/** Imagery qualities good enough for the solar money path. */
const COVERAGE_FLOOR: SolarImageryQuality[] = ['HIGH', 'MEDIUM']

/**
 * Map the roofing module's ImageryQuality onto the solar module's
 * SolarImageryQuality. Both are currently the same union, but they are
 * independent types — an explicit mapping makes the safety contract
 * visible at compile time and insulates against divergence.
 */
function toSolarImageryQuality(q: ImageryQuality): SolarImageryQuality {
  if (q === 'HIGH') return 'HIGH'
  if (q === 'MEDIUM') return 'MEDIUM'
  return 'LOW'
}

/**
 * Check whether Google Solar has usable building-insights coverage for the
 * given coordinate. Returns a discriminated union:
 *   - `covered: true`  → imagery quality meets the MEDIUM floor; includes
 *                        the resolved location + imagery metadata so the
 *                        caller does not need to re-fetch.
 *   - `covered: false` → includes a `code` from `SolarCoverageFailureCode`
 *                        so the orchestrator can branch to the manual-roof
 *                        fallback (never a hard fail — spec §7).
 *
 * The address-input parameter has been removed: it was only intended for an
 * offline GeoJSON pre-check (which would produce 'outside_coverage'), but
 * that check is not implemented. Adding it back prematurely would require
 * callers to supply data that the function ignores, creating a misleading
 * API surface.
 */
export async function checkSolarCoverage(
  location: LatLng,
  opts: ResolvedSolarOpts,
): Promise<SolarCoverageResult> {
  const res = await fetchBuildingInsights(location, opts)

  if (!res.ok) {
    switch (res.code) {
      case 'no_coverage':
        return { covered: false, code: 'no_building_at_address', detail: res.detail }
      case 'invalid_response':
        return { covered: false, code: 'provider_invalid_response', detail: res.detail }
      // no_key, network_error, http_error → provider_unavailable
      default:
        return { covered: false, code: 'provider_unavailable', detail: res.detail }
    }
  }

  const quality = toSolarImageryQuality(res.insight.imageryQuality)
  if (!COVERAGE_FLOOR.includes(quality)) {
    return {
      covered: false,
      code: 'imagery_below_floor',
      detail: `Imagery quality ${quality} is below the MEDIUM floor required for an instant solar estimate.`,
    }
  }

  return {
    covered: true,
    location,
    imagery_quality: quality,
    imagery_date: res.insight.imageryDate,
  }
}
