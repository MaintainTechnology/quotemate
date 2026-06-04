// ════════════════════════════════════════════════════════════════════
// Signage — Google Places API (New) helpers for locating studios.
//
// PURE parser. The route does the POST to places:searchText with the
// X-Goog-Api-Key + X-Goog-FieldMask headers; this turns the response into
// clean PlaceResult[] for the "find your studio" UI.
// ════════════════════════════════════════════════════════════════════

export type PlaceResult = {
  place_id: string
  name: string
  address: string
  lat: number | null
  lng: number | null
}

/** Field mask for the Text Search call (only what we store). */
export const PLACES_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location'

export const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'

/** PURE — parse a Places (New) Text Search response into PlaceResult[]. */
export function parsePlacesResults(json: unknown): PlaceResult[] {
  if (!json || typeof json !== 'object') return []
  const arr = (json as Record<string, unknown>).places
  if (!Array.isArray(arr)) return []
  const out: PlaceResult[] = []
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue
    const p = raw as Record<string, unknown>
    const id = typeof p.id === 'string' ? p.id : ''
    const dn = p.displayName
    const name =
      dn && typeof dn === 'object' && typeof (dn as Record<string, unknown>).text === 'string'
        ? ((dn as Record<string, unknown>).text as string)
        : ''
    const address = typeof p.formattedAddress === 'string' ? p.formattedAddress : ''
    const loc = p.location && typeof p.location === 'object' ? (p.location as Record<string, unknown>) : null
    const lat = loc && typeof loc.latitude === 'number' ? loc.latitude : null
    const lng = loc && typeof loc.longitude === 'number' ? loc.longitude : null
    if (!id || (!name && !address)) continue
    out.push({ place_id: id, name: name || address, address, lat, lng })
  }
  return out
}
