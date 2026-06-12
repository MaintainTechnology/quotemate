// GET /api/tenant/opensolar/designs
//
// The project picker behind the "Import from OpenSolar" flow: proxies
// OpenSolar's project list (credentials never reach the browser). With
// ?project_id=… it returns that project's designed systems instead, for
// the system picker on multi-system projects. Bearer tenant auth; gated
// by OPENSOLAR_PROPOSALS_ENABLED.

import { createClient } from '@supabase/supabase-js'
import {
  fetchOpenSolarSystemDetails,
  listOpenSolarProjects,
  openSolarProposalsEnabled,
} from '@/lib/opensolar/client'
import { listOpenSolarSystems } from '@/lib/opensolar/proposal'

export const dynamic = 'force-dynamic'

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

export async function GET(req: Request) {
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

  const projectId = new URL(req.url).searchParams.get('project_id')
  if (projectId) {
    const details = await fetchOpenSolarSystemDetails(projectId)
    if (!details.ok) {
      return Response.json(
        { ok: false, error: `OpenSolar unavailable (${details.code}): ${details.detail}` },
        { status: 502 },
      )
    }
    return Response.json({ ok: true, systems: listOpenSolarSystems(details.data) })
  }

  const res = await listOpenSolarProjects()
  if (!res.ok) {
    return Response.json(
      { ok: false, error: `OpenSolar unavailable (${res.code}): ${res.detail}` },
      { status: 502 },
    )
  }

  return Response.json({ ok: true, projects: res.data })
}
