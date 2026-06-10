import type { AcAddressInput } from './types'
import { parseFootprintM2, parseImageryDate } from '@/lib/painting/providers/solar'
import { roundTo } from './sizing'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type AcGeocodeEvidence =
  | {
      ok: true
      formatted_address: string | null
      lat: number
      lng: number
      place_id: string | null
      source: 'google_geocoding'
    }
  | {
      ok: false
      code: 'config_missing' | 'not_found' | 'network_error' | 'provider_error'
      detail: string
    }

export type AcWeatherEvidence =
  | {
      ok: true
      condition: string | null
      temperature_c: number | null
      feels_like_c: number | null
      humidity_pct: number | null
      heat_index_c: number | null
      source: 'google_weather'
    }
  | {
      ok: false
      code: 'config_missing' | 'skipped' | 'network_error' | 'provider_error'
      detail: string
    }

export type AcBuildingEvidence =
  | {
      ok: true
      /** Ground footprint of the roof in m² (Google Solar). */
      footprint_m2: number
      /** YYYY-MM of the satellite capture, when known. */
      imagery_date: string | null
      /** footprint × storeys × wall-correction — the floor-area estimate. */
      estimated_floor_area_m2: number
      storeys_assumed: number
      source: 'google_solar'
    }
  | {
      ok: false
      code: 'config_missing' | 'skipped' | 'no_building' | 'network_error' | 'provider_error'
      detail: string
    }

export type AcLocationEvidence = {
  geocode: AcGeocodeEvidence
  weather: AcWeatherEvidence
  building: AcBuildingEvidence
  notes: string[]
}

export type AcLocationOpts = {
  geocodeApiKey?: string
  weatherApiKey?: string
  solarApiKey?: string
  fetchImpl?: FetchLike
  geocodeBaseUrl?: string
  weatherBaseUrl?: string
  solarBaseUrl?: string
  /** Storeys the tradie declared — Solar only sees the roof. */
  storeys?: number
}

const DEFAULT_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'
const DEFAULT_WEATHER_URL = 'https://weather.googleapis.com/v1/currentConditions:lookup'
const DEFAULT_SOLAR_URL = 'https://solar.googleapis.com/v1/buildingInsights:findClosest'

/**
 * Roof footprint → internal floor area: footprint × storeys × 0.85
 * (walls, eaves overhang and unconditioned garage correction).
 */
export const FOOTPRINT_TO_FLOOR_CORRECTION = 0.85

function fullAddress(input: AcAddressInput): string {
  return `${input.address}, ${input.state} ${input.postcode}, Australia`
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseAcGeocode(body: unknown): AcGeocodeEvidence {
  if (!body || typeof body !== 'object') {
    return { ok: false, code: 'provider_error', detail: 'Geocoder returned a non-object body.' }
  }
  const b = body as Record<string, unknown>
  const status = typeof b.status === 'string' ? b.status : ''
  if (status === 'ZERO_RESULTS') {
    return { ok: false, code: 'not_found', detail: 'Google Geocoding found no address match.' }
  }
  const results = Array.isArray(b.results) ? b.results : []
  const first = results[0] as
    | {
        formatted_address?: unknown
        place_id?: unknown
        geometry?: { location?: { lat?: unknown; lng?: unknown } }
      }
    | undefined
  const lat = first?.geometry?.location?.lat
  const lng = first?.geometry?.location?.lng
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, code: 'provider_error', detail: `Geocoder status ${status || 'unknown'}, no finite coordinates.` }
  }
  return {
    ok: true,
    formatted_address:
      typeof first?.formatted_address === 'string' ? first.formatted_address : null,
    lat,
    lng,
    place_id: typeof first?.place_id === 'string' ? first.place_id : null,
    source: 'google_geocoding',
  }
}

export function parseAcWeather(body: unknown): AcWeatherEvidence {
  if (!body || typeof body !== 'object') {
    return { ok: false, code: 'provider_error', detail: 'Weather API returned a non-object body.' }
  }
  const b = body as {
    weatherCondition?: { description?: { text?: unknown } }
    temperature?: { degrees?: unknown }
    feelsLikeTemperature?: { degrees?: unknown }
    heatIndex?: { degrees?: unknown }
    relativeHumidity?: unknown
  }
  return {
    ok: true,
    condition:
      typeof b.weatherCondition?.description?.text === 'string'
        ? b.weatherCondition.description.text
        : null,
    temperature_c: num(b.temperature?.degrees),
    feels_like_c: num(b.feelsLikeTemperature?.degrees),
    humidity_pct: num(b.relativeHumidity),
    heat_index_c: num(b.heatIndex?.degrees),
    source: 'google_weather',
  }
}

