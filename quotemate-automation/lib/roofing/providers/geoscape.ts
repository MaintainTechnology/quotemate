// ════════════════════════════════════════════════════════════════════
// Roofing — Geoscape Addresses + Buildings adapter.
//
// Phase 1 flow:
//   1. Addresses API     — address text → addressId
//   2. Buildings API     — addressId    → footprint polygon, roof attrs
//
// Premium account "quoteMate-test" (confirmed 2026-05-29) has access to
// the Predictive, Addresses, Buildings, Maps, Land Parcels, Esri-Locator,
// Administrative Boundaries, Datasets, and Batches APIs.
//
// The Predictive API is wired separately in lib/roofing/providers/predictive.ts
// because it powers the dashboard input's type-ahead autocomplete, not
// the address→building resolution path used by the orchestrator.
//
// ── What's confirmed from the public docs ────────────────────────────
//   • Auth: API key passed via the Authorization header (not Bearer-prefixed).
//   • Base URL: api.geoscape.com.au/v1 (the legacy api.psma.com.au domain
//     still answers but is being deprecated — we use the canonical one).
//   • The Buildings dataset returns a footprint polygon classified from
//     remotely-sensed imagery, plus core attributes; the Roof Insight
//     Pack adds roof_shape; the Height pack adds storeys.
//
// ── What's NOT confirmed without a live probe ────────────────────────
// The exact JSON field names vary between Stoplight's OAS spec and the
// historical PSMA spec. The parser below is DELIBERATELY LENIENT —
// every "what's the field called" lookup tries the documented name +
// the common camelCase / snake_case variants. Once the user runs
// scripts/probe-geoscape-apis.mjs and pastes a real response back,
// we tighten the parser to the actual field names.
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

// CONFIRMED 2026-05-29 by directly probing the host:
//   • api.geoscape.com.au          → DNS / connection refused (not a real host)
//   • api.psma.com.au/v1/...        → 401 Unauthorized (live, awaiting key)
//   • api.psma.com.au/beta/v1/...   → 404 (legacy path deprecated)
// → The live base is api.psma.com.au/v1. The "geoscape.com.au" domain is
//   the marketing + docs front; API traffic still flows over the PSMA host.
const DEFAULT_BASE_URL =
  process.env.GEOSCAPE_API_BASE_URL ?? 'https://api.psma.com.au/v1'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type GeoscapeProviderOpts = {
  apiKey?: string
  baseUrl?: string
  fetchImpl?: FetchLike
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
    // Confirmed via probe 2026-05-29: the Addresses API expects the
    // search text in the `addressString` query parameter (NOT `query`,
    // which is what we sent originally and got back the backend's
    // "[addressString] parameter is required" 400). State is similarly
    // named — kept as `state` per the docs.
    const url = `${this.baseUrl}/addresses?addressString=${encodeURIComponent(
      input.address,
    )}&state=${encodeURIComponent(input.state)}&perPage=1`
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: this.apiKey!, Accept: 'application/json' },
      })
    } catch (e) {
      return failure('provider_unavailable', friendlyFetchError(e, this.baseUrl))
    }
    if (res.status === 429) return failure('provider_rate_limited', 'Geoscape rate-limited (429).')
    if (res.status === 401 || res.status === 403) {
      return failure(
        'provider_unavailable',
        `Geoscape auth failed (HTTP ${res.status}) — check the API key has Addresses + Buildings products enabled.`,
      )
    }
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
    // Buildings API endpoint pattern per the PSMA spec is
    // /buildings/{buildingId} BUT we don't have the buildingId yet —
    // we have an addressId. The documented bridge is the
    // /buildings?addressId={id} query OR /addresses/{id}/buildings.
    // Phase 1 uses the query form; the probe script verifies which is
    // active on the user's actual subscription.
    const url = `${this.baseUrl}/buildings?addressId=${encodeURIComponent(addressId)}`
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: this.apiKey!, Accept: 'application/json' },
      })
    } catch (e) {
      return failure('provider_unavailable', friendlyFetchError(e, this.baseUrl))
    }
    if (res.status === 429) return failure('provider_rate_limited', 'Geoscape rate-limited (429).')
    if (res.status === 404) {
      return failure('no_building_at_address', 'Geoscape has no building record at this address.')
    }
    if (res.status === 401 || res.status === 403) {
      return failure(
        'provider_unavailable',
        `Geoscape auth failed (HTTP ${res.status}) on the Buildings API — check the Buildings product is enabled on the key.`,
      )
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
    const normalised = normaliseBuildingBody(body)
    if (!normalised) {
      return failure('provider_invalid_response', 'Geoscape building lookup returned an unexpected shape.')
    }
    return { ok: true, body: normalised }
  }
}

