// POST /api/tenant/opensolar/document/[token] — body { type }
//
// The tradie's install pack: lazily generate one OpenSolar document
// (global BOM, owner's manual, financials report, 8760 performance CSV)
// for an imported proposal, cache it in storage, and return the token-
// gated download URL. Whitelisted types only; results are cached in the
// proposal's assets jsonb so repeat clicks don't re-render at OpenSolar
// (throttle limits). Bearer tenant auth; gated by
// OPENSOLAR_PROPOSALS_ENABLED.

import { createClient } from '@supabase/supabase-js'
import { isOpenSolarDocumentType, openSolarProposalsEnabled } from '@/lib/opensolar/client'
import {
  generateAndCacheOpenSolarDocument,
  type OpenSolarAssetPaths,
} from '@/lib/opensolar/import'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // one OpenSolar document render

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/** Install-pack types only — customer appendices cache at import time. */
const INSTALL_PACK: Record<
  string,
  { assetKey: keyof OpenSolarAssetPaths; kind: string; filename: string }
> = {
  global_bom: { assetKey: 'bom_path', kind: 'bom', filename: 'bill-of-materials.pdf' },
  owners_manual: {
    assetKey: 'owners_manual_path',
    kind: 'owners-manual',
    filename: 'owners-manual.pdf',
  },
  financials_report: {
    assetKey: 'financials_path',
    kind: 'financials',
    filename: 'financials-report.pdf',
  },
  system_performance_8760: {
    assetKey: 'performance_8760_path',
    kind: 'performance-8760',
    filename: 'system-performance-8760.csv',
  },
}

async function userFromBearer(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  if (!openSolarProposalsEnabled(process.env)) {
    return Response.json({ ok: false, error: 'opensolar_disabled' }, { status: 404 })
  }

  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'invalid_token' }, { status: 400 })
  }

  const user = await userFromBearer(req)
  if (!user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('owner_user_id', user.id)
    .maybeSingle()
  if (!tenant) {
    return Response.json({ ok: false, error: 'no_tenant' }, { status: 404 })
  }

  let type: string | null = null
  try {
    const body = (await req.json()) as { type?: unknown }
    if (typeof body.type === 'string') type = body.type
  } catch {
    /* fall through to 400 */
  }
  const spec = type ? INSTALL_PACK[type] : undefined
  if (!type || !spec || !isOpenSolarDocumentType(type)) {
    return Response.json({ ok: false, error: 'unsupported document type' }, { status: 400 })
  }

  // Tenant-scoped row lookup — a token from another tenant 404s.
  const { data: row } = await supabase
    .from('opensolar_proposals')
    .select('id, opensolar_project_id, opensolar_system_uuid, assets')
    .eq('public_token', token)
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (!row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const assets = (row.assets ?? {}) as Record<string, string | null>
  const downloadUrl = `/api/opensolar/q/${token}/asset/${spec.kind}`

  // Cached already — no repeat render at OpenSolar.
  if (assets[spec.assetKey]) {
    return Response.json({ ok: true, url: downloadUrl, cached: true })
  }

  const path = await generateAndCacheOpenSolarDocument(supabase, {
    tenantId: tenant.id as string,
    projectId: row.opensolar_project_id as string,
    systemUuid: (row.opensolar_system_uuid as string) ?? '',
    type,
    filename: spec.filename,
  })
  if (!path) {
    return Response.json(
      { ok: false, error: 'OpenSolar could not generate that document right now — try again shortly.' },
      { status: 502 },
    )
  }

  const { error: updErr } = await supabase
    .from('opensolar_proposals')
    .update({ assets: { ...assets, [spec.assetKey]: path }, updated_at: new Date().toISOString() })
    .eq('id', row.id)
  if (updErr) {
    console.warn('[opensolar/document] asset path save failed (non-fatal)', updErr.message)
  }

  return Response.json({ ok: true, url: downloadUrl, cached: false })
}
