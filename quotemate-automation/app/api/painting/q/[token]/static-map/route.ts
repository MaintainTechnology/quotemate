// GET /api/painting/q/[token]/static-map — public, share-token-gated Google
// aerial/satellite view of the property for a saved painting measurement.
// Mirrors /api/roofing/q/[token]/static-map (painting rows carry no roof
// polygon, so the map centres on the geocoded address). Keeps
// GOOGLE_MAPS_API_KEY server-side and streams the bytes with CDN caching.

import { createClient } from '@supabase/supabase-js'
import { buildStaticMapUrl } from '@/lib/roofing/google-maps'
import { composePaintLocation } from '@/lib/painting/paint-after'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'bad_token' }, { status: 400 })
  }

  const { data: row, error } = await supabase
    .from('painting_measurements')
    .select('address, postcode, state')
    .eq('public_token', token)
    .maybeSingle()
  if (error || !row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  if (!row.address) {
    return Response.json({ ok: false, error: 'no_location' }, { status: 400 })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return Response.json({ ok: false, error: 'no_maps_key' }, { status: 503 })
  }

  let res: Response
  try {
    const target = buildStaticMapUrl(
      {
        address: composePaintLocation({
          address: row.address as string,
          postcode: (row.postcode as string | null) ?? null,
          state: (row.state as string | null) ?? null,
        }),
        zoom: 20,
        size: { width: 640, height: 480 },
      },
      { apiKey },
    )
    res = await fetch(target)
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }
  if (!res.ok) {
    return Response.json({ ok: false, error: `static map ${res.status}` }, { status: 502 })
  }

  const ct = res.headers.get('content-type') ?? 'image/png'
  return new Response(await res.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
    },
  })
}
