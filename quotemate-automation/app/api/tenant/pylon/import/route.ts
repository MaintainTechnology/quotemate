// POST /api/tenant/pylon/import — body { design_id }
//
// Imports (or re-imports) one Pylon-studio design as a QuoteMate proposal:
// design + project fetch, datasheet enrichment, STC + totals guardrails,
// asset caching into storage, then upsert on (tenant_id, pylon_design_id).
// Re-import resets the confirm gate — changed numbers always go back
// through tradie review. Bearer tenant auth; gated by
// PYLON_PROPOSALS_ENABLED.

import { createClient } from '@supabase/supabase-js'
import { pylonProposalsEnabled } from '@/lib/pylon/client'
import { importPylonDesign } from '@/lib/pylon/import'

export const dynamic = 'force-dynamic'
// Import does several upstream fetches (design, project, datasheets,
// assets) — give it headroom beyond the 10s default.
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function userFromBearer(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

export async function POST(req: Request) {
  if (
    !pylonProposalsEnabled({
      PYLON_PROPOSALS_ENABLED: process.env.PYLON_PROPOSALS_ENABLED,
      PYLON_API_KEY: process.env.PYLON_API_KEY,
    })
  ) {
    return Response.json({ ok: false, error: 'pylon_disabled' }, { status: 404 })
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

  let designId: string | null = null
  try {
    const body = (await req.json()) as { design_id?: unknown }
    if (typeof body.design_id === 'string' && body.design_id.trim().length > 0) {
      designId = body.design_id.trim()
    }
  } catch {
    /* fall through to 400 */
  }
  if (!designId) {
    return Response.json({ ok: false, error: 'design_id required' }, { status: 400 })
  }

  const result = await importPylonDesign(supabase, {
    tenantId: tenant.id as string,
    designId,
  })
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: result.status })
  }

  return Response.json({ ok: true, token: result.token, flags: result.flags })
}
