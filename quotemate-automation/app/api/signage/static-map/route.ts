// GET /api/signage/static-map?lat=&lng=&maptype= — streams a Google Maps
// Static thumbnail of a studio location (the "where is this" view that
// complements the Street View storefront). HQ-authed; key stays server-side.

import { createClient } from '@supabase/supabase-js'
import { orgFromBearer } from '@/lib/signage/org'
import { buildStaticMapUrl } from '@/lib/signage/maps'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  const ctx = await orgFromBearer(supabase, req)
  if (!ctx) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return Response.json({ ok: false, code: 'maps_key_missing' }, { status: 200 })

  const u = new URL(req.url)
  const lat = Number(u.searchParams.get('lat'))
  const lng = Number(u.searchParams.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ ok: false, code: 'no_coords' }, { status: 400 })
  }
  const maptype = u.searchParams.get('maptype') ?? 'roadmap'

  try {
    const res = await fetch(buildStaticMapUrl({ lat, lng, maptype, apiKey }))
    if (!res.ok) return Response.json({ ok: false, code: 'static_map_error', status: res.status }, { status: 404 })
    const bytes = await res.arrayBuffer()
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'image/png',
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch (e) {
    return Response.json({ ok: false, code: 'provider_error', detail: e instanceof Error ? e.message : String(e) }, { status: 200 })
  }
}
