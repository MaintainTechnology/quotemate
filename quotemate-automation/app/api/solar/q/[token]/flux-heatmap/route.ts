// GET /api/solar/q/[token]/flux-heatmap — public, share-token-gated roof
// irradiance heatmap for a saved solar estimate.
//
// The PNG is generated once by the sun-assets after()-job (annual flux
// GeoTIFF composited over the aligned aerial RGB, clipped by the roof
// mask) and cached in the intake-photos bucket; this route only streams
// the cached copy. 404 when the estimate carries no heatmap (manual
// path, layers unavailable, or generation still in flight) — the quote
// page omits the figure in that case.

import { createClient } from '@supabase/supabase-js'
import type { SolarEstimate } from '@/lib/solar/types'

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

  const { data: row } = await supabase
    .from('solar_estimates')
    .select('estimate')
    .eq('public_token', token)
    .maybeSingle()
  if (!row) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })

  const estimate = (row.estimate ?? null) as SolarEstimate | null
  const path = estimate?.context.sun?.flux_image_path ?? null
  if (!path) return Response.json({ ok: false, error: 'no_heatmap' }, { status: 404 })

  const { data, error } = await supabase.storage.from('intake-photos').download(path)
  if (error || !data) {
    return Response.json({ ok: false, error: 'asset_missing' }, { status: 404 })
  }
  const buf = Buffer.from(await data.arrayBuffer())
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': data.type || 'image/png',
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  })
}
