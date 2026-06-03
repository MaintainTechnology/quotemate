// Signage Compliance — resolve the HQ user's org from a bearer token.
//
// Mirrors the tenant auth pattern (app/api/tenant/me/route.ts): validate
// the Supabase access token, find the org this user owns, and self-heal
// the owner_user_id link by email when a demo/seed org was created with
// only owner_email set.

import type { SupabaseClient } from '@supabase/supabase-js'

export type OrgContext = { userId: string; orgId: string }

export async function orgFromBearer(
  supabase: SupabaseClient,
  req: Request,
): Promise<OrgContext | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const user = data.user

  // Primary: an org owned by this user.
  const primary = await supabase
    .from('orgs')
    .select('id')
    .eq('owner_user_id', user.id)
    .maybeSingle()
  if (primary.data) return { userId: user.id, orgId: primary.data.id as string }

  // Self-heal: a demo/seed org may have been created with owner_email only.
  // Link it to this signed-in user on first load (mirrors tenant/me).
  if (user.email) {
    const { data: byEmail } = await supabase
      .from('orgs')
      .select('id')
      .eq('owner_email', user.email.toLowerCase())
      .maybeSingle()
    if (byEmail) {
      await supabase.from('orgs').update({ owner_user_id: user.id }).eq('id', byEmail.id)
      return { userId: user.id, orgId: byEmail.id as string }
    }
  }

  return null
}
