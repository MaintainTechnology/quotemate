// Production wiring for the dual-auth resolver: binds the pure resolver in
// lib/tenant/current.ts to the real Clerk verifier (lib/clerk/verify.ts). Route
// handlers call these one-liners; the resolver stays verifier-agnostic so it
// unit-tests without network. Node runtime only (verify uses CLERK_SECRET_KEY).

import type { SupabaseClient } from '@supabase/supabase-js'
import { tenantFromRequest, identityFromRequest, type Identity } from './current'
import { verifyClerkSessionToken } from '@/lib/clerk/verify'

/** Resolve the caller's tenant row (Clerk→clerk_user_id, else Supabase→owner_user_id). */
export function resolveTenantRequest(
  supabase: SupabaseClient,
  req: Request,
  columns = 'id',
): Promise<{ identity: Identity; tenant: Record<string, unknown> | null } | null> {
  return tenantFromRequest(req, { supabase, verifyClerk: verifyClerkSessionToken }, columns)
}

/** Resolve just the caller's normalised identity (provider + userId + email). */
export function resolveIdentityRequest(
  supabase: SupabaseClient,
  req: Request,
): Promise<Identity | null> {
  return identityFromRequest(req, { supabase, verifyClerk: verifyClerkSessionToken })
}
