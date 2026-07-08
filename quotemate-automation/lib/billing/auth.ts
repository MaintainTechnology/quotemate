// Shared auth + tenant resolution for the /api/billing/* routes.
//
// Same contract as /api/tenant/me: the client sends
// `Authorization: Bearer <supabase access token>`; we validate it with the
// service-role client and resolve the tradie's tenant by owner_user_id.
// Service role is used because RLS tenant policies aren't shipped yet
// (CLAUDE.md) — isolation is enforced here by the owner_user_id filter.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

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
  /** AU state (e.g. 'QLD') — drives the tenant's timezone via tzForState. */
  state: string | null
}

const TENANT_COLS =
  'id, owner_email, business_name, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_plan, subscription_interval, subscription_current_period_end, trial_ends_at, subscription_cancel_at_period_end, state'

/**
 * Resolve { user, tenant } from the request's bearer token. Returns null
 * when the token is missing/invalid (caller → 401). `tenant` may be null
 * when the user is authed but hasn't onboarded a tenant yet (caller → 404).
 */
export async function tenantFromBearer(
  req: Request,
): Promise<{ userId: string; userEmail: string | null; tenant: BillingTenant | null } | null> {
  // Dual-auth: Clerk session token (→ clerk_user_id) OR legacy Supabase token
  // (→ owner_user_id). userId is the resolved provider id (Clerk user_… or the
  // Supabase uuid); callers here key off the tenant, not the raw id.
  const resolved = await resolveTenantRequest(billingAdmin(), req, TENANT_COLS)
  if (!resolved) return null
  return {
    userId: resolved.identity.userId,
    userEmail: resolved.identity.email,
    tenant: (resolved.tenant as BillingTenant | null) ?? null,
  }
}
