// GET /api/admin/customers — cross-tenant list for the admin customer
// console (specs/admin-customer-console.md R4). Admin-only.
//
// resolveAdminUserId runs BEFORE any query: the read uses the service-role
// key (RLS-bypassing), so this gate is the only thing protecting every
// tenant's data — it fails closed (403) for a missing/invalid token or a
// non-admin user.
//
// Returns a compact summary per tenant, newest first. The page does
// search/filter in-memory (tenant count is small); this route stays a
// plain list so the empty/filter logic lives in one place on the client.

import { createClient } from '@supabase/supabase-js'
import { resolveAdminUserId } from '@/lib/admin-loader/route-auth'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  const adminId = await resolveAdminUserId(supabase, req)
  if (!adminId) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('tenants')
    .select(
      'id, business_name, trade, trades, status, subscription_plan, subscription_status, subscription_interval, billing_exempt, created_at',
    )
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  const customers = (data ?? []).map((t) => ({
    id: t.id as string,
    business_name: (t.business_name as string | null) ?? null,
    trade: (t.trade as string | null) ?? null,
    trades: Array.isArray(t.trades) ? (t.trades as string[]) : [],
    status: (t.status as string | null) ?? null,
    subscription_plan: (t.subscription_plan as string | null) ?? null,
    subscription_status: (t.subscription_status as string | null) ?? null,
    subscription_interval: (t.subscription_interval as string | null) ?? null,
    billing_exempt: (t.billing_exempt as boolean | null) ?? false,
    created_at: (t.created_at as string | null) ?? null,
  }))

  return Response.json({ ok: true, customers })
}
