// GET /api/admin/whoami — informational admin-status probe.
//
// The dashboard sidebar uses this to decide whether to surface the
// "Admin loader" nav entry. Returns is_admin=false (NOT 403) for
// signed-in non-admins so the dashboard can render normally without
// guessing. Returns 401 only when the bearer token itself is bad.
//
// Spec §9 rule 4 — admin status is the SERVER's call (admin_users
// table), never a client-side flag. This route returns the boolean
// for UI purposes; every admin route still re-checks server-side
// (via resolveAdminUserId) before doing any work.

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
  const resolved = await resolveTenantRequest(supabase, req, 'owner_user_id')
  if (!resolved) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  // admin_users is keyed by the SUPABASE auth id. For a Clerk caller that is
  // the mapped tenant.owner_user_id; for a Supabase caller it's their own id.
  const tenant = resolved.tenant as { owner_user_id: string | null } | null
  const subjectId =
    tenant?.owner_user_id ??
    (resolved.identity.provider === 'supabase' ? resolved.identity.userId : null)
  const admin = subjectId ? await isAdminUser(supabase, subjectId) : false
  return Response.json({ ok: true, is_admin: admin, user_id: resolved.identity.userId })
}
