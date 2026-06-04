// ════════════════════════════════════════════════════════════════════
// Signage — Google Maps Static + Geocoding helpers.
//
// PURE URL builders + a Geocoding response parser. The route holds the key
// and streams the static-map image; geocoding fills lat/lng for studios
// added by typed address / CSV.
// ════════════════════════════════════════════════════════════════════

const STATIC_BASE = 'https://maps.googleapis.com/maps/api/staticmap'
const GEOCODE_BASE = 'https://maps.googleapis.com/maps/api/geocode/json'

/** PURE — a Maps Static thumbnail of a location, with a brand-coloured
 *  marker. maptype 'roadmap' | 'satellite' | 'hybrid'. */
export function buildStaticMapUrl(opts: {
  lat: number
  lng: number
  zoom?: number
  size?: string
  maptype?: string
  apiKey: string
}): string {
  const { lat, lng, zoom = 17, size = '320x160', maptype = 'roadmap', apiKey } = opts
  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: String(zoom),
    size,
    maptype,
    markers: `color:0xF26B21|${lat},${lng}`,
    key: apiKey,
  })
  return `${STATIC_BASE}?${params.toString()}`
}

/** PURE — a Geocoding API request URL for an address string. */
export function buildGeocodeUrl(address: string, apiKey: string): string {
  return `${GEOCODE_BASE}?${new URLSearchParams({ address, key: apiKey }).toString()}`
}

export type GeocodeResult = { lat: number; lng: number; formatted_address: string; place_id: string | null } | null

/** PURE — parse the first usable result from a Geocoding API response. */
export function parseGeocode(json: unknown): GeocodeResult {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  if (o.status !== 'OK') return null
  const results = o.results
  if (!Array.isArray(results) || results.length === 0) return null
  const r = results[0] as Record<string, unknown>
  const geom = r.geometry && typeof r.geometry === 'object' ? (r.geometry as Record<string, unknown>) : null
  const loc = geom?.location && typeof geom.location === 'object' ? (geom.location as Record<string, unknown>) : null
  const lat = loc && typeof loc.lat === 'number' ? loc.lat : null
  const lng = loc && typeof loc.lng === 'number' ? loc.lng : null
  if (lat === null || lng === null) return null
  return {
    lat,
    lng,
    formatted_address: typeof r.formatted_address === 'string' ? r.formatted_address : '',
    place_id: typeof r.place_id === 'string' ? r.place_id : null,
  }
}
