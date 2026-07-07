// Shared Bearer-token → tenant resolution used across app/api/tenant/* routes.
//
// DUAL-AUTH (Supabase→Clerk migration): this now delegates to the dual-auth
// resolver, so it accepts EITHER a Clerk session token (→ tenants.clerk_user_id)
// OR the legacy Supabase access token (→ tenants.owner_user_id). The Supabase
// branch is byte-for-byte the old behaviour, so every consumer keeps working
// for users still on Supabase login — no lock-out during the cutover. Returns
// null on any auth failure so callers can answer 401 uniformly.

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from './from-request'

export async function tenantFromBearer(
  supabase: SupabaseClient,
  req: Request,
  columns = 'id',
): Promise<Record<string, unknown> | null> {
  const resolved = await resolveTenantRequest(supabase, req, columns)
  return resolved?.tenant ?? null
}
