// ════════════════════════════════════════════════════════════════════
// Painting — Google Solar property-data provider (the real "Other tools"
// always-on signal).
//
// Flow: address → Google Geocoding API → lat/lng → Google Solar
// buildingInsights:findClosest → the building's ground FOOTPRINT in m².
// The area engine then turns footprint × storeys × eaves-correction into a
// medium-confidence floor area. This works for ~any populated AU address
// even when there is no property listing — the gap the REA tab can't fill.
//
// Cost: the Solar buildingInsights endpoint is free up to 10k calls/month.
// Both calls use the same GOOGLE_MAPS_API_KEY (the Solar API must be
// enabled on that Google Cloud project).
//
// SECURITY: the key stays server-side (this provider only runs inside the
// /api/painting/estimate route). The browser never sees it.
//
// LIMITATION: Solar returns a footprint, not a storey count. The caller
// must let the user declare storeys (PaintUserInputs.storeys), or a
// 2-storey home is under-measured ~2×. We surface a warning to that end.
//
// I/O lives behind an injectable fetch impl, so the response-parsing
// logic is unit-testable without network.
// ════════════════════════════════════════════════════════════════════

import type { PropertyDataProvider } from './base'
import type {
  PaintAddressInput,
  PropertyFacts,
  PropertyLookupResult,
} from '../types'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

const DEFAULT_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'
const DEFAULT_SOLAR_URL =
  'https://solar.googleapis.com/v1/buildingInsights:findClosest'

export type SolarProviderOpts = {
  /** Defaults to process.env.GOOGLE_MAPS_API_KEY. */
  apiKey?: string
  fetchImpl?: FetchLike
  geocodeBaseUrl?: string
  solarBaseUrl?: string
  /** Minimum imagery quality. LOW broadens coverage vs the HIGH default. */
  requiredQuality?: 'LOW' | 'MEDIUM' | 'HIGH'
}

export type LatLng = { lat: number; lng: number }

// ── Pure parsers ────────────────────────────────────────────────────

/** PURE — pull the first result's lat/lng from a Geocoding API body. */
export function parseGeocode(
  body: unknown,
): { ok: true; location: LatLng } | { ok: false; status: string } {
  if (!body || typeof body !== 'object') return { ok: false, status: 'NO_BODY' }
  const b = body as Record<string, unknown>
  const status = typeof b.status === 'string' ? b.status : 'UNKNOWN'
  const results = b.results
  if (status !== 'OK' || !Array.isArray(results) || results.length === 0) {
    return { ok: false, status }
  }
  const loc = (results[0] as { geometry?: { location?: { lat?: unknown; lng?: unknown } } })
    ?.geometry?.location
  if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
    return { ok: false, status: 'NO_LOCATION' }
  }
  return { ok: true, location: { lat: loc.lat, lng: loc.lng } }
}

/**
 * PURE — extract a ground footprint (m²) from a Solar buildingInsights
 * body. Prefers the ground-projected area; falls back to the (slightly
 * larger, pitch-inclusive) roof area only as a last resort.
 */
export function parseFootprintM2(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null
  const sp = (body as { solarPotential?: Record<string, unknown> }).solarPotential
  if (!sp || typeof sp !== 'object') return null
  const wholeRoof = sp.wholeRoofStats as Record<string, unknown> | undefined
  const buildingStats = sp.buildingStats as Record<string, unknown> | undefined
  const candidates = [
    wholeRoof?.groundAreaMeters2,
    buildingStats?.groundAreaMeters2,
    wholeRoof?.areaMeters2,
  ]
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c
  }
  return null
}

/** PURE — format the imagery capture date (if present) as YYYY-MM. */
export function parseImageryDate(body: unknown): string | null {
  const d = (body as { imageryDate?: { year?: unknown; month?: unknown } })?.imageryDate
  if (!d || typeof d.year !== 'number') return null
  const month = typeof d.month === 'number' ? String(d.month).padStart(2, '0') : '01'
  return `${d.year}-${month}`
}

// ── Provider ────────────────────────────────────────────────────────

export class SolarPropertyProvider implements PropertyDataProvider {
  readonly name = 'solar' as const

