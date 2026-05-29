// ════════════════════════════════════════════════════════════════════
// Roofing — Geoscape Buildings adapter.
//
// Geoscape's Buildings dataset returns precomputed building footprint
// polygons + roof form (gable/hip/skillion/complex) + storey count for
// ~21M Australian addresses. Phase 1 measurement source.
//
// This adapter is dependency-injectable for tests:
//   • `fetchImpl` defaults to global fetch (Node 18+ / browser).
//   • `apiKey` and `baseUrl` default to env vars (GEOSCAPE_API_KEY,
//     GEOSCAPE_API_BASE_URL).
// Tests construct a provider with a stub fetch — no network at test
// time.
//
// Error contract (mirrors the provider base):
//   • Any operational failure (404, 5xx, timeout, malformed body) →
//     { ok: false, code, detail }. NEVER throws.
//   • Missing API key at run-time → { ok: false, code:'provider_unavailable' }.
//     Throws only on programmer error (empty address string).
// ════════════════════════════════════════════════════════════════════

import type { RoofingMeasurementProvider } from './base'
import type {
  GeoJSONPolygon,
  PitchBucket,
  RoofAddressInput,
  RoofForm,
  RoofMetrics,
  RoofingMeasurementFailureCode,
  RoofingMeasurementResult,
} from '../types'
import { slopedAreaFromFootprint } from '../pricing'

const DEFAULT_BASE_URL =
  process.env.GEOSCAPE_API_BASE_URL ?? 'https://api.geoscape.com.au/v1'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type GeoscapeProviderOpts = {
  apiKey?: string
  baseUrl?: string
  fetchImpl?: FetchLike
  /**
   * Pitch assumption used to derive sloped area when the caller hasn't
   * yet collected the customer-declared pitch. The orchestrator may
   * override the resulting sloped_area_m2 with a recomputed value once
   * the customer answers. Default 'standard' (~22.5°, the AU median).
   */
  defaultPitch?: PitchBucket
}

export class GeoscapeProvider implements RoofingMeasurementProvider {
  readonly name = 'geoscape' as const

  private readonly apiKey: string | undefined
  private readonly baseUrl: string
  private readonly fetchImpl: FetchLike
  private readonly defaultPitch: PitchBucket

  constructor(opts: GeoscapeProviderOpts = {}) {
    this.apiKey = opts.apiKey ?? process.env.GEOSCAPE_API_KEY
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL
    this.fetchImpl =
      opts.fetchImpl ??
      ((input, init) => fetch(input, init))
    this.defaultPitch = opts.defaultPitch ?? 'standard'
  }

  async measure(input: RoofAddressInput): Promise<RoofingMeasurementResult> {
    if (!input || !input.address?.trim()) {
      throw new Error('GeoscapeProvider.measure: address is required')
    }
    if (!this.apiKey) {
      return {
        ok: false,
        code: 'provider_unavailable',
        detail:
          'GEOSCAPE_API_KEY is not set — Geoscape adapter cannot make requests. Set the env var or use the mock provider for local development.',
      }
    }

    // Geoscape's address-to-building flow is two-call:
    //   1. /addresses?query=…          → addressId
    //   2. /buildings?addressId=…      → polygon + form + storeys
    // The exact paths are wrapped in resolveAddressId / fetchBuilding so
    // each step is independently testable.
    const addressIdRes = await this.resolveAddressId(input)
    if (!addressIdRes.ok) return addressIdRes

    const buildingRes = await this.fetchBuilding(addressIdRes.addressId)
    if (!buildingRes.ok) return buildingRes

    const metrics = buildingResponseToMetrics(buildingRes.body, this.defaultPitch)
    if (!metrics) {
      return {
        ok: false,
        code: 'provider_invalid_response',
        detail:
          'Geoscape returned a building record without a usable footprint polygon — cannot compute area.',
      }
    }

    const warnings: string[] = []
    if (metrics.form === 'complex') {
      warnings.push(
        'Geoscape classified the roof as complex — orchestrator will route to inspection.',
      )
    }
    if (metrics.storeys !== null && metrics.storeys >= 2) {
      warnings.push(
        `Building has ${metrics.storeys} storeys — multi-storey loading will apply.`,
      )
    }

    return {
      ok: true,
      metrics,
      provider: 'geoscape',
      warnings,
    }
  }

