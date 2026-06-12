// GET /api/tenant/pylon/designs
//
// The design picker behind the "Import from Pylon" flow: proxies Pylon's
// GET /v1/solar_designs (mandatory fields[solar_designs] param applied in
// the client) so the browser never sees the API key. Bearer tenant auth;
// gated by PYLON_PROPOSALS_ENABLED.

import { createClient } from '@supabase/supabase-js'
import { listPylonSolarDesigns, pylonProposalsEnabled } from '@/lib/pylon/client'

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

  const res = await listPylonSolarDesigns()
  if (!res.ok) {
    return Response.json(
      { ok: false, error: `Pylon unavailable (${res.code}): ${res.detail}` },
      { status: 502 },
    )
  }

  return Response.json({ ok: true, designs: res.data })
}
