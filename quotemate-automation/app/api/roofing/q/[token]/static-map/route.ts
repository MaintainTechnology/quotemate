// GET /api/roofing/q/[token]/static-map — public, share-token-gated Google
// Maps Static proxy for a saved roofing measurement. This is the image the
// SMS receptionist attaches as the MMS roof photo AND the hero image on
// /q/roof/[token]. Token-gated (no Supabase session) so Twilio can fetch
// it server-side and the customer can open it from the text.

import { createClient } from '@supabase/supabase-js'
import { buildStaticMapUrl } from '@/lib/roofing/google-maps'
import { layoutMapView, type LayoutOverlayStructure } from '@/lib/roofing/layout-overlay-svg'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type LngLat = [number, number]

function vertexOfStructure(s: unknown): LngLat | null {
  const v = (s as { metrics?: { polygon_geojson?: { coordinates?: number[][][] } } })
    ?.metrics?.polygon_geojson?.coordinates?.[0]?.[0]
  if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') {
    return [v[0], v[1]]
  }
  return null
}

function firstVertexOf(quote: unknown): LngLat | null {
  // quote.structures[0].metrics.polygon_geojson.coordinates[0][0]
  const structures = (quote as { structures?: unknown })?.structures
  if (!Array.isArray(structures)) return null
  for (const s of structures) {
    const v = vertexOfStructure(s)
    if (v) return v
  }
  return null
}

/** Centre on a specific 1-based building when `?b=N` is given (used for the
 *  per-building roof-photo MMS); falls back to the first vertex / address. */
function vertexForBuilding(quote: unknown, b: number | null): LngLat | null {
  if (b != null) {
    const structures = (quote as { structures?: unknown })?.structures
    if (Array.isArray(structures) && b >= 1 && b <= structures.length) {
      const v = vertexOfStructure(structures[b - 1])
      if (v) return v
    }
  }
  return firstVertexOf(quote)
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'bad_token' }, { status: 400 })
  }

  // Optional 1-based building index — centre the image on that structure
  // (used for the per-building roof-photo MMS on multi-building parcels).
  const params = new URL(req.url).searchParams
  const bRaw = params.get('b')
  const b = bRaw != null && /^\d{1,2}$/.test(bRaw) ? Number(bRaw) : null
  // ?fit=1 — frame EVERY measured structure (the layout-map view). The SVG
  // overlay computes the identical centre/zoom via layoutMapView, so the
  // zone borders stay aligned with the imagery. ?z=15..21 overrides the fit
  // zoom (the layout figure's interactive zoom) while keeping the fit centre.
  const fit = params.get('fit') === '1'
  const zRaw = params.get('z')
  const zOverride =
    fit && zRaw != null && /^\d{1,2}$/.test(zRaw) && Number(zRaw) >= 15 && Number(zRaw) <= 21
      ? Number(zRaw)
      : null

  const { data: row, error } = await supabase
    .from('roofing_measurements')
    .select('address, quote')
    .eq('public_token', token)
    .maybeSingle()
  if (error || !row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return Response.json({ ok: false, error: 'GOOGLE_MAPS_API_KEY not set on the server' }, { status: 503 })
  }

  const address = (row.address as string | null) ?? undefined
  let center: { lat: number; lng: number } | undefined
  let zoom = 20
  let marker = true
  if (fit) {
    const structures = ((row.quote as { structures?: unknown[] } | null)?.structures ?? []).map(
      (s): LayoutOverlayStructure => ({
        polygon:
          (s as { metrics?: { polygon_geojson?: LayoutOverlayStructure['polygon'] } })?.metrics
            ?.polygon_geojson ?? null,
        form: 'unknown',
      }),
    )
    const view = layoutMapView(structures, { width: 640, height: 480 })
    if (view) {
      center = view.center
      zoom = zOverride ?? view.zoom
      marker = false // the overlay carries the annotations; no pin needed
    }
  }
  if (!center) {
    const vertex = vertexForBuilding(row.quote, b)
    center = vertex ? { lat: vertex[1], lng: vertex[0] } : undefined
  }
  if (!address && !center) {
    return Response.json({ ok: false, error: 'no_location' }, { status: 400 })
  }

  let target: string
  try {
    target = buildStaticMapUrl(
      {
        address: center ? undefined : address,
        center,
        zoom,
        size: { width: 640, height: 480 },
        markers:
          center && marker ? [{ lat: center.lat, lng: center.lng, color: 'orange' }] : undefined,
      },
      { apiKey },
    )
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }

  let res: Response
  try {
    res = await fetch(target, { method: 'GET' })
  } catch (e) {
    return Response.json({ ok: false, error: `Google Maps Static fetch failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
  if (!res.ok) {
    let body = ''
    try { body = (await res.text()).slice(0, 300) } catch { /* ignore */ }
    return Response.json({ ok: false, error: `Google Maps Static returned ${res.status}`, upstreamBody: body }, { status: 502 })
  }

  const ct = res.headers.get('content-type') ?? 'image/png'
  const arrayBuffer = await res.arrayBuffer()
  return new Response(arrayBuffer, {
    status: 200,
    headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400, immutable' },
  })
}
