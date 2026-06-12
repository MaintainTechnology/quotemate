// GET /api/pylon/q/[token]/asset/[kind] — public, share-token-gated
// serving of the CACHED Pylon design artefacts (snapshot image /
// single-line diagram PDF / PV site-information PDF).
//
// The customer page and the PDF only ever reference these cached copies —
// Pylon's own URLs are treated as unstable and are never hot-linked on a
// customer surface. kind ∈ snapshot | sld | site-info; anything missing
// 404s and the page omits that section (degradation matrix).

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BUCKET = 'intake-photos'

const KIND_TO_ASSET: Record<string, { key: string; fallbackType: string }> = {
  snapshot: { key: 'snapshot_path', fallbackType: 'image/jpeg' },
  sld: { key: 'sld_path', fallbackType: 'application/pdf' },
  'site-info': { key: 'site_info_path', fallbackType: 'application/pdf' },
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string; kind: string }> },
) {
  const { token, kind } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'bad_token' }, { status: 400 })
  }
  const asset = KIND_TO_ASSET[kind]
  if (!asset) {
    return Response.json({ ok: false, error: 'bad_kind' }, { status: 400 })
  }

  const { data: row } = await supabase
    .from('pylon_proposals')
    .select('assets')
    .eq('public_token', token)
    .maybeSingle()
  if (!row) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })

  const assets = (row.assets ?? {}) as Record<string, string | null>
  const path = assets[asset.key]
  if (!path) return Response.json({ ok: false, error: 'no_asset' }, { status: 404 })

  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) {
    return Response.json({ ok: false, error: 'storage_miss' }, { status: 404 })
  }
  const buf = Buffer.from(await data.arrayBuffer())
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': data.type || asset.fallbackType,
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  })
}