// ── Pure helpers (testable in isolation) ────────────────────────────

/**
 * PURE — pluck the first address id from an Addresses API response.
 * Tolerates every documented envelope: { data: [{id}] }, { results: [...] },
 * { features: [{ properties: { addressId } }] } (GeoJSON FeatureCollection),
 * or a bare { id }.
 */
export function pickAddressId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>

  // Direct shape
  if (typeof b.id === 'string') return b.id
  if (typeof b.addressId === 'string') return b.addressId
  if (typeof b.address_id === 'string') return b.address_id
  if (typeof b.pid === 'string') return b.pid

  // { data: [{...}] }
  const data = (b as { data?: unknown }).data
  if (Array.isArray(data) && data.length > 0) {
    const id = pickAddressId(data[0])
    if (id) return id
  }
  // { results: [{...}] }
  const results = (b as { results?: unknown }).results
  if (Array.isArray(results) && results.length > 0) {
    const id = pickAddressId(results[0])
    if (id) return id
  }
  // GeoJSON FeatureCollection — { features: [{ properties: {...} }] }
  const features = (b as { features?: unknown }).features
  if (Array.isArray(features) && features.length > 0) {
    const first = features[0] as { properties?: unknown }
    if (first?.properties) {
      const id = pickAddressId(first.properties)
      if (id) return id
    }
  }
  return null
}

/** Internal: the shape we depend on after normalisation. */
export type GeoscapeBuildingBody = {
  footprint: GeoJSONPolygon
  roofForm?: string | null
  storeys?: number | null
  buildingArea?: number | null
  captureDate?: string | null
}

/**
 * PURE — normalise the Buildings response onto our internal shape.
 * Geoscape may wrap the building in { data }, return a Feature, or
 * return it as a bare object. The polygon may live under `footprint`,
 * `geometry`, `polygon`, or `roofOutline`. Roof shape may be `roofShape`,
 * `roof_shape`, `roofForm`, or `form`. Storeys may be `storeys`,
 * `numberOfStoreys`, or `floors`. This function pulls them all out.
 */
export function normaliseBuildingBody(body: unknown): GeoscapeBuildingBody | null {
  if (!body || typeof body !== 'object') return null
  let b = body as Record<string, unknown>

  // Unwrap common envelopes.
  if (Array.isArray((b as { data?: unknown }).data) && (b as { data: unknown[] }).data.length > 0) {
    const first = (b as { data: unknown[] }).data[0]
    if (first && typeof first === 'object') b = first as Record<string, unknown>
  }
  if ((b as { type?: unknown }).type === 'Feature' && (b as { properties?: unknown }).properties) {
    // GeoJSON Feature — merge properties up. Geometry stays at top.
    const props = (b as { properties: Record<string, unknown> }).properties
    const geom = (b as { geometry?: unknown }).geometry
    b = { ...props, geometry: geom }
  }
  if ((b as { type?: unknown }).type === 'FeatureCollection') {
    const feats = (b as { features?: unknown[] }).features ?? []
    if (feats.length > 0) {
      return normaliseBuildingBody(feats[0])
    }
    return null
  }

  // Polygon lookup — try the documented + likely names.
  const polygon = pickPolygon(b)
  if (!polygon) return null

  return {
    footprint: polygon,
    roofForm: pickString(b, ['roofShape', 'roof_shape', 'roofForm', 'roof_form', 'form']) ?? null,
    storeys: pickNumber(b, ['storeys', 'numberOfStoreys', 'number_of_storeys', 'floors', 'numberOfFloors']),
    buildingArea: pickNumber(b, ['planarArea', 'planar_area', 'area', 'buildingArea', 'building_area', 'groundArea', 'ground_area']),
    captureDate: pickString(b, ['captureDate', 'capture_date', 'positionalAccuracyDate', 'imageDate']) ?? null,
  }
}

