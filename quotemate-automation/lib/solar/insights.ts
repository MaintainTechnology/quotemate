// ════════════════════════════════════════════════════════════════════
// Solar — buildingInsights client (solar-owned wrapper).
//
// The coverage gate (coverage.ts) only proves usable imagery exists; the
// roof normaliser (roof.ts) needs the FULL response body — solarPotential,
// maxArrayPanelsCount, panelCapacityWatts and the precomputed
// solarPanelConfigs. This module fetches that body once and hands back the
// parsed SolarRoofInsight PLUS the raw handle (SolarRoofInsightWithRaw),
// so the orchestrator no longer inlines the fetch.
//
// Reuses the roofing solar-api parser/opts verbatim — this module only
// owns the URL + the raw passthrough. Best-effort and never throws: every
// failure surfaces as a discriminated `{ ok: false, code }`.
// ════════════════════════════════════════════════════════════════════

import { parseBuildingInsights, resolveSolarOpts } from '../roofing/solar-api'
import type { SolarEnrichmentOpts } from '../roofing/solar-api'
import type { SolarRoofInsightWithRaw } from './roof'
import type { LatLng } from './types'

const DEFAULT_BASE_URL =
  process.env.GOOGLE_SOLAR_API_BASE_URL ??
  'https://solar.googleapis.com/v1/buildingInsights:findClosest'

export type SolarBuildingInsightsResult =
  | { ok: true; insight: SolarRoofInsightWithRaw }
  | {
      ok: false
      code: 'no_key' | 'no_coverage' | 'http_error' | 'network_error' | 'invalid_response'
      detail: string
    }

/** PURE — parse a buildingInsights body into the raw-carrying roof insight. */
export function parseSolarBuildingInsights(
  body: unknown,
): SolarRoofInsightWithRaw | null {
  const parsed = parseBuildingInsights(body)
  if (!parsed) return null
  return { ...parsed, raw: body }
}

/**
 * Fetch buildingInsights:findClosest for a coordinate and return the parsed
 * roof insight with its raw body. `requiredQuality=LOW` is requested so the
 * body comes back even for LOW imagery — the MEDIUM money-path floor is
 * enforced upstream by the coverage gate (coverage.ts), not here.
 */
export async function fetchSolarBuildingInsights(
  location: LatLng,
  opts?: SolarEnrichmentOpts,
): Promise<SolarBuildingInsightsResult> {
  const resolved = resolveSolarOpts(opts)
  if (!resolved.apiKey) {
    return { ok: false, code: 'no_key', detail: 'Solar API key is not configured.' }
  }

  const base = resolved.baseUrl ?? DEFAULT_BASE_URL
  const url =
    `${base}?location.latitude=${encodeURIComponent(location.lat.toFixed(7))}` +
    `&location.longitude=${encodeURIComponent(location.lng.toFixed(7))}` +
    `&requiredQuality=LOW&key=${encodeURIComponent(resolved.apiKey)}` +
    // Expanded coverage (SOLAR_EXPANDED_COVERAGE): satellite-derived
    // BASE-quality insights where aerial imagery is missing — must match
    // the coverage-gate request or the two calls can disagree.
    (resolved.expandedCoverage ? '&experiments=EXPANDED_COVERAGE' : '')
  const fetchImpl = resolved.fetchImpl ?? ((u, init) => fetch(u, init))

  let res: Response
  try {
    res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } })
  } catch (e) {
    return { ok: false, code: 'network_error', detail: e instanceof Error ? e.message : String(e) }
  }

  if (res.status === 404) {
    return { ok: false, code: 'no_coverage', detail: 'No Solar building data at this coordinate.' }
  }
  if (!res.ok) {
    return { ok: false, code: 'http_error', detail: `Solar API HTTP ${res.status}.` }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { ok: false, code: 'invalid_response', detail: 'Solar API returned non-JSON.' }
  }

  const insight = parseSolarBuildingInsights(body)
  if (!insight) {
    return { ok: false, code: 'invalid_response', detail: 'Solar API returned no usable roof segments.' }
  }
  return { ok: true, insight }
}
