// GET /api/opensolar/q/[token]/asset/[kind] — public, share-token-gated
// serving of the CACHED OpenSolar artefacts (system-image render,
// generated shade report / energy yield report / PV site plan, and the
// tradie's install-pack documents).
//
// The customer page and the PDF only ever reference these cached copies —
// OpenSolar's own URLs are signed/expiring and are never hot-linked on a
// customer surface. Anything missing 404s and the page omits that
// section (degradation matrix).

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BUCKET = 'intake-photos'

const KIND_TO_ASSET: Record<string, { key: string; fallbackType: string }> = {
  'system-image': { key: 'system_image_path', fallbackType: 'image/png' },
  'shade-report': { key: 'shade_report_path', fallbackType: 'application/pdf' },
  'energy-yield': { key: 'energy_yield_path', fallbackType: 'application/pdf' },
  'site-plan': { key: 'site_plan_path', fallbackType: 'application/pdf' },
  bom: { key: 'bom_path', fallbackType: 'application/pdf' },
  'owners-manual': { key: 'owners_manual_path', fallbackType: 'application/pdf' },
  financials: { key: 'financials_path', fallbackType: 'application/pdf' },
  'performance-8760': { key: 'performance_8760_path', fallbackType: 'text/csv' },
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
    .from('opensolar_proposals')
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
