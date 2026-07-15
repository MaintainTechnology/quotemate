import 'server-only'

import {
  evaluateRoofingEdgeAnalysisAccess,
  isRoofingEdgeAnalysisEnabled,
  type EdgeAnalysisEnvironment,
} from '../edge-analysis-config'
import type { RoofEdgeRetentionMode } from '../edge-analysis'

// This module is intentionally a narrow server-only acquisition seam. It
// requests Google's IMAGERY_LAYERS view (DSM, RGB, and roof mask) and returns
// transient raster bytes plus safe metadata. It does not segment facets,
// classify ridges/hips/valleys/eaves, create candidates, persist data, or
// mutate any measurement or quote.
//
// Credentials and the actual network implementation are intentionally absent:
// a future approved server-side composition must inject an authenticated
// transport. That keeps this module deterministic under test and prevents an
// accidental provider call merely because an environment key exists.

export const GOOGLE_SOLAR_DATA_LAYERS_ENDPOINT =
  'https://solar.googleapis.com/v1/dataLayers:get'
export const GOOGLE_SOLAR_DATA_LAYERS_VIEW = 'IMAGERY_LAYERS' as const
export const GOOGLE_SOLAR_DATA_LAYERS_FEATURE_FLAG =
  'ROOFING_GOOGLE_SOLAR_DATA_LAYERS_ENABLED' as const

const GOOGLE_SOLAR_ORIGIN = 'https://solar.googleapis.com'
const SUPPORTED_PIXEL_SIZES_METERS = [0.1, 0.25, 0.5, 1] as const

export type GoogleSolarImageryQuality = 'HIGH' | 'MEDIUM' | 'BASE'
export type GoogleSolarPixelSizeMeters =
  (typeof SUPPORTED_PIXEL_SIZES_METERS)[number]

export type GoogleSolarDataLayersLocation = {
  latitude: number
  longitude: number
}

/**
 * The only I/O dependency. The caller owns credentials and may attach them to
 * the request outside this module. No default `fetch` is supplied, so unit
 * tests and accidental imports cannot contact Google.
 */
export type GoogleSolarDataLayersTransport = (request: Request) => Promise<Response>

/**
 * A server-created projection of one tenant's durable approval row. A future
 * orchestrator must load and validate this from `roof_topology_source_approvals`
 * before it creates the context; neither an API key nor feature flags can
 * substitute for it. The context is never returned to a browser or persisted
 * by this acquisition seam.
 */
export type GoogleSolarTopologySourceApproval = {
  tenantId: string
  sourceApprovalId: string
  geometrySource: 'approved_google_solar'
  commercialApprovalReference: string
  approvalStatus: 'active'
  allowsDerivedGeometry: true
  retentionMode: RoofEdgeRetentionMode
  retentionExpiresAt: string | null
}

export type GoogleSolarDataLayersAcquireInput = {
  location: GoogleSolarDataLayersLocation
  radiusMeters: number
  pixelSizeMeters?: GoogleSolarPixelSizeMeters
  /** Minimum source quality accepted by the Solar API. Defaults to HIGH. */
  requiredQuality?: GoogleSolarImageryQuality
  environment?: EdgeAnalysisEnvironment
  /** Required, durable source-approval context for this specific tenant. */
  sourceApproval: GoogleSolarTopologySourceApproval | null
  /** Test-only clock injection for approval-retention validation. */
  now?: Date
  transport: GoogleSolarDataLayersTransport
}

export type GoogleSolarDataLayersMetadata = {
  source: 'approved_google_solar'
  view: typeof GOOGLE_SOLAR_DATA_LAYERS_VIEW
  location: GoogleSolarDataLayersLocation
  radiusMeters: number
  pixelSizeMeters: GoogleSolarPixelSizeMeters
  requiredQuality: GoogleSolarImageryQuality
  imageryQuality: GoogleSolarImageryQuality
  /** Full source-imagery capture date (YYYY-MM-DD). */
  imageryDate: string
  /** Full processing date when returned by Google. */
  imageryProcessedDate: string | null
}

/**
 * In-memory GeoTIFF bytes for a later, pure reconstruction engine. These are
 * deliberately not URLs, object-storage keys, or semantic edge candidates.
 */
export type GoogleSolarImageryLayerBytes = {
  dsm: ArrayBuffer
  rgb: ArrayBuffer
  mask: ArrayBuffer
}