  // ── Step 1 — address → addressId ───────────────────────────────────
  private async resolveAddressId(
    input: RoofAddressInput,
  ): Promise<
    | { ok: true; addressId: string }
    | (RoofingMeasurementResult & { ok: false })
  > {
    const url = `${this.baseUrl}/addresses?query=${encodeURIComponent(
      input.address,
    )}&state=${encodeURIComponent(input.state)}&maxResults=1`
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: this.apiKey! },
      })
    } catch (e) {
      return failure('provider_unavailable', `Geoscape network error: ${errorMessage(e)}`)
    }
    if (res.status === 429) return failure('provider_rate_limited', 'Geoscape rate-limited (429).')
    if (!res.ok) {
      return failure(
        'provider_unavailable',
        `Geoscape address lookup HTTP ${res.status}.`,
      )
    }
    let body: unknown
    try {
      body = await res.json()
    } catch {
      return failure('provider_invalid_response', 'Geoscape address lookup returned non-JSON.')
    }
    const addressId = pickAddressId(body)
    if (!addressId) {
      return failure(
        'address_not_resolved',
        `Geoscape could not resolve the address "${input.address}".`,
      )
    }
    return { ok: true, addressId }
  }

  // ── Step 2 — addressId → building ──────────────────────────────────
  private async fetchBuilding(
    addressId: string,
  ): Promise<
    | { ok: true; body: GeoscapeBuildingBody }
    | (RoofingMeasurementResult & { ok: false })
  > {
    const url = `${this.baseUrl}/buildings?addressId=${encodeURIComponent(addressId)}`
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: this.apiKey! },
      })
    } catch (e) {
      return failure('provider_unavailable', `Geoscape network error: ${errorMessage(e)}`)
    }
    if (res.status === 429) return failure('provider_rate_limited', 'Geoscape rate-limited (429).')
    if (res.status === 404) {
      return failure('no_building_at_address', 'Geoscape has no building record at this address.')
    }
    if (!res.ok) {
      return failure(
        'provider_unavailable',
        `Geoscape building lookup HTTP ${res.status}.`,
      )
    }
    let body: unknown
    try {
      body = await res.json()
    } catch {
      return failure('provider_invalid_response', 'Geoscape building lookup returned non-JSON.')
    }
    if (!isGeoscapeBuildingBody(body)) {
      return failure('provider_invalid_response', 'Geoscape building lookup returned an unexpected shape.')
    }
    return { ok: true, body }
  }
}

// ── Pure helpers (testable in isolation) ────────────────────────────

/**
 * PURE — pluck the first address id from Geoscape's address lookup
 * response, tolerating the documented variations of their envelope.
 */
export function pickAddressId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.id === 'string') return b.id
  if (typeof b.addressId === 'string') return b.addressId
  const data = (b as { data?: unknown }).data
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as Record<string, unknown> | undefined
    if (first) {
      if (typeof first.id === 'string') return first.id
      if (typeof first.addressId === 'string') return first.addressId
    }
  }
  const results = (b as { results?: unknown }).results
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0] as Record<string, unknown> | undefined
    if (first) {
      if (typeof first.id === 'string') return first.id
      if (typeof first.addressId === 'string') return first.addressId
    }
  }
  return null
}

/** Internal: minimal shape we rely on from the Geoscape Buildings body. */
export type GeoscapeBuildingBody = {
  footprint: GeoJSONPolygon
  roofForm?: string | null
  storeys?: number | null
  buildingArea?: number | null
  captureDate?: string | null
}