async function geocodeAddress(
  input: AcAddressInput,
  opts: AcLocationOpts,
): Promise<AcGeocodeEvidence> {
  if (!opts.geocodeApiKey) {
    return { ok: false, code: 'config_missing', detail: 'Google Geocoding API key is not configured.' }
  }
  const fetchImpl = opts.fetchImpl ?? ((u, init) => fetch(u, init))
  const url = new URL(opts.geocodeBaseUrl ?? DEFAULT_GEOCODE_URL)
  url.searchParams.set('address', fullAddress(input))
  url.searchParams.set('region', 'au')
  url.searchParams.set('components', 'country:AU')
  url.searchParams.set('key', opts.geocodeApiKey)

  try {
    const res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } })
    if (!res.ok) {
      return { ok: false, code: 'provider_error', detail: `Google Geocoding HTTP ${res.status}` }
    }
    return parseAcGeocode(await res.json())
  } catch (e) {
    return { ok: false, code: 'network_error', detail: e instanceof Error ? e.message : String(e) }
  }
}

async function currentWeather(
  geocode: AcGeocodeEvidence,
  opts: AcLocationOpts,
): Promise<AcWeatherEvidence> {
  if (!geocode.ok) {
    return { ok: false, code: 'skipped', detail: 'Weather lookup skipped because geocoding did not resolve coordinates.' }
  }
  if (!opts.weatherApiKey) {
    return { ok: false, code: 'config_missing', detail: 'Google Weather API key is not configured.' }
  }
  const fetchImpl = opts.fetchImpl ?? ((u, init) => fetch(u, init))
  const url = new URL(opts.weatherBaseUrl ?? DEFAULT_WEATHER_URL)
  url.searchParams.set('key', opts.weatherApiKey)
  url.searchParams.set('location.latitude', String(geocode.lat))
  url.searchParams.set('location.longitude', String(geocode.lng))

  try {
    const res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } })
    if (!res.ok) {
      return { ok: false, code: 'provider_error', detail: `Google Weather HTTP ${res.status}` }
    }
    return parseAcWeather(await res.json())
  } catch (e) {
    return { ok: false, code: 'network_error', detail: e instanceof Error ? e.message : String(e) }
  }
}

async function buildingFootprint(
  geocode: AcGeocodeEvidence,
  opts: AcLocationOpts,
): Promise<AcBuildingEvidence> {
  if (!geocode.ok) {
    return {
      ok: false,
      code: 'skipped',
      detail: 'Building lookup skipped because geocoding did not resolve coordinates.',
    }
  }
  if (!opts.solarApiKey) {
    return { ok: false, code: 'config_missing', detail: 'Google Solar API key is not configured.' }
  }
  const fetchImpl = opts.fetchImpl ?? ((u, init) => fetch(u, init))
  const url = new URL(opts.solarBaseUrl ?? DEFAULT_SOLAR_URL)
  url.searchParams.set('location.latitude', String(geocode.lat))
  url.searchParams.set('location.longitude', String(geocode.lng))
  url.searchParams.set('requiredQuality', 'LOW')
  url.searchParams.set('key', opts.solarApiKey)

  let res: Response
  let body: unknown
  try {
    res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } })
    body = await res.json().catch(() => null)
  } catch (e) {
    return { ok: false, code: 'network_error', detail: e instanceof Error ? e.message : String(e) }
  }
  if (!res.ok) {
    if (res.status === 404) {
      return {
        ok: false,
        code: 'no_building',
        detail: 'Google Solar has no building data near this address.',
      }
    }
    return { ok: false, code: 'provider_error', detail: `Google Solar HTTP ${res.status}` }
  }
  const footprint = parseFootprintM2(body)
  if (footprint == null) {
    return {
      ok: false,
      code: 'no_building',
      detail: 'Google Solar found a building but returned no usable footprint area.',
    }
  }
  const storeys = Math.min(3, Math.max(1, Math.floor(opts.storeys ?? 1)))
  return {
    ok: true,
    footprint_m2: Math.round(footprint),
    imagery_date: parseImageryDate(body),
    estimated_floor_area_m2: roundTo(footprint * storeys * FOOTPRINT_TO_FLOOR_CORRECTION, 1),
    storeys_assumed: storeys,
    source: 'google_solar',
  }
}

export async function resolveAcLocationEvidence(
  input: AcAddressInput,
  opts: AcLocationOpts,
): Promise<AcLocationEvidence> {
  const geocode = await geocodeAddress(input, opts)
  const [weather, building] = await Promise.all([
    currentWeather(geocode, opts),
    buildingFootprint(geocode, opts),
  ])
  const notes = [
    geocode.ok
      ? 'Google Geocoding resolved the address for map centring and location evidence.'
      : geocode.detail,
    weather.ok
      ? 'Google Weather is displayed as context only; pricing still uses the postcode climate zone.'
      : weather.detail,
    building.ok
      ? `Google Solar measured a ${building.footprint_m2} m2 roof footprint${building.imagery_date ? ` (imagery ${building.imagery_date})` : ''} - floor area estimated as footprint × ${building.storeys_assumed} storey${building.storeys_assumed === 1 ? '' : 's'} × ${FOOTPRINT_TO_FLOOR_CORRECTION}.`
      : building.detail,
  ]
  return { geocode, weather, building, notes }
}