  private readonly apiKey?: string
  private readonly fetchImpl: FetchLike
  private readonly geocodeBaseUrl: string
  private readonly solarBaseUrl: string
  private readonly requiredQuality: 'LOW' | 'MEDIUM' | 'HIGH'

  constructor(opts: SolarProviderOpts = {}) {
    this.apiKey = opts.apiKey ?? process.env.GOOGLE_MAPS_API_KEY
    this.fetchImpl = opts.fetchImpl ?? ((u, init) => fetch(u, init))
    this.geocodeBaseUrl = opts.geocodeBaseUrl ?? DEFAULT_GEOCODE_URL
    this.solarBaseUrl = opts.solarBaseUrl ?? DEFAULT_SOLAR_URL
    this.requiredQuality = opts.requiredQuality ?? 'LOW'
  }

  async lookup(input: PaintAddressInput): Promise<PropertyLookupResult> {
    const key = this.apiKey
    if (!key) {
      return {
        ok: false,
        code: 'provider_unavailable',
        detail: 'GOOGLE_MAPS_API_KEY is not set, so the Google Solar lookup cannot run.',
      }
    }

    // 1. Forward-geocode the address → lat/lng.
    const query = [input.address, input.postcode, input.state, 'Australia']
      .filter((p) => p && String(p).trim())
      .join(', ')
    const geoUrl = `${this.geocodeBaseUrl}?address=${encodeURIComponent(query)}&region=au&key=${encodeURIComponent(key)}`

    let geoBody: unknown
    try {
      const res = await this.fetchImpl(geoUrl, { method: 'GET' })
      geoBody = await res.json()
    } catch (e) {
      return { ok: false, code: 'provider_unavailable', detail: geocodeError(e) }
    }
    const geo = parseGeocode(geoBody)
    if (!geo.ok) {
      return {
        ok: false,
        code: 'address_not_resolved',
        detail: `Google could not geocode this address (status ${geo.status}).`,
      }
    }

    // 2. Solar buildingInsights:findClosest → footprint.
    const solarUrl =
      `${this.solarBaseUrl}?location.latitude=${geo.location.lat}` +
      `&location.longitude=${geo.location.lng}` +
      `&requiredQuality=${this.requiredQuality}&key=${encodeURIComponent(key)}`

    let solarRes: Response
    let solarBody: unknown
    try {
      solarRes = await this.fetchImpl(solarUrl, { method: 'GET' })
      solarBody = await solarRes.json().catch(() => null)
    } catch (e) {
      return { ok: false, code: 'provider_unavailable', detail: geocodeError(e) }
    }

    if (!solarRes.ok) {
      // 404 = no building within the search radius for this point.
      if (solarRes.status === 404) {
        return {
          ok: false,
          code: 'no_data_for_address',
          detail:
            'Google Solar has no building data for this address. Use the floor-plan / manual path or a site measure.',
        }
      }
      const apiMsg =
        (solarBody as { error?: { message?: string } })?.error?.message ??
        `Solar API HTTP ${solarRes.status}`
      return { ok: false, code: 'provider_invalid_response', detail: apiMsg }
    }

    const footprint = parseFootprintM2(solarBody)
    if (footprint == null) {
      return {
        ok: false,
        code: 'no_data_for_address',
        detail: 'Google Solar found a building but returned no usable footprint area.',
      }
    }

    const imageryDate = parseImageryDate(solarBody)
    const facts: PropertyFacts = {
      floor_area_m2: null, // derived by the area engine from footprint × storeys
      floor_area_source: null,
      footprint_m2: Math.round(footprint),
      storeys: null, // Solar can't infer storeys — the user declares it
      bedrooms: null,
      bathrooms: null,
      year_built: null,
      property_type: null,
      land_size_m2: null,
      has_floor_plan: false,
      source: 'solar',
      capture_note: imageryDate
        ? `Footprint from Google Solar satellite imagery (${imageryDate}).`
        : 'Footprint from Google Solar satellite imagery.',
    }

    return {
      ok: true,
      provider: 'solar',
      warnings: [
        'Floor area is estimated from the roof footprint × storeys. Set the storey count, then confirm or correct the area before quoting.',
      ],
      facts,
    }
  }
}

function geocodeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
