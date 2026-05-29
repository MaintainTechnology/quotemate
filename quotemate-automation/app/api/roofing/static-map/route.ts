// GET /api/roofing/static-map — server-side proxy for Google Maps
// Static API images. Two purposes:
//   1. Keep GOOGLE_MAPS_API_KEY off the browser (it's a paid resource).
//   2. Let us add caching headers + per-tenant rate limits later
//      without touching the client.
//
// Inputs (all query-params):
//   address     — string  (optional if center is supplied)
//   lat / lng   — number  (optional if address is supplied)
//   zoom        — number  (default 20)
//   w / h       — pixels  (default 640×480, max 640)
//   markers     — pipe-delimited list "lat,lng,colour"  (optional)
//
// Auth: bearer token from the dashboard; not anonymous-public.

import { createClient } from '@supabase/supabase-js'
import { buildStaticMapUrl, type StaticMapInput } from '@/lib/roofing/google-maps'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function userIdFromBearer(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

type Marker = NonNullable<StaticMapInput['markers']>[number]

function parseMarkers(raw: string | null): Marker[] | undefined {
  if (!raw) return undefined
  const out: Marker[] = []
  for (const segment of raw.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [lat, lng, color] = segment.split(',')
    const fLat = Number(lat)
    const fLng = Number(lng)
    if (!Number.isFinite(fLat) || !Number.isFinite(fLng)) continue
    const c = color?.trim()
    out.push(c ? { lat: fLat, lng: fLng, color: c } : { lat: fLat, lng: fLng })
  }
  return out
}

export async function GET(req: Request) {
  const userId = await userIdFromBearer(req)
  if (!userId) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return Response.json(
      { ok: false, error: 'GOOGLE_MAPS_API_KEY not set on the server' },
      { status: 503 },
    )
  }

  const url = new URL(req.url)
  const address = url.searchParams.get('address') ?? undefined
  const latRaw = url.searchParams.get('lat')
  const lngRaw = url.searchParams.get('lng')
  const center =
    latRaw && lngRaw && Number.isFinite(Number(latRaw)) && Number.isFinite(Number(lngRaw))
      ? { lat: Number(latRaw), lng: Number(lngRaw) }
      : undefined

  if (!address && !center) {
    return Response.json(
      { ok: false, error: 'address or lat+lng is required' },
      { status: 400 },
    )
  }

  const zoom = url.searchParams.get('zoom') ? Number(url.searchParams.get('zoom')) : undefined
  const w = url.searchParams.get('w') ? Number(url.searchParams.get('w')) : undefined
  const h = url.searchParams.get('h') ? Number(url.searchParams.get('h')) : undefined
  const markers = parseMarkers(url.searchParams.get('markers'))

  let target: string
  try {
    target = buildStaticMapUrl(
      {
        address,
        center,
        zoom,
        size: w && h ? { width: w, height: h } : undefined,
        markers,
      },
      { apiKey },
    )
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    )
  }

  // Stream the PNG straight back.
  let res: Response
  try {
    res = await fetch(target, { method: 'GET' })
  } catch (e) {
    return Response.json(
      { ok: false, error: `Google Maps Static fetch failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }
  if (!res.ok) {
    return Response.json(
      { ok: false, error: `Google Maps Static returned ${res.status}` },
      { status: 502 },
    )
  }

  const ct = res.headers.get('content-type') ?? 'image/png'
  const arrayBuffer = await res.arrayBuffer()
  return new Response(arrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': ct,
      // Tile-level caching — 1 day at the edge; we re-render on map
      // change anyway.
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  })
}
