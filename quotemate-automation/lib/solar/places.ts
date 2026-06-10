// ════════════════════════════════════════════════════════════════════
// Solar — Google Places (New) address autocomplete + place details.
//
// Powers the typeahead on the /solar/[tenantSlug] entry form:
//   1. places:autocomplete → AU-restricted address suggestions as the
//      customer types.
//   2. places/{placeId} details → street line + postcode + state so a
//      selected suggestion auto-fills the whole form.
//
// Best-effort enrichment of the FORM only — a missing/disabled Places
// API never blocks the quote path; the customer can always type the
// address manually. Same shape as the rest of lib/solar: pure parsers +
// injectable-fetch I/O wrappers, unit-testable without network.
// ════════════════════════════════════════════════════════════════════

import type { AuState, LatLng } from './types'

const DEFAULT_AUTOCOMPLETE_URL =
  process.env.GOOGLE_PLACES_AUTOCOMPLETE_API_URL ??
  'https://places.googleapis.com/v1/places:autocomplete'

const DEFAULT_DETAILS_BASE_URL =
  process.env.GOOGLE_PLACES_DETAILS_API_URL ??
  'https://places.googleapis.com/v1/places'

const AU_STATES: AuState[] = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type PlacesOpts = {
  apiKey: string | undefined
  fetchImpl?: FetchLike
  baseUrl?: string
}

// ── Autocomplete ─────────────────────────────────────────────────────

/** One suggestion the entry form renders in its dropdown. */
export type AddressSuggestion = {
  place_id: string
  /** Primary line, e.g. "670 London Road". */
  main_text: string
  /** Secondary line, e.g. "Chandler QLD, Australia". */
  secondary_text: string
  /** The full prediction text (main + secondary). */
  full_text: string
}

export type AddressSuggestResult =
  | { ok: true; suggestions: AddressSuggestion[] }
  | { ok: false; code: 'no_key' | 'http_error' | 'network_error' | 'invalid_response'; detail: string }

/** PURE — parse a places:autocomplete response body into suggestions. */
export function parseAutocompleteResponse(body: unknown): AddressSuggestion[] {
  if (!body || typeof body !== 'object') return []
  const root = body as Record<string, unknown>
  const raw = Array.isArray(root.suggestions) ? root.suggestions : []
  const out: AddressSuggestion[] = []
  for (const item of raw) {
    const p = objectAt(objectAt(item)?.placePrediction)
    if (!p) continue
    const placeId = stringAt(p.placeId)
    if (!placeId) continue
    const structured = objectAt(p.structuredFormat)
    const main = stringAt(objectAt(structured?.mainText)?.text)
    const secondary = stringAt(objectAt(structured?.secondaryText)?.text)
    const full = stringAt(objectAt(p.text)?.text) ?? [main, secondary].filter(Boolean).join(', ')
    out.push({
      place_id: placeId,
      main_text: main ?? full ?? placeId,
      secondary_text: secondary ?? '',
      full_text: full ?? '',
    })
  }
  return out
}

/**
 * Fetch AU-restricted address suggestions for partial input. Never
 * throws; every miss surfaces as `{ ok: false, code }` and the form
 * simply shows no dropdown.
 */
export async function fetchAddressSuggestions(
  input: string,
  opts: PlacesOpts,
): Promise<AddressSuggestResult> {
  if (!opts.apiKey) {
    return { ok: false, code: 'no_key', detail: 'Places API key is not configured.' }
  }
  const fetchImpl = opts.fetchImpl ?? ((u, init) => fetch(u, init))
  const url = opts.baseUrl ?? DEFAULT_AUTOCOMPLETE_URL

  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Goog-Api-Key': opts.apiKey,
      },
      body: JSON.stringify({
        input,
        includedRegionCodes: ['au'],
        languageCode: 'en-AU',
      }),
    })
  } catch (e) {
    return { ok: false, code: 'network_error', detail: e instanceof Error ? e.message : String(e) }
  }
  if (!res.ok) {
    return { ok: false, code: 'http_error', detail: `Places autocomplete HTTP ${res.status}.` }
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { ok: false, code: 'invalid_response', detail: 'Places autocomplete returned non-JSON.' }
  }
  return { ok: true, suggestions: parseAutocompleteResponse(body) }
}

