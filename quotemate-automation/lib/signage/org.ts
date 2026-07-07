// Signage Compliance — resolve the HQ user's org from a bearer token.
//
// Mirrors the tenant auth pattern (app/api/tenant/me/route.ts): validate
// the Supabase access token, find the org this user owns, and self-heal
// the owner_user_id link by email when a demo/seed org was created with
// only owner_email set.

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveIdentityRequest } from '@/lib/tenant/from-request'

export type OrgContext = { userId: string; orgId: string }

export async function orgFromBearer(
  supabase: SupabaseClient,
  req: Request,
): Promise<OrgContext | null> {
  // Dual-auth: Clerk session token OR legacy Supabase token. orgs.owner_user_id
  // is a SUPABASE auth id, so for a Clerk caller we map clerk_user_id → the
  // tenant's owner_user_id (+ owner_email) before the org lookup + self-heal.
  const identity = await resolveIdentityRequest(supabase, req)
  if (!identity) return null
  let userId = identity.userId
  let userEmail = identity.email
  if (identity.provider === 'clerk') {
    const { data: t } = await supabase
      .from('tenants')
      .select('owner_user_id, owner_email')
      .eq('clerk_user_id', identity.userId)
      .maybeSingle()
    userId = (t?.owner_user_id as string | null) ?? identity.userId
    userEmail = userEmail ?? ((t?.owner_email as string | null) ?? null)
  }
  const user = { id: userId, email: userEmail }

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

  // Demo/MVP convenience: if this authenticated user owns no org and none
  // matches their email, adopt a single seeded-but-unclaimed org (one whose
  // owner_user_id is still null) so the feature just works without a manual
  // link. Bounded to EXACTLY ONE unclaimed org — if several franchisors
  // exist, orgs must be claimed explicitly rather than guessed.
  const { data: unclaimed } = await supabase
    .from('orgs')
    .select('id')
    .is('owner_user_id', null)
    .limit(2)
  if (unclaimed && unclaimed.length === 1) {
    const orgId = unclaimed[0].id as string
    await supabase
      .from('orgs')
      .update({ owner_user_id: user.id, owner_email: user.email?.toLowerCase() ?? null })
      .eq('id', orgId)
    return { userId: user.id, orgId }
  }

  return null
}