export type GoogleSolarDataLayersAcquisition = {
  metadata: GoogleSolarDataLayersMetadata
  rasters: GoogleSolarImageryLayerBytes
}

export type GoogleSolarDataLayersFailureCode =
  | 'feature_disabled'
  | 'source_access_denied'
  | 'invalid_request'
  | 'metadata_http_error'
  | 'network_error'
  | 'invalid_response'
  | 'layer_http_error'
  | 'invalid_layer_response'

export type GoogleSolarDataLayersResult =
  | { ok: true; acquisition: GoogleSolarDataLayersAcquisition }
  | {
      ok: false
      code: GoogleSolarDataLayersFailureCode
      /** Deliberately sanitized: never includes a provider URL or error body. */
      detail: string
    }

type NormalizedRequest = {
  location: GoogleSolarDataLayersLocation
  radiusMeters: number
  pixelSizeMeters: GoogleSolarPixelSizeMeters
  requiredQuality: GoogleSolarImageryQuality
}

type ImageryLayerUrls = {
  dsm: string
  rgb: string
  mask: string
}

export type GoogleSolarDataLayersMetadataParseResult =
  | { ok: true; metadata: GoogleSolarDataLayersMetadata }
  | { ok: false; detail: string }

type PayloadParseResult =
  | { ok: true; metadata: GoogleSolarDataLayersMetadata; urls: ImageryLayerUrls }
  | { ok: false; detail: string }

const QUALITY_RANK: Readonly<Record<GoogleSolarImageryQuality, number>> = {
  BASE: 1,
  MEDIUM: 2,
  HIGH: 3,
}

/**
 * The Google-specific flag is additive to the global topology gate. It
 * intentionally ignores ROOFING_SOLAR_ENRICHMENT and every credential env var.
 * A caller must still supply a tenant-bound source-approval context derived
 * from the durable approval record before any transport can run.
 */
export function isGoogleSolarDataLayersTopologyEnabled(
  environment: EdgeAnalysisEnvironment = process.env,
): boolean {
  return (
    isRoofingEdgeAnalysisEnabled(environment) &&
    environment[GOOGLE_SOLAR_DATA_LAYERS_FEATURE_FLAG] === 'true'
  )
}

/**
 * Acquire exactly DSM, RGB, and roof-mask GeoTIFF bytes through an injected
 * authenticated transport. Provider URLs are only held in a private local
 * variable long enough to make the three downloads; they are not returned.
 */
export async function acquireGoogleSolarImageryLayers(
  input: GoogleSolarDataLayersAcquireInput,
): Promise<GoogleSolarDataLayersResult> {
  if (!isGoogleSolarDataLayersTopologyEnabled(input.environment)) {
    return failure('feature_disabled', 'Google Solar topology acquisition is disabled.')
  }

  if (!hasApprovedGoogleSolarSource(input)) {
    return failure(
      'source_access_denied',
      'A current recorded Google Solar topology approval is required before acquisition.',
    )
  }

  const normalized = normalizeRequest(input)
  if (!normalized.ok) return failure('invalid_request', normalized.detail)

  let metadataResponse: Response
  try {
    metadataResponse = await input.transport(createMetadataRequest(normalized.request))
  } catch {
    return failure('network_error', 'Google Solar metadata request failed.')
  }

  if (!metadataResponse.ok) {
    return failure('metadata_http_error', `Google Solar metadata returned HTTP ${metadataResponse.status}.`)
  }

  let body: unknown
  try {
    body = await metadataResponse.json()
  } catch {
    return failure('invalid_response', 'Google Solar metadata was not valid JSON.')
  }

  const payload = parsePayload(body, normalized.request)
  if (!payload.ok) return failure('invalid_response', payload.detail)

  const [dsm, rgb, mask] = await Promise.all([
    downloadLayer(input.transport, payload.urls.dsm),
    downloadLayer(input.transport, payload.urls.rgb),
    downloadLayer(input.transport, payload.urls.mask),
  ])
  if (!dsm.ok) return dsm
  if (!rgb.ok) return rgb
  if (!mask.ok) return mask

  return {
    ok: true,
    acquisition: {
      metadata: payload.metadata,
      rasters: {
        dsm: dsm.bytes,
        rgb: rgb.bytes,
        mask: mask.bytes,
      },
    },
  }
}

