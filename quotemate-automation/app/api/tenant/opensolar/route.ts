// GET /api/tenant/opensolar
//
// The OpenSolar sub-tab's proposal list: the tradie's imported OpenSolar
// project systems as lean view-model cards. Mirrors /api/tenant/pylon:
// Bearer auth → resolve tenant by owner_user_id → query
// opensolar_proposals scoped to that tenant (newest first). Gated by
// OPENSOLAR_PROPOSALS_ENABLED — when off the route 404s and the sub-tab
// shows its setup notice.

import { createClient } from '@supabase/supabase-js'
import { openSolarProposalsEnabled } from '@/lib/opensolar/client'
import {
  mapOpenSolarProposalRow,
  type OpenSolarProposalRawRow,
} from '@/lib/opensolar/proposal'

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

const PROPOSAL_LIMIT = 50

export async function GET(req: Request) {
  if (!openSolarProposalsEnabled(process.env)) {
    return Response.json({ ok: false, error: 'opensolar_disabled' }, { status: 404 })
  }

  const user = await userFromBearer(req)
  if (!user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('owner_user_id', user.id)
    .maybeSingle()
  if (tenantErr) {
    return Response.json({ ok: false, error: tenantErr.message }, { status: 500 })
  }
  if (!tenant) {
    return Response.json({ ok: false, error: 'no_tenant' }, { status: 404 })
  }

  const appUrl = process.env.APP_URL ?? 'https://quote-mate-rho.vercel.app'

  const res = await supabase
    .from('opensolar_proposals')
    .select(
      'public_token, opensolar_project_id, opensolar_system_uuid, title, address_text, ' +
        'customer, design, assets, flags, status, confirmed_at, paid_at, created_at',
    )
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(PROPOSAL_LIMIT)
  if (res.error) {
    return Response.json({ ok: false, error: res.error.message }, { status: 500 })
  }

  const proposals = ((res.data ?? []) as unknown as OpenSolarProposalRawRow[]).map((row) =>
    mapOpenSolarProposalRow({ row, appUrl }),
  )

  return Response.json({ ok: true, proposals })
}
