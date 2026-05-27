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

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const token = auth.slice(7).trim()
  if (!token) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const admin = await isAdminUser(supabase, data.user.id)
  return Response.json({ ok: true, is_admin: admin, user_id: data.user.id })
}
