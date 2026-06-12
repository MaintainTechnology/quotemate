// POST /api/tenant/opensolar/import — body { project_id, system_uuid? }
//
// Imports (or re-imports) one OpenSolar-studio project system as a
// QuoteMate proposal: project + systems/details (+ proposal data on the
// Raw Data plan), STC + totals guardrails, system-image + engineering-
// document caching into storage, then upsert on
// (tenant_id, project_id, system_uuid). Re-import resets the confirm
// gate — changed numbers always go back through tradie review. Bearer
// tenant auth; gated by OPENSOLAR_PROPOSALS_ENABLED.

import { createClient } from '@supabase/supabase-js'
import { openSolarProposalsEnabled } from '@/lib/opensolar/client'
import { importOpenSolarProject } from '@/lib/opensolar/import'

export const dynamic = 'force-dynamic'
// Import does several upstream fetches plus up to three OpenSolar
// document generations — give it real headroom beyond the 10s default.
export const maxDuration = 120

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
  if (!openSolarProposalsEnabled(process.env)) {
    return Response.json({ ok: false, error: 'opensolar_disabled' }, { status: 404 })
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

  let projectId: string | null = null
  let systemUuid: string | null = null
  try {
    const body = (await req.json()) as { project_id?: unknown; system_uuid?: unknown }
    if (typeof body.project_id === 'string' && body.project_id.trim().length > 0) {
      projectId = body.project_id.trim()
    }
    if (typeof body.system_uuid === 'string' && body.system_uuid.trim().length > 0) {
      systemUuid = body.system_uuid.trim()
    }
  } catch {
    /* fall through to 400 */
  }
  if (!projectId) {
    return Response.json({ ok: false, error: 'project_id required' }, { status: 400 })
  }

  const result = await importOpenSolarProject(supabase, {
    tenantId: tenant.id as string,
    projectId,
    systemUuid,
  })
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: result.status })
  }

  return Response.json({
    ok: true,
    token: result.token,
    flags: result.flags,
    warnings: result.design.import_warnings,
  })
}
