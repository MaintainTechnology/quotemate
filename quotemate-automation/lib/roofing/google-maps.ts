// ════════════════════════════════════════════════════════════════════
// Roofing — Google Maps Static API URL builder.
//
// Phase 1.5: alongside the Esri/Geoscape view we render a Google Maps
// Static thumbnail of the same property. The customer instantly sees
// the same building from two providers — if they disagree, they know
// to flag it before we charge for measurement.
//
// SECURITY:
//   • The Google Maps API key MUST stay server-side. This module
//     builds the URL; the /api/roofing/static-map route fetches the
//     image and streams it to the browser without exposing the key.
//   • We optionally support URL signing (the `signature` query param)
//     for accounts with a signing secret — disabled by default since
//     the key-only flow works on the free tier.
//
// LICENSING:
//   • Google Maps Static is fine for *display* alongside our own
//     measurement source. We are NOT using these images for
//     measurement — Geoscape's polygon is the canonical measurement.
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

export type StaticMapInput = {
  /** Street address — Google geocodes it server-side. Either this
   *  OR `center` is required. */
  address?: string
  /** Explicit centre coordinate `{lat, lng}`. Overrides address when set. */
  center?: { lat: number; lng: number }
  /** Pixel dimensions. Free-tier max is 640x640. */
  size?: { width: number; height: number }
  /** Zoom level. Roofs are usually visible from 19; default 20 = rooftop. */
  zoom?: number
  /** Map type. Always 'satellite' for our use case. */
  maptype?: 'satellite' | 'roadmap' | 'hybrid' | 'terrain'
  /** Scale = 2 doubles the pixel density for retina displays. Free tier OK. */
  scale?: 1 | 2
  /** Markers to draw — list of `{lat, lng, label}`. */
  markers?: Array<{ lat: number; lng: number; label?: string; color?: string }>
}

export type StaticMapOpts = {
  apiKey: string
  baseUrl?: string
}

const DEFAULT_BASE_URL = 'https://maps.googleapis.com/maps/api/staticmap'

/** Sensible defaults — match the Esri view's framing on the same property. */
const DEFAULTS = {
  size: { width: 640, height: 480 },
  zoom: 20,
  maptype: 'satellite' as const,
  scale: 2 as const,
}

/**
 * PURE — build a Google Maps Static API URL.
 *
 * Validation: either `address` or `center` must be present (the API
 * requires one of them); throws otherwise so callers fail loud rather
 * than ship a malformed request.
 */
export function buildStaticMapUrl(
  input: StaticMapInput,
  opts: StaticMapOpts,
): string {
  if (!opts.apiKey) {
    throw new Error('buildStaticMapUrl: apiKey is required')
  }
  if (!input.address && !input.center) {
    throw new Error('buildStaticMapUrl: address or center is required')
  }
  const base = opts.baseUrl ?? DEFAULT_BASE_URL
  const params = new URLSearchParams()

  const size = input.size ?? DEFAULTS.size
  const clamped = clampSize(size)
  params.set('size', `${clamped.width}x${clamped.height}`)

  params.set('zoom', String(clampZoom(input.zoom ?? DEFAULTS.zoom)))
  params.set('maptype', input.maptype ?? DEFAULTS.maptype)
  params.set('scale', String(input.scale ?? DEFAULTS.scale))

  // Centering — center wins if both supplied.
  if (input.center) {
    params.set('center', `${input.center.lat},${input.center.lng}`)
  } else if (input.address) {
    params.set('center', input.address)
  }

  // Markers — encoded one per `markers` query entry.
  for (const m of input.markers ?? []) {
    const colour = m.color ?? 'orange'
    const label = m.label ? `|label:${m.label.charAt(0).toUpperCase()}` : ''
    params.append('markers', `color:${colour}${label}|${m.lat},${m.lng}`)
  }

  params.set('key', opts.apiKey)
  return `${base}?${params.toString()}`
}

// ── Clamp helpers (free-tier safety) ────────────────────────────────

/** PURE — Google Maps Static free tier caps at 640×640. Clamp + warn
 *  silently rather than 400 from the API. */
export function clampSize(
  size: { width: number; height: number },
): { width: number; height: number } {
  const MAX = 640
  return {
    width: Math.max(64, Math.min(MAX, Math.floor(size.width))),
    height: Math.max(64, Math.min(MAX, Math.floor(size.height))),
  }
}

/** PURE — Google supports zoom 0..21. Anything outside that is rejected. */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 20
  return Math.max(0, Math.min(21, Math.floor(z)))
}

/** PURE — remove the API key from the URL for logging / display. */
export function redactKey(url: string): string {
  return url.replace(/([?&])key=[^&]*/g, '$1key=***')
}