/** PURE — duck-typed acceptance of the body we depend on. */
export function isGeoscapeBuildingBody(body: unknown): body is GeoscapeBuildingBody {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  const fp = b.footprint as Record<string, unknown> | undefined
  if (!fp || fp.type !== 'Polygon' || !Array.isArray(fp.coordinates)) return false
  return true
}

/** PURE — map Geoscape's roof form string onto our RoofForm enum. */
export function normaliseGeoscapeRoofForm(raw: string | null | undefined): RoofForm {
  if (!raw) return 'unknown'
  const r = raw.toLowerCase()
  if (r.includes('skillion') || r.includes('mono')) return 'skillion'
  if (r.includes('gable') && r.includes('hip')) return 'gable_hip'
  if (r.includes('gable')) return 'gable'
  if (r.includes('hip')) return 'hip'
  if (r.includes('complex') || r.includes('irregular') || r.includes('mansard')) return 'complex'
  return 'unknown'
}

/** PURE — compute polygon area in m² via the shoelace formula on
 *  lng/lat after projecting to a local equirectangular metres frame.
 *  Accurate to within ~0.5% for residential building footprints in AU
 *  latitudes — good enough for Phase 1. */
export function polygonAreaM2(polygon: GeoJSONPolygon): number {
  const ring = polygon.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 4) return 0
  // Approximate metres-per-degree at the polygon centroid.
  let lat0 = 0
  for (const [, lat] of ring) lat0 += lat
  lat0 /= ring.length
  const cos = Math.cos((lat0 * Math.PI) / 180)
  const mPerDegLat = 110_574 // mean meridional metre per degree
  const mPerDegLng = 111_320 * cos
  let acc = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    const px1 = x1 * mPerDegLng
    const py1 = y1 * mPerDegLat
    const px2 = x2 * mPerDegLng
    const py2 = y2 * mPerDegLat
    acc += px1 * py2 - px2 * py1
  }
  return Math.abs(acc) / 2
}

/** PURE — convert a Geoscape building body into our RoofMetrics. */
export function buildingResponseToMetrics(
  body: GeoscapeBuildingBody,
  defaultPitch: PitchBucket,
): RoofMetrics | null {
  const polygon = body.footprint
  const declared = typeof body.buildingArea === 'number' && body.buildingArea > 0
    ? body.buildingArea
    : null
  const computed = polygonAreaM2(polygon)
  const footprint = declared ?? Math.round(computed * 10) / 10
  if (!footprint || footprint <= 0) return null

  const form = normaliseGeoscapeRoofForm(body.roofForm)
  const storeys = typeof body.storeys === 'number' && body.storeys > 0
    ? Math.round(body.storeys)
    : null

  return {
    footprint_m2: Math.round(footprint * 10) / 10,
    sloped_area_m2: slopedAreaFromFootprint(footprint, defaultPitch),
    storeys,
    form,
    hips: estimateHipsFromForm(form),
    valleys: estimateValleysFromForm(form),
    ridge_lm: null, // Phase 2 LiDAR pipeline derives this; not available from Geoscape
    polygon_geojson: polygon,
    capture_date: body.captureDate ?? null,
  }
}

/** PURE — heuristic hip count from roof form. */
export function estimateHipsFromForm(form: RoofForm): number | null {
  switch (form) {
    case 'gable':     return 0
    case 'hip':       return 4
    case 'skillion':  return 0
    case 'gable_hip': return 2
    case 'complex':   return null // do not guess
    case 'unknown':   return null
  }
}

/** PURE — heuristic valley count from roof form. */
export function estimateValleysFromForm(form: RoofForm): number | null {
  switch (form) {
    case 'gable':     return 0
    case 'hip':       return 0
    case 'skillion':  return 0
    case 'gable_hip': return 1
    case 'complex':   return null
    case 'unknown':   return null
  }
}

// ── Tiny utility helpers ────────────────────────────────────────────

function failure(
  code: RoofingMeasurementFailureCode,
  detail: string,
): RoofingMeasurementResult & { ok: false } {
  return { ok: false, code, detail }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
