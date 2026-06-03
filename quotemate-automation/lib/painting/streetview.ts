// ════════════════════════════════════════════════════════════════════
// Painting — Google Street View Static API URL builders.
//
// For a paint preview the relevant photo is the FRONT of the house (the
// walls + trim you paint), so we use Street View — not the satellite
// aerial the roofing tool uses (which shows the roof). Same
// GOOGLE_MAPS_API_KEY; the "Street View Static API" must be enabled on
// the project.
//
// SECURITY: the key stays server-side. These builders make the URL; the
// /api/painting/street-view route fetches the image and streams it to the
// browser without exposing the key.
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

const DEFAULT_IMAGE_URL = 'https://maps.googleapis.com/maps/api/streetview'
const DEFAULT_METADATA_URL =
  'https://maps.googleapis.com/maps/api/streetview/metadata'

export type StreetViewInput = {
  /** Address string OR an explicit {lat,lng}. One is required. */
  location: string | { lat: number; lng: number }
  /** Pixel dimensions. Free-tier max is 640×640. */
  size?: { width: number; height: number }
  /** Field of view (degrees). Lower = more zoom. ~80–90 frames a house well. */
  fov?: number
  /** Up/down angle. A few degrees up flatters a single-storey façade. */
  pitch?: number
  /** Compass heading. Omit to let Google point at the location. */
  heading?: number
  /** Retina density. 2 is free-tier OK. */
  scale?: 1 | 2
}

export type StreetViewOpts = { apiKey: string; baseUrl?: string }

const DEFAULTS = {
  size: { width: 640, height: 480 },
  fov: 85,
  pitch: 8,
  scale: 2 as const,
}

function locationParam(location: StreetViewInput['location']): string {
  return typeof location === 'string'
    ? location
    : `${location.lat},${location.lng}`
}

/** PURE — build a Street View Static image URL. */
export function buildStreetViewUrl(
  input: StreetViewInput,
  opts: StreetViewOpts,
): string {
  if (!opts.apiKey) throw new Error('buildStreetViewUrl: apiKey is required')
  if (!input.location) throw new Error('buildStreetViewUrl: location is required')
  const base = opts.baseUrl ?? DEFAULT_IMAGE_URL
  const size = clampSize(input.size ?? DEFAULTS.size)
  const params = new URLSearchParams()
  params.set('size', `${size.width}x${size.height}`)
  params.set('location', locationParam(input.location))
  params.set('fov', String(input.fov ?? DEFAULTS.fov))
  params.set('pitch', String(input.pitch ?? DEFAULTS.pitch))
  if (typeof input.heading === 'number') params.set('heading', String(input.heading))
  params.set('scale', String(input.scale ?? DEFAULTS.scale))
  params.set('return_error_code', 'true') // 404 instead of a grey "no imagery" tile
  params.set('source', 'outdoor') // prefer street-level outdoor panoramas
  params.set('key', opts.apiKey)
  return `${base}?${params.toString()}`
}

/** PURE — build the (free) Street View metadata URL to check a pano exists. */
export function buildStreetViewMetadataUrl(
  input: Pick<StreetViewInput, 'location'>,
  opts: StreetViewOpts,
): string {
  if (!opts.apiKey) throw new Error('buildStreetViewMetadataUrl: apiKey is required')
  const base = opts.baseUrl ?? DEFAULT_METADATA_URL
  const params = new URLSearchParams()
  params.set('location', locationParam(input.location))
  params.set('source', 'outdoor')
  params.set('key', opts.apiKey)
  return `${base}?${params.toString()}`
}

/** PURE — interpret a Street View metadata body. status 'OK' = imagery exists. */
export function parseStreetViewMetadata(
  body: unknown,
): { ok: true; date: string | null; panoId: string | null } | { ok: false; status: string } {
  if (!body || typeof body !== 'object') return { ok: false, status: 'NO_BODY' }
  const b = body as Record<string, unknown>
  const status = typeof b.status === 'string' ? b.status : 'UNKNOWN'
  if (status !== 'OK') return { ok: false, status }
  return {
    ok: true,
    date: typeof b.date === 'string' ? b.date : null,
    panoId: typeof b.pano_id === 'string' ? b.pano_id : null,
  }
}

/** PURE — Street View Static free tier caps at 640×640. */
export function clampSize(size: {
  width: number
  height: number
}): { width: number; height: number } {
  const MAX = 640
  return {
    width: Math.max(64, Math.min(MAX, Math.floor(size.width))),
    height: Math.max(64, Math.min(MAX, Math.floor(size.height))),
  }
}

/** PURE — remove the API key from a URL for logging / display. */
export function redactKey(url: string): string {
  return url.replace(/([?&])key=[^&]*/g, '$1key=***')
}
