// Production wiring for the dual-auth resolver: binds the pure resolver in
// lib/tenant/current.ts to the real Clerk verifier (lib/clerk/verify.ts). Route
// handlers call these one-liners; the resolver stays verifier-agnostic so it
// unit-tests without network. Node runtime only (verify uses CLERK_SECRET_KEY).

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClerkClient } from '@clerk/backend'
import { tenantFromRequest, identityFromRequest, type Identity } from './current'
import { verifyClerkSessionToken } from '@/lib/clerk/verify'

// sub → email cache. One localhost dashboard load fires several /api/tenant/*
// calls; without this each one that MISSES the id lookup would hit Clerk's API
// again. Module-scoped map is enough — emails are stable and the set is tiny.
const _clerkEmailCache = new Map<string, string | null>()

/** Fetch the caller's primary email from Clerk when the session token didn't
 *  carry it (Clerk omits `email` from session tokens by default). Only used as
 *  the resolver's email fallback, i.e. after an id lookup miss. Uses the
 *  environment's OWN CLERK_SECRET_KEY, so dev looks up test users and prod looks
 *  up live users. Returns null (never throws) so a Clerk outage just falls
 *  through to "no tenant" rather than 500ing the request. */
async function resolveClerkEmail(identity: Identity): Promise<string | null> {
  if (identity.email) return identity.email
  if (identity.provider !== 'clerk') return null
  if (_clerkEmailCache.has(identity.userId)) return _clerkEmailCache.get(identity.userId) ?? null
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) return null
  try {
    const user = await createClerkClient({ secretKey }).users.getUser(identity.userId)
    const email =
      user.primaryEmailAddress?.emailAddress?.toLowerCase() ??
      user.emailAddresses?.[0]?.emailAddress?.toLowerCase() ??
      null
    _clerkEmailCache.set(identity.userId, email)
    return email
  } catch {
    return null
  }
}

/** Resolve the caller's tenant row (Clerk→clerk_user_id, else Supabase→owner_user_id).
 *  Falls back to owner_email (via resolveClerkEmail) when the id lookup misses. */
export function resolveTenantRequest(
  supabase: SupabaseClient,
  req: Request,
  columns = 'id',
): Promise<{ identity: Identity; tenant: Record<string, unknown> | null } | null> {
  return tenantFromRequest(
    req,
    { supabase, verifyClerk: verifyClerkSessionToken, resolveEmail: resolveClerkEmail },
    columns,
  )
}

/** Resolve just the caller's normalised identity (provider + userId + email). */
export function resolveIdentityRequest(
  supabase: SupabaseClient,
  req: Request,
): Promise<Identity | null> {
  return identityFromRequest(req, { supabase, verifyClerk: verifyClerkSessionToken })
}
