// Shared auth + tenant resolution for the /api/billing/* routes.
//
// Same contract as /api/tenant/me: the client sends
// `Authorization: Bearer <supabase access token>`; we validate it with the
// service-role client and resolve the tradie's tenant by owner_user_id.
// Service role is used because RLS tenant policies aren't shipped yet
// (CLAUDE.md) — isolation is enforced here by the owner_user_id filter.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _admin: SupabaseClient | null = null

export function billingAdmin(): SupabaseClient {
  if (_admin) return _admin
  _admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  return _admin
}

export type BillingTenant = {
  id: string
  owner_email: string | null
  business_name: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  subscription_status: string | null
  subscription_plan: string | null
  subscription_interval: string | null
  subscription_current_period_end: string | null
  trial_ends_at: string | null
  subscription_cancel_at_period_end: boolean | null
}

const TENANT_COLS =
  'id, owner_email, business_name, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_plan, subscription_interval, subscription_current_period_end, trial_ends_at, subscription_cancel_at_period_end'

/**
 * Resolve { user, tenant } from the request's bearer token. Returns null
 * when the token is missing/invalid (caller → 401). `tenant` may be null
 * when the user is authed but hasn't onboarded a tenant yet (caller → 404).
 */
export async function tenantFromBearer(
  req: Request,
): Promise<{ userId: string; userEmail: string | null; tenant: BillingTenant | null } | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null

  const sb = billingAdmin()
  const { data, error } = await sb.auth.getUser(token)
  if (error || !data.user) return null

  const { data: tenant } = await sb
    .from('tenants')
    .select(TENANT_COLS)
    .eq('owner_user_id', data.user.id)
    .maybeSingle()

  return {
    userId: data.user.id,
    userEmail: data.user.email ?? null,
    tenant: (tenant as BillingTenant | null) ?? null,
  }
}
