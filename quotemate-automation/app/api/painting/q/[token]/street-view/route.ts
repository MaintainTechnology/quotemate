// GET /api/painting/q/[token]/street-view — public, share-token-gated Google
// Street View photo of the front of the property for a saved painting
// measurement. Mirrors /api/roofing/q/[token]/static-map: resolves
// painting_measurements by public_token (the unguessable token IS the
// capability — no bearer), fetches Google server-side so
// GOOGLE_MAPS_API_KEY never leaves, and streams the bytes back.
//
// The free metadata endpoint is checked first so a no-coverage address
// returns a clean 404 instead of a billed grey tile.

import { createClient } from '@supabase/supabase-js'
import {
  buildStreetViewMetadataUrl,
  buildStreetViewUrl,
  parseStreetViewMetadata,
} from '@/lib/painting/streetview'
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

  const location = composePaintLocation({
    address: row.address as string,
    postcode: (row.postcode as string | null) ?? null,
    state: (row.state as string | null) ?? null,
  })

  // Free existence check — no pano ⇒ clean 404, nothing billed.
  try {
    const metaRes = await fetch(buildStreetViewMetadataUrl({ location }, { apiKey }))
    const meta = parseStreetViewMetadata(await metaRes.json().catch(() => null))
    if (!meta.ok) {
      return Response.json({ ok: false, code: 'no_streetview', status: meta.status }, { status: 404 })
    }
  } catch {
    // Metadata is best-effort — fall through and let the image call decide.
  }

  let res: Response
  try {
    res = await fetch(buildStreetViewUrl({ location }, { apiKey }))
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }
  if (!res.ok) {
    if (res.status === 404) {
      return Response.json({ ok: false, code: 'no_streetview', status: 'ZERO_RESULTS' }, { status: 404 })
    }
    return Response.json({ ok: false, error: `street view ${res.status}` }, { status: 502 })
  }

  const ct = res.headers.get('content-type') ?? 'image/jpeg'
  return new Response(await res.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': ct,
      // s-maxage: let the CDN cache too — without it every distinct viewer
      // re-invokes the function and re-bills the Google image fetch.
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
    },
  })
}
