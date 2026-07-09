// GET /api/tenant/commercial-painting/runs — recent runs for the tab's
// history rail (resume an in-flight run after a reload).

import { tenantFromBearer, estimatorSupabase } from '@/lib/estimation/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ ok: false, error: 'unauthorised' }, { status: 401 })

  const { data, error } = await estimatorSupabase
    .from('paint_runs')
    // public_token → the customer tender page (/q/commercial-paint/…); safe
    // to return here because the list is bearer-authed and tenant-scoped.
    .select('id, job_name, site_address, status, created_at, updated_at, public_token')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(15)
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })

  return Response.json({ ok: true, runs: data ?? [] })
}
