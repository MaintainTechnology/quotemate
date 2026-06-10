// GET /api/solar/places — PUBLIC address-autocomplete proxy for the solar
// entry form. Keeps the Google Places key server-side.
//
//   ?q=670+lond        → AU-restricted suggestions for the typeahead
//   ?placeId=ChIJ…     → details for a selected suggestion (street line,
//                        postcode, state) so the form auto-fills
//
// Best-effort: a missing/disabled Places API returns an empty suggestion
// list (200) so the form silently degrades to manual typing — it must
// never block the quote path. Guards: min 4 chars, input capped at 160.

import { fetchAddressSuggestions, fetchPlaceDetails } from '@/lib/solar/places'

export const dynamic = 'force-dynamic'

const MIN_QUERY_LENGTH = 4
const MAX_QUERY_LENGTH = 160

function placesApiKey(): string | undefined {
  return process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim()
  const placeId = url.searchParams.get('placeId')?.trim()

  if (placeId) {
    if (placeId.length > MAX_QUERY_LENGTH) {
      return Response.json({ ok: false, error: 'bad_place_id' }, { status: 400 })
    }
    const r = await fetchPlaceDetails(placeId, { apiKey: placesApiKey() })
    if (!r.ok) {
      // Soft-fail: the form falls back to whatever text is in the field.
      return Response.json({ ok: false, error: r.code }, { status: 200 })
    }
    return Response.json({ ok: true, details: r.details }, { status: 200 })
  }

  if (!q || q.length < MIN_QUERY_LENGTH) {
    return Response.json({ ok: true, suggestions: [] }, { status: 200 })
  }
  const input = q.slice(0, MAX_QUERY_LENGTH)
  const r = await fetchAddressSuggestions(input, { apiKey: placesApiKey() })
  if (!r.ok) {
    // Soft-fail with an empty list — typeahead simply shows nothing.
    return Response.json({ ok: true, suggestions: [] }, { status: 200 })
  }
  return Response.json({ ok: true, suggestions: r.suggestions }, { status: 200 })
}
