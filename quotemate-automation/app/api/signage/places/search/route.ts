// GET /api/signage/places/search?q=... — find real locations by name/area
// via Google Places API (New) Text Search. Returns { place_id, name,
// address, lat, lng }[] for the "find your studio" picker. HQ-authed; the
// GOOGLE_MAPS_API_KEY stays server-side.

import { createClient } from '@supabase/supabase-js'
import { orgFromBearer } from '@/lib/signage/org'
import { parsePlacesResults, PLACES_FIELD_MASK, PLACES_SEARCH_URL } from '@/lib/signage/places'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  const ctx = await orgFromBearer(supabase, req)
  if (!ctx) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return Response.json({ ok: false, code: 'maps_key_missing', results: [] }, { status: 200 })

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (q.length < 3) return Response.json({ ok: true, results: [] })

  try {
    const res = await fetch(PLACES_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACES_FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: q, maxResultCount: 8 }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return Response.json({ ok: false, code: 'places_error', status: res.status, detail: detail.slice(0, 300), results: [] }, { status: 200 })
    }
    const json = await res.json()
    return Response.json({ ok: true, results: parsePlacesResults(json) })
  } catch (e) {
    return Response.json({ ok: false, code: 'provider_error', detail: e instanceof Error ? e.message : String(e), results: [] }, { status: 200 })
  }
}
