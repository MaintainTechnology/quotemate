// Bearer-token → admin-user resolution for the /api/admin/loader/* routes.
//
// Every admin route calls this first (spec §9 rule 4 — a real server-side
// admin check on every admin route + API). It mirrors the userFromBearer
// pattern the rest of the app uses, then adds the admin_users gate.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isAdminUser } from './auth'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

/**
 * Resolve the request's `Authorization: Bearer <token>` to an ADMIN auth
 * user id. Returns null for a missing/invalid token OR a non-admin user —
 * the route turns either into a 403, so a non-admin learns nothing.
 *
 * Dual-auth: accepts a Clerk session token OR the legacy Supabase token.
 * admin_users is keyed by the SUPABASE auth id, so for a Clerk caller the
 * admin subject is the mapped tenant.owner_user_id; for a Supabase caller it
 * is the caller's own id. The returned id is always that Supabase auth id.
 */
export async function resolveAdminUserId(
  supabase: SupabaseClient,
  req: Request,
): Promise<string | null> {
  const resolved = await resolveTenantRequest(supabase, req, 'owner_user_id')
  if (!resolved) return null
  const tenant = resolved.tenant as { owner_user_id: string | null } | null
  const subjectId =
    tenant?.owner_user_id ??
    (resolved.identity.provider === 'supabase' ? resolved.identity.userId : null)
  if (!subjectId) return null
  const admin = await isAdminUser(supabase, subjectId)
  return admin ? subjectId : null
}