/**
 * This is deliberately checked inside the acquisition seam rather than left
 * solely to a future route. It makes an accidental direct call fail closed.
 * The durable database lookup itself belongs to that future orchestrator.
 */
function hasApprovedGoogleSolarSource(input: GoogleSolarDataLayersAcquireInput): boolean {
  const approval = input.sourceApproval
  if (
    !approval ||
    !approval.tenantId.trim() ||
    approval.geometrySource !== 'approved_google_solar' ||
    approval.approvalStatus !== 'active' ||
    approval.allowsDerivedGeometry !== true
  ) {
    return false
  }

  return evaluateRoofingEdgeAnalysisAccess({
    environment: input.environment,
    geometrySource: approval.geometrySource,
    sourceApprovalId: approval.sourceApprovalId,
    commercialApprovalReference: approval.commercialApprovalReference,
    retentionMode: approval.retentionMode,
    retentionExpiresAt: approval.retentionExpiresAt,
    now: input.now,
  }).allowed
}

/**
 * Parses only safe provenance metadata. It validates that the response has all
 * three IMAGERY_LAYERS URLs, but never returns any provider URL to its caller.
 */
export function parseGoogleSolarDataLayersMetadata(
  body: unknown,
  request: Pick<
    GoogleSolarDataLayersAcquireInput,
    'location' | 'radiusMeters' | 'pixelSizeMeters' | 'requiredQuality'
  >,
): GoogleSolarDataLayersMetadataParseResult {
  const normalized = normalizeRequest(request)
  if (!normalized.ok) return { ok: false, detail: normalized.detail }
  const parsed = parsePayload(body, normalized.request)
  return parsed.ok
    ? { ok: true, metadata: parsed.metadata }
    : { ok: false, detail: parsed.detail }
}

function normalizeRequest(
  input: Pick<
    GoogleSolarDataLayersAcquireInput,
    'location' | 'radiusMeters' | 'pixelSizeMeters' | 'requiredQuality'
  >,
): { ok: true; request: NormalizedRequest } | { ok: false; detail: string } {
  const location = input.location
  if (!isLatitude(location?.latitude) || !isLongitude(location?.longitude)) {
    return { ok: false, detail: 'Location must contain finite latitude and longitude values.' }
  }

  const pixelSizeMeters = input.pixelSizeMeters ?? 0.1
  if (!(SUPPORTED_PIXEL_SIZES_METERS as readonly number[]).includes(pixelSizeMeters)) {
    return { ok: false, detail: 'Pixel size is not supported by Google Solar Data Layers.' }
  }

  const radiusMeters = input.radiusMeters
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    return { ok: false, detail: 'Radius must be a positive finite number.' }
  }
  // Per Google Data Layers limits: <=100 m is always valid; above that, the
  // radius may not exceed pixelSizeMeters × 1000. IMAGERY_LAYERS includes no
  // monthly/hourly flux, so the >175 m flux restriction does not apply.
  if (radiusMeters > 100 && radiusMeters > pixelSizeMeters * 1000) {
    return { ok: false, detail: 'Radius exceeds the allowed limit for the pixel size.' }
  }

  const requiredQuality = input.requiredQuality ?? 'HIGH'
  if (!isImageryQuality(requiredQuality)) {
    return { ok: false, detail: 'Required imagery quality is unsupported.' }
  }

  return {
    ok: true,
    request: {
      location: { latitude: location.latitude, longitude: location.longitude },
      radiusMeters,
      pixelSizeMeters,
      requiredQuality,
    },
  }
}

function createMetadataRequest(input: NormalizedRequest): Request {
  const url = new URL(GOOGLE_SOLAR_DATA_LAYERS_ENDPOINT)
  url.searchParams.set('location.latitude', input.location.latitude.toFixed(7))
  url.searchParams.set('location.longitude', input.location.longitude.toFixed(7))
  url.searchParams.set('radiusMeters', String(input.radiusMeters))
  url.searchParams.set('pixelSizeMeters', String(input.pixelSizeMeters))
  url.searchParams.set('requiredQuality', input.requiredQuality)
  url.searchParams.set('view', GOOGLE_SOLAR_DATA_LAYERS_VIEW)

  return new Request(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    redirect: 'error',
  })
}

