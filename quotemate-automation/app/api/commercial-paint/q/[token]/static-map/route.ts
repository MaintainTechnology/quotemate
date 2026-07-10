// GET /api/commercial-paint/q/[token]/static-map — public, token-gated Google
// Maps Static proxy for a commercial painting tender (paint_runs). The site
// aerial on /q/commercial-paint/[token] (spec quote-visual-parity R4).
// Mirrors app/api/roofing/q/[token]/static-map — the key never reaches the
// browser; the unguessable public_token is the capability.

import { createClient } from '@supabase/supabase-js'
import { buildStaticMapUrl } from '@/lib/roofing/google-maps'

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
    .from('paint_runs')
    .select('site_address')
    .eq('public_token', token)
    .maybeSingle()
  if (error || !row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  const address = (row.site_address as string | null)?.trim()
  if (!address) {
    return Response.json({ ok: false, error: 'no_location' }, { status: 404 })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return Response.json(
      { ok: false, error: 'GOOGLE_MAPS_API_KEY not set on the server' },
      { status: 503 },
    )
  }

  let target: string
  try {
    target = buildStaticMapUrl(
      { address, zoom: 19, size: { width: 640, height: 420 } },
      { apiKey },
    )
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    )
  }

  let res: Response
  try {
    res = await fetch(target, { method: 'GET' })
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: `Google Maps Static fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 502 },
    )
  }
  if (!res.ok) {
    let body = ''
    try {
      body = (await res.text()).slice(0, 300)
    } catch {
      /* ignore */
    }
    return Response.json(
      { ok: false, error: `Google Maps Static returned ${res.status}`, upstreamBody: body },
      { status: 502 },
    )
  }

  const ct = res.headers.get('content-type') ?? 'image/png'
  const arrayBuffer = await res.arrayBuffer()
  return new Response(arrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
    },
  })
}
