// ════════════════════════════════════════════════════════════════════
// Roofing — Google Street View Static API URL builders (Tier-2 display).
//
// A ground-level front elevation of the property. UNLIKE the Solar /
// Geoscape data, this is DISPLAY-ONLY — it never feeds area / pitch /
// price (same posture as the Static satellite map). Its value is the
// access & height read the top-down imagery can't give the tradie:
// single vs double storey, scaffold / EWP need, powerlines, overhanging
// trees, gutter / fascia condition.
//
// SECURITY: the key stays server-side. This module only builds URLs; the
// /api/roofing/street-view route fetches the metadata + image and streams
// the image back without exposing the key.
//
// The Street View Static API has a free METADATA endpoint that reports
// whether a panorama exists at a location ('OK' vs 'ZERO_RESULTS'). The
// route checks it first so we can show a clean "no street imagery here"
// fallback instead of Google's generic grey placeholder.
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

export type StreetViewInput = {
  /** Street address — Google geocodes it. Either this OR `location`. */
  address?: string
  /** Explicit coordinate. Overrides address when set. */
  location?: { lat: number; lng: number }
  /** Pixel dimensions. Free tier max is 640×640. */
  size?: { width: number; height: number }
  /** Field of view in degrees (zoom). 10–120; default 80. */
  fov?: number
  /** Compass heading 0–360. Omit → Google points the camera AT the
   *  location (the building), which is what we want by default. */
  heading?: number
  /** Up/down angle −90..90. Default 8 — a touch up to catch the roofline. */
  pitch?: number
}

export type StreetViewOpts = {
  apiKey: string
  baseUrl?: string
  metadataBaseUrl?: string
}

const DEFAULT_IMAGE_URL = 'https://maps.googleapis.com/maps/api/streetview'
const DEFAULT_METADATA_URL = 'https://maps.googleapis.com/maps/api/streetview/metadata'

const DEFAULTS = {
  size: { width: 640, height: 400 },
  fov: 80,
  pitch: 8,
}

/** PURE — shared location/framing params for both the image + metadata URLs. */
function locationParams(input: StreetViewInput): URLSearchParams {
  const params = new URLSearchParams()
  if (input.location) {
    params.set('location', `${input.location.lat},${input.location.lng}`)
  } else if (input.address) {
    params.set('location', input.address)
  }
  return params
}

/** PURE — build the Street View Static *image* URL. Throws when neither
 *  address nor location is supplied (the API requires one). */
export function buildStreetViewUrl(input: StreetViewInput, opts: StreetViewOpts): string {
  if (!opts.apiKey) throw new Error('buildStreetViewUrl: apiKey is required')
  if (!input.address && !input.location) {
    throw new Error('buildStreetViewUrl: address or location is required')
  }
  const base = opts.baseUrl ?? DEFAULT_IMAGE_URL
  const params = locationParams(input)

  const size = clampSize(input.size ?? DEFAULTS.size)
  params.set('size', `${size.width}x${size.height}`)
  params.set('fov', String(clampFov(input.fov ?? DEFAULTS.fov)))
  params.set('pitch', String(clampPitch(input.pitch ?? DEFAULTS.pitch)))
  if (input.heading !== undefined && Number.isFinite(input.heading)) {
    params.set('heading', String(clampHeading(input.heading)))
  }
  // 'outdoor' avoids dropping the camera into a business interior pano.
  params.set('source', 'outdoor')
  params.set('return_error_code', 'true')
  params.set('key', opts.apiKey)
  return `${base}?${params.toString()}`
}

/** PURE — build the free metadata URL (status pre-check, no billing). */
export function buildStreetViewMetadataUrl(input: StreetViewInput, opts: StreetViewOpts): string {
  if (!opts.apiKey) throw new Error('buildStreetViewMetadataUrl: apiKey is required')
  if (!input.address && !input.location) {
    throw new Error('buildStreetViewMetadataUrl: address or location is required')
  }
  const base = opts.metadataBaseUrl ?? DEFAULT_METADATA_URL
  const params = locationParams(input)
  params.set('source', 'outdoor')
  params.set('key', opts.apiKey)
  return `${base}?${params.toString()}`
}

// ── Clamp helpers (free-tier safety) ────────────────────────────────

/** PURE — Street View Static free tier caps at 640×640. */
export function clampSize(size: { width: number; height: number }): { width: number; height: number } {
  const MAX = 640
  return {
    width: Math.max(64, Math.min(MAX, Math.floor(size.width))),
    height: Math.max(64, Math.min(MAX, Math.floor(size.height))),
  }
}

/** PURE — FOV is 10..120 degrees. */
export function clampFov(fov: number): number {
  if (!Number.isFinite(fov)) return DEFAULTS.fov
  return Math.max(10, Math.min(120, Math.round(fov)))
}

/** PURE — pitch is −90..90 degrees. */
export function clampPitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return DEFAULTS.pitch
  return Math.max(-90, Math.min(90, Math.round(pitch)))
}

/** PURE — heading normalised to 0..359. */
export function clampHeading(heading: number): number {
  if (!Number.isFinite(heading)) return 0
  return ((Math.round(heading) % 360) + 360) % 360
}

/** PURE — Street View metadata status string from a parsed response. */
export function parseMetadataStatus(body: unknown): string {
  if (body && typeof body === 'object' && typeof (body as { status?: unknown }).status === 'string') {
    return (body as { status: string }).status
  }
  return 'UNKNOWN_ERROR'
}

/** PURE — remove the API key from a URL for logging / display. */
export function redactKey(url: string): string {
  return url.replace(/([?&])key=[^&]*/g, '$1key=***')
}