function parsePayload(body: unknown, request: NormalizedRequest): PayloadParseResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, detail: 'Google Solar metadata must be an object.' }
  }
  const root = body as Record<string, unknown>
  const imageryQuality = root.imageryQuality
  if (!isImageryQuality(imageryQuality)) {
    return { ok: false, detail: 'Google Solar metadata has no supported imagery quality.' }
  }
  if (QUALITY_RANK[imageryQuality] < QUALITY_RANK[request.requiredQuality]) {
    return { ok: false, detail: 'Google Solar imagery quality is below the requested minimum.' }
  }

  const imageryDate = toFullIsoDate(root.imageryDate)
  if (!imageryDate) {
    return { ok: false, detail: 'Google Solar metadata has no valid full imagery date.' }
  }
  const imageryProcessedDate =
    root.imageryProcessedDate === undefined ? null : toFullIsoDate(root.imageryProcessedDate)
  if (root.imageryProcessedDate !== undefined && !imageryProcessedDate) {
    return { ok: false, detail: 'Google Solar metadata has an invalid imagery processed date.' }
  }

  const urls = imageryLayerUrls(root)
  if (!urls) {
    return { ok: false, detail: 'Google Solar IMAGERY_LAYERS response is missing trusted DSM, RGB, or mask data.' }
  }

  return {
    ok: true,
    metadata: {
      source: 'approved_google_solar',
      view: GOOGLE_SOLAR_DATA_LAYERS_VIEW,
      location: { ...request.location },
      radiusMeters: request.radiusMeters,
      pixelSizeMeters: request.pixelSizeMeters,
      requiredQuality: request.requiredQuality,
      imageryQuality,
      imageryDate,
      imageryProcessedDate,
    },
    urls,
  }
}

function imageryLayerUrls(root: Record<string, unknown>): ImageryLayerUrls | null {
  const dsm = trustedProviderUrl(root.dsmUrl)
  const rgb = trustedProviderUrl(root.rgbUrl)
  const mask = trustedProviderUrl(root.maskUrl)
  return dsm && rgb && mask ? { dsm, rgb, mask } : null
}

function trustedProviderUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === GOOGLE_SOLAR_ORIGIN ? url.toString() : null
  } catch {
    return null
  }
}

async function downloadLayer(
  transport: GoogleSolarDataLayersTransport,
  url: string,
): Promise<
  | { ok: true; bytes: ArrayBuffer }
  | {
      ok: false
      code: 'layer_http_error' | 'invalid_layer_response' | 'network_error'
      detail: string
    }
> {
  let response: Response
  try {
    response = await transport(
      new Request(url, {
        method: 'GET',
        headers: { Accept: 'image/tiff, image/geotiff, application/octet-stream;q=0.9' },
        cache: 'no-store',
        redirect: 'error',
      }),
    )
  } catch {
    return failure('network_error', 'Google Solar imagery download failed.')
  }
  if (!response.ok) {
    return failure('layer_http_error', `Google Solar imagery returned HTTP ${response.status}.`)
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (
    contentType &&
    !contentType.includes('image/tiff') &&
    !contentType.includes('image/geotiff') &&
    !contentType.includes('application/octet-stream')
  ) {
    return failure('invalid_layer_response', 'Google Solar imagery had an unsupported content type.')
  }

  try {
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength === 0) {
      return failure('invalid_layer_response', 'Google Solar imagery was empty.')
    }
    return { ok: true, bytes }
  } catch {
    return failure('invalid_layer_response', 'Google Solar imagery could not be read.')
  }
}

function toFullIsoDate(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const date = value as Record<string, unknown>
  const year = typeof date.year === 'number' ? date.year : null
  const month = typeof date.month === 'number' ? date.month : null
  const day = typeof date.day === 'number' ? date.day : null
  if (
    year === null ||
    month === null ||
    day === null ||
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null
  }
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function isLatitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90
}

function isLongitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180
}

function isImageryQuality(value: unknown): value is GoogleSolarImageryQuality {
  return value === 'HIGH' || value === 'MEDIUM' || value === 'BASE'
}

function failure<
  TCode extends GoogleSolarDataLayersFailureCode,
>(code: TCode, detail: string): { ok: false; code: TCode; detail: string } {
  return { ok: false, code, detail }
}
