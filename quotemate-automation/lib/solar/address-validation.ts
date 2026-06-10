// Google Address Validation for Solar estimates.
//
// This is best-effort enrichment. A missing/disabled API must never block
// the solar quote path; it only improves the coordinate and lets the quote
// page explain whether the address was validated or geocoded as a fallback.

import type {
  AuState,
  LatLng,
  SolarAddressInput,
  SolarAddressValidationInsight,
} from './types'

const DEFAULT_BASE_URL =
  process.env.GOOGLE_ADDRESS_VALIDATION_API_URL ??
  'https://addressvalidation.googleapis.com/v1:validateAddress'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type SolarAddressValidationOpts = {
  apiKey: string | undefined
  fetchImpl?: FetchLike
  baseUrl?: string
}

const EMPTY_LAYERS: Pick<
  SolarAddressValidationInsight,
  'formatted_address' | 'location' | 'validation_granularity' | 'geocode_granularity' |
  'next_action' | 'address_complete' | 'missing_components' | 'unconfirmed_components' |
  'response_id'
> = {
  formatted_address: null,
  location: null,
  validation_granularity: null,
  geocode_granularity: null,
  next_action: null,
  address_complete: null,
  missing_components: [],
  unconfirmed_components: [],
  response_id: null,
}

export async function validateSolarAddress(
  input: SolarAddressInput,
  opts: SolarAddressValidationOpts,
): Promise<SolarAddressValidationInsight> {
  if (!opts.apiKey) {
    return {
      status: 'skipped',
      ...EMPTY_LAYERS,
      detail: 'Address Validation API key is not configured.',
    }
  }

  const fetchImpl = opts.fetchImpl ?? ((u, init) => fetch(u, init))
  const base = opts.baseUrl ?? DEFAULT_BASE_URL
  const url = `${base}?key=${encodeURIComponent(opts.apiKey)}`
  const body = {
    address: {
      regionCode: 'AU',
      administrativeArea: input.state,
      postalCode: input.postcode,
      addressLines: [formatAddressLine(input)],
    },
  }

  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    return unavailable(e instanceof Error ? e.message : String(e))
  }

  if (!res.ok) {
    return unavailable(`Address Validation API HTTP ${res.status}.`)
  }

  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    return unavailable('Address Validation API returned non-JSON.')
  }

  return parseAddressValidationResponse(payload)
}

export function parseAddressValidationResponse(
  body: unknown,
): SolarAddressValidationInsight {
  if (!body || typeof body !== 'object') {
    return unavailable('Address Validation API returned a non-object body.')
  }

  const root = body as Record<string, unknown>
  const result = objectAt(root.result)
  if (!result) return unavailable('Address Validation API response had no result.')

  const verdict = objectAt(result.verdict)
  const address = objectAt(result.address)
  const geocode = objectAt(result.geocode)

  const nextAction = stringOrNull(verdict?.possibleNextAction)
  const validationGranularity = stringOrNull(verdict?.validationGranularity)
  const geocodeGranularity = stringOrNull(verdict?.geocodeGranularity)
  const addressComplete = boolOrNull(verdict?.addressComplete)
  const missing = stringArray(address?.missingComponentTypes)
  const unconfirmed = stringArray(address?.unconfirmedComponentTypes)
  const unresolved = stringArray(address?.unresolvedTokens)
  const formatted = stringOrNull(address?.formattedAddress)
  const location = readLocation(geocode?.location)

  let status: SolarAddressValidationInsight['status']
  if (nextAction === 'FIX' || unresolved.length > 0) {
    status = 'needs_fix'
  } else if (nextAction === 'CONFIRM' || nextAction === 'CONFIRM_ADD_SUBPREMISES') {
    status = 'needs_confirmation'
  } else {
    status = 'validated'
  }

  return {
    status,
    formatted_address: formatted,
    location,
    validation_granularity: validationGranularity,
    geocode_granularity: geocodeGranularity,
    next_action: nextAction,
    address_complete: addressComplete,
    missing_components: missing,
    unconfirmed_components: unconfirmed,
    response_id: stringOrNull(root.responseId),
    detail: unresolved.length > 0 ? `Unresolved tokens: ${unresolved.join(', ')}` : null,
  }
}

export function addressValidationLocationUsable(
  insight: SolarAddressValidationInsight | null | undefined,
): insight is SolarAddressValidationInsight & { location: LatLng } {
  if (!insight?.location) return false
  if (insight.status === 'needs_fix' || insight.status === 'unavailable') return false
  const g = insight.geocode_granularity
  return g === 'SUB_PREMISE' || g === 'PREMISE' || g === 'PREMISE_PROXIMITY'
}

function formatAddressLine(input: { address: string; postcode: string; state: AuState }) {
  return [input.address, input.state, input.postcode, 'Australia']
    .filter(Boolean)
    .join(', ')
}

function unavailable(detail: string): SolarAddressValidationInsight {
  return { status: 'unavailable', ...EMPTY_LAYERS, detail }
}

function objectAt(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function readLocation(value: unknown): LatLng | null {
  const loc = objectAt(value)
  const lat = loc?.latitude ?? loc?.lat
  const lng = loc?.longitude ?? loc?.lng
  if (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    typeof lng === 'number' &&
    Number.isFinite(lng)
  ) {
    return { lat, lng }
  }
  return null
}