// ── Place details ────────────────────────────────────────────────────

/** The resolved fields the form auto-fills from a selected suggestion. */
export type PlaceAddressDetails = {
  /** Street line incl. suburb, e.g. "670 London Road, Chandler". */
  street_address: string
  postcode: string | null
  state: AuState | null
  formatted_address: string | null
  location: LatLng | null
}

export type PlaceDetailsResult =
  | { ok: true; details: PlaceAddressDetails }
  | { ok: false; code: 'no_key' | 'http_error' | 'network_error' | 'invalid_response'; detail: string }

/** PURE — parse a Places (New) details body into form-fill fields. */
export function parsePlaceDetailsResponse(body: unknown): PlaceAddressDetails | null {
  if (!body || typeof body !== 'object') return null
  const root = body as Record<string, unknown>
  const components = Array.isArray(root.addressComponents) ? root.addressComponents : []

  let streetNumber: string | null = null
  let route: string | null = null
  let locality: string | null = null
  let postcode: string | null = null
  let state: AuState | null = null

  for (const item of components) {
    const c = objectAt(item)
    if (!c) continue
    const types = Array.isArray(c.types) ? c.types : []
    const long = stringAt(c.longText)
    const short = stringAt(c.shortText)
    if (types.includes('street_number')) streetNumber = long ?? short
    else if (types.includes('route')) route = long ?? short
    else if (types.includes('locality')) locality = long ?? short
    else if (types.includes('postal_code')) postcode = short ?? long
    else if (types.includes('administrative_area_level_1')) {
      const candidate = (short ?? long ?? '').toUpperCase()
      state = AU_STATES.includes(candidate as AuState) ? (candidate as AuState) : null
    }
  }

  const streetLine = [streetNumber, route].filter(Boolean).join(' ')
  const street_address = [streetLine, locality].filter(Boolean).join(', ')
  const formatted = stringAt(root.formattedAddress)

  // Without at least a street line or a formatted address there is
  // nothing useful to fill — treat as unparseable.
  if (!street_address && !formatted) return null

  const loc = objectAt(root.location)
  const lat = loc?.latitude
  const lng = loc?.longitude
  const location: LatLng | null =
    typeof lat === 'number' && Number.isFinite(lat) &&
    typeof lng === 'number' && Number.isFinite(lng)
      ? { lat, lng }
      : null

  return {
    street_address: street_address || (formatted as string),
    postcode,
    state,
    formatted_address: formatted,
    location,
  }
}

/** Fetch the details for a selected suggestion. Never throws. */
export async function fetchPlaceDetails(
  placeId: string,
  opts: PlacesOpts,
): Promise<PlaceDetailsResult> {
  if (!opts.apiKey) {
    return { ok: false, code: 'no_key', detail: 'Places API key is not configured.' }
  }
  const fetchImpl = opts.fetchImpl ?? ((u, init) => fetch(u, init))
  const base = opts.baseUrl ?? DEFAULT_DETAILS_BASE_URL
  const url = `${base}/${encodeURIComponent(placeId)}`

  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Goog-Api-Key': opts.apiKey,
        'X-Goog-FieldMask': 'formattedAddress,addressComponents,location',
      },
    })
  } catch (e) {
    return { ok: false, code: 'network_error', detail: e instanceof Error ? e.message : String(e) }
  }
  if (!res.ok) {
    return { ok: false, code: 'http_error', detail: `Places details HTTP ${res.status}.` }
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { ok: false, code: 'invalid_response', detail: 'Places details returned non-JSON.' }
  }
  const details = parsePlaceDetailsResponse(body)
  if (!details) {
    return { ok: false, code: 'invalid_response', detail: 'Places details had no usable address.' }
  }
  return { ok: true, details }
}

// ── helpers ──────────────────────────────────────────────────────────

function objectAt(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function stringAt(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
