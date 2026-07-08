// Flyer Designer — server-only tenant lookup.
//
// The shared tenantForUser (lib/marketing/auth) selects only the 4 fields the
// QR routes need; flyers also need the brand fields used to auto-fill
// templates. Server-only (imports the service-role client), so it is never
// imported by vitest.

import { marketingSupabase } from '@/lib/marketing/auth'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import type { FlyerTenantBrand } from './document'

export type FlyerTenant = FlyerTenantBrand & {
  id: string
  slug: string | null
  twilio_sms_number: string | null
}

const FLYER_TENANT_COLS =
  'id, business_name, logo_url, owner_email, owner_mobile, trade, slug, twilio_sms_number, owner_user_id'

export async function tenantBrandForUser(userId: string): Promise<FlyerTenant | null> {
  const { data } = await marketingSupabase
    .from('tenants')
    .select(FLYER_TENANT_COLS)
    .eq('owner_user_id', userId)
    .maybeSingle()
  return (data as FlyerTenant | null) ?? null
}

/**
 * Dual-auth (Clerk↔Supabase) tenant + brand resolution for the flyer/canva
 * routes. Replaces the `userFromBearer` + `tenantBrandForUser(user.id)` pair,
 * which only resolved Supabase tokens and only matched owner_user_id — a Clerk
 * caller 401'd/404'd because their identity id is the clerk_user_id.
 *
 * Returns null when the token is invalid (caller → 401), or `{ tenant: null }`
 * when the caller is authed but has no tenant yet (caller → 404). `userId` is
 * the tenant's stable Supabase owner id for audit fields (created_by /
 * connectedBy), falling back to the identity subject for unlinked tenants.
 */
export async function tenantBrandFromBearer(
  req: Request,
): Promise<{ tenant: FlyerTenant | null; userId: string } | null> {
  const resolved = await resolveTenantRequest(marketingSupabase, req, FLYER_TENANT_COLS)
  if (!resolved) return null
  const tenant =
    (resolved.tenant as (FlyerTenant & { owner_user_id: string | null }) | null) ?? null
  return { tenant, userId: tenant?.owner_user_id ?? resolved.identity.userId }
}
