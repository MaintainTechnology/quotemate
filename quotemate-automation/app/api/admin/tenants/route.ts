// GET /api/admin/tenants — admin-gated list of tenants for the
// roofing-activation panel on /admin.
//
// Returns minimal fields: id, business_name, state, trades[], status,
// created_at. The /admin UI uses this to render a one-click toggle to
// enable/disable the roofing trade per tenant.

import { createClient } from '@supabase/supabase-js'
import { isAdminUser } from '@/lib/admin-loader/auth'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  // Dual-auth: resolve the caller (Clerk or Supabase) + their tenant row.
  // admin_users is keyed by the SUPABASE auth id — for a Clerk caller that is
  // the mapped tenant.owner_user_id; for a Supabase caller it's their own id.
  const resolved = await resolveTenantRequest(supabase, req, 'owner_user_id')
  if (!resolved) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const subjectId =
    (resolved.tenant as { owner_user_id: string | null } | null)?.owner_user_id ??
    (resolved.identity.provider === 'supabase' ? resolved.identity.userId : null)
  const isAdmin = subjectId ? await isAdminUser(supabase, subjectId) : false
  if (!isAdmin) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('tenants')
    .select('id, business_name, state, trade, trades, status, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  const tenants = (data ?? []).map((t) => ({
    id: t.id as string,
    businessName: (t.business_name as string | null) ?? null,
    state: (t.state as string | null) ?? null,
    trade: (t.trade as string | null) ?? null,
    trades: Array.isArray(t.trades) ? (t.trades as string[]) : [],
    status: (t.status as string | null) ?? null,
    createdAt: t.created_at as string | null,
  }))

  return Response.json({ ok: true, tenants })
}
