// ════════════════════════════════════════════════════════════════════
// Solar — dataLayers client (best-effort imagery/heatmap availability).
//
// Google Solar `dataLayers:get` returns GeoTIFF URLs (DSM, RGB, mask,
// annual/monthly flux, hourly shade) plus imagery metadata. We DO NOT
// persist the GeoTIFF URLs — they are signed, short-lived, and large.
// Instead we record a compact SolarDataLayersSummary: which layers exist,
// the imagery quality/date, and the request parameters — enough to drive a
// future shade/heatmap view and to date-stamp the imagery on the quote.
//
// This is pure enrichment: a missing key or any error must NEVER block the
// solar quote path. Every failure collapses to status 'skipped'/'unavailable'.
// Pure parser + injectable-fetch wrapper, mirroring address-validation.ts.
// ════════════════════════════════════════════════════════════════════

import type {
  LatLng,
  SolarDataLayersSummary,
  SolarImageryQuality,
} from './types'

const DEFAULT_BASE_URL =
  process.env.GOOGLE_SOLAR_DATA_LAYERS_API_URL ??
  'https://solar.googleapis.com/v1/dataLayers:get'

const DEFAULT_RADIUS_METERS = 50
const DEFAULT_PIXEL_SIZE_METERS = 0.5
const DEFAULT_VIEW = 'FULL_LAYERS'
const DEFAULT_REQUIRED_QUALITY: SolarImageryQuality = 'MEDIUM'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type SolarDataLayersOpts = {
  apiKey: string | undefined
  fetchImpl?: FetchLike
  baseUrl?: string
  /** Search radius around the centre, metres. Default 50. */
  radiusMeters?: number
  /** Desired raster resolution, metres/pixel. Default 0.5. */
  pixelSizeMeters?: number
  /** Solar API `view` enum. Default FULL_LAYERS. */
  view?: string
  /** Minimum imagery quality requested. Default MEDIUM (money-path floor). */
  requiredQuality?: SolarImageryQuality
}

/**
 * Best-effort fetch of dataLayers for a coordinate. Returns a compact
 * summary; never throws. Missing key → 'skipped'; any error → 'unavailable'.
 */
export async function fetchSolarDataLayers(
  location: LatLng,
  opts: SolarDataLayersOpts,
): Promise<SolarDataLayersSummary> {
  const radius = opts.radiusMeters ?? DEFAULT_RADIUS_METERS
  const pixelSize = opts.pixelSizeMeters ?? DEFAULT_PIXEL_SIZE_METERS
  const view = opts.view ?? DEFAULT_VIEW
  const requiredQuality = opts.requiredQuality ?? DEFAULT_REQUIRED_QUALITY

  const meta = { radius, pixelSize, view }

  if (!opts.apiKey) {
    return skipped(meta, 'Solar dataLayers API key is not configured.')
  }

  const base = opts.baseUrl ?? DEFAULT_BASE_URL
  const url =
    `${base}?location.latitude=${encodeURIComponent(location.lat.toFixed(7))}` +
    `&location.longitude=${encodeURIComponent(location.lng.toFixed(7))}` +
    `&radiusMeters=${encodeURIComponent(String(radius))}` +
    `&view=${encodeURIComponent(view)}` +
    `&requiredQuality=${encodeURIComponent(requiredQuality)}` +
    `&pixelSizeMeters=${encodeURIComponent(String(pixelSize))}` +
    `&key=${encodeURIComponent(opts.apiKey)}`
  const fetchImpl = opts.fetchImpl ?? ((u, init) => fetch(u, init))

  let res: Response
  try {
    res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } })
  } catch (e) {
    return unavailable(meta, e instanceof Error ? e.message : String(e))
  }

  if (!res.ok) {
    return unavailable(meta, `Solar dataLayers API HTTP ${res.status}.`)
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    return unavailable(meta, 'Solar dataLayers API returned non-JSON.')
  }

  return parseDataLayersResponse(body, meta)
}

/**
 * PURE — map a dataLayers response body onto SolarDataLayersSummary. The
 * GeoTIFF URLs are reduced to booleans (present/absent); only imagery
 * metadata + layer availability are kept.
 */
export function parseDataLayersResponse(
  body: unknown,
  meta: { radius: number; pixelSize: number; view: string },
): SolarDataLayersSummary {
  if (!body || typeof body !== 'object') {
    return unavailable(meta, 'Solar dataLayers API returned a non-object body.')
  }

  const root = body as Record<string, unknown>
  const hourly = Array.isArray(root.hourlyShadeUrls)
    ? root.hourlyShadeUrls.filter((u): u is string => typeof u === 'string').length
    : 0

  return {
    status: 'available',
    fetched_at: new Date().toISOString(),
    radius_meters: meta.radius,
    pixel_size_meters: meta.pixelSize,
    view: meta.view,
    imagery_quality: normaliseQuality(root.imageryQuality),
    imagery_date: formatGoogleDate(root.imageryDate),
    imagery_processed_date: formatGoogleDate(root.imageryProcessedDate),
    layers: {
      dsm: hasUrl(root.dsmUrl),
      rgb: hasUrl(root.rgbUrl),
      mask: hasUrl(root.maskUrl),
      annual_flux: hasUrl(root.annualFluxUrl),
      monthly_flux: hasUrl(root.monthlyFluxUrl),
      hourly_shade_months: hourly,
    },
    detail: null,
  }
}

// ── helpers ──────────────────────────────────────────────────────────

const EMPTY_LAYERS: SolarDataLayersSummary['layers'] = {
  dsm: false,
  rgb: false,
  mask: false,
  annual_flux: false,
  monthly_flux: false,
  hourly_shade_months: 0,
}

function skipped(
  meta: { radius: number; pixelSize: number; view: string },
  detail: string,
): SolarDataLayersSummary {
  return base('skipped', meta, detail)
}

function unavailable(
  meta: { radius: number; pixelSize: number; view: string },
  detail: string,
): SolarDataLayersSummary {
  return base('unavailable', meta, detail)
}

function base(
  status: 'skipped' | 'unavailable',
  meta: { radius: number; pixelSize: number; view: string },
  detail: string,
): SolarDataLayersSummary {
  return {
    status,
    fetched_at: null,
    radius_meters: meta.radius,
    pixel_size_meters: meta.pixelSize,
    view: meta.view,
    imagery_quality: null,
    imagery_date: null,
    imagery_processed_date: null,
    layers: { ...EMPTY_LAYERS },
    detail,
  }
}

function hasUrl(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0
}

function normaliseQuality(value: unknown): SolarImageryQuality | null {
  if (value === 'HIGH' || value === 'MEDIUM' || value === 'LOW') return value
  return null
}

/** Google Solar dates arrive as { year, month, day }. → ISO YYYY-MM-DD. */
function formatGoogleDate(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const d = value as Record<string, unknown>
  const year = typeof d.year === 'number' ? d.year : null
  const month = typeof d.month === 'number' ? d.month : null
  const day = typeof d.day === 'number' ? d.day : null
  if (year === null || month === null || day === null) return null
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}