/** PURE — find a GeoJSON Polygon nested under any of the documented field names. */
export function pickPolygon(b: Record<string, unknown>): GeoJSONPolygon | null {
  const tryPaths = ['footprint', 'geometry', 'polygon', 'roofOutline', 'roof_outline']
  for (const key of tryPaths) {
    const v = b[key]
    if (v && typeof v === 'object') {
      const g = v as Record<string, unknown>
      if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
        return { type: 'Polygon', coordinates: g.coordinates as number[][][] }
      }
    }
  }
  return null
}

function pickString(b: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = b[k]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return null
}

function pickNumber(b: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = b[k]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  }
  return null
}

/** PURE — back-compat shim for the old isGeoscapeBuildingBody test. */
export function isGeoscapeBuildingBody(body: unknown): body is GeoscapeBuildingBody {
  return normaliseBuildingBody(body) !== null
}

/** PURE — map Geoscape's roof form string onto our RoofForm enum. */
export function normaliseGeoscapeRoofForm(raw: string | null | undefined): RoofForm {
  if (!raw) return 'unknown'
  const r = raw.toLowerCase()
  if (r.includes('skillion') || r.includes('mono')) return 'skillion'
  if (r.includes('gable') && r.includes('hip')) return 'gable_hip'
  if (r.includes('gable')) return 'gable'
  if (r.includes('hip')) return 'hip'
  if (r.includes('complex') || r.includes('irregular') || r.includes('mansard') || r.includes('dome') || r.includes('flat')) return 'complex'
  return 'unknown'
}

/** PURE — polygon area in m² via shoelace + equirectangular projection. */
export function polygonAreaM2(polygon: GeoJSONPolygon): number {
  const ring = polygon.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 4) return 0
  let lat0 = 0
  for (const [, lat] of ring) lat0 += lat
  lat0 /= ring.length
  const cos = Math.cos((lat0 * Math.PI) / 180)
  const mPerDegLat = 110_574
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

/** PURE — convert a normalised Geoscape building body into RoofMetrics. */
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
    ridge_lm: null,
    polygon_geojson: polygon,
    capture_date: body.captureDate ?? null,
  }
}

export function estimateHipsFromForm(form: RoofForm): number | null {
  switch (form) {
    case 'gable':     return 0
    case 'hip':       return 4
    case 'skillion':  return 0
    case 'gable_hip': return 2
    case 'complex':   return null
    case 'unknown':   return null
  }
}

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

/**
 * PURE — turn a generic fetch failure into an actionable message that
 * names the most likely cause. fetch() in undici throws "fetch failed"
 * for both DNS resolution failures (ENOTFOUND) and connection refused
 * (ECONNREFUSED); the underlying cause is exposed on err.cause.
 *
 * Common in this codebase: the dashboard says "Geoscape network error:
 * fetch failed" when api.geoscape.com.au doesn't resolve — instead we
 * surface "host not reachable, check GEOSCAPE_API_BASE_URL".
 */
export function friendlyFetchError(e: unknown, baseUrl: string): string {
  const msg = errorMessage(e).toLowerCase()
  const causeMsg =
    e && typeof e === 'object' && 'cause' in e
      ? errorMessage((e as { cause?: unknown }).cause).toLowerCase()
      : ''
  const combined = `${msg} ${causeMsg}`
  if (
    combined.includes('enotfound') ||
    combined.includes('econnrefused') ||
    combined.includes('eai_again') ||
    combined.includes('etimedout') ||
    combined.includes('fetch failed')
  ) {
    return (
      `Geoscape host not reachable at ${baseUrl}. ` +
      `Confirm GEOSCAPE_API_BASE_URL in .env.local — the live host is ` +
      `https://api.psma.com.au/v1 (the api.geoscape.com.au domain does not ` +
      `accept API traffic).`
    )
  }
  return `Geoscape network error: ${errorMessage(e)}`
}
