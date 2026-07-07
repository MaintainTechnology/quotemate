// Dual-auth tenant resolver — the single chokepoint for "who is calling and
// which tenant do they own", during (and after) the Supabase→Clerk migration.
//
// A request arrives with `Authorization: Bearer <jwt>`. The token is either a
// Clerk session token or a legacy Supabase access token. We classify it by its
// `iss` claim, verify it with the matching verifier, and load the tenant by the
// right key:
//   • Clerk    → tenants.clerk_user_id = <clerk user id>
//   • Supabase → tenants.owner_user_id = <supabase user id>   (legacy, unchanged)
//
// The Supabase branch is byte-for-byte the old behaviour, so every route wired
// to this keeps working for users who are still on Supabase login — no lock-out
// at any point in the cutover.

import type { SupabaseClient } from '@supabase/supabase-js'

export type AuthProvider = 'clerk' | 'supabase'
export type Identity = { provider: AuthProvider; userId: string; email: string | null }

/** Verifier injected so the resolver is unit-testable without network.
 *  In production this is lib/clerk/verify.ts#verifyClerkSessionToken. */
export type ResolveDeps = {
  supabase: SupabaseClient
  verifyClerk: (token: string) => Promise<{ sub: string; email: string | null } | null>
}

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function parseBearer(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  return token || null
}

/** Decode a JWT payload WITHOUT verifying (used only to read `iss` for routing).
 *  Never trust these claims — the value is verified by the provider's verifier. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8')
    const obj = JSON.parse(json)
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Decide which provider minted a token by its `iss` claim.
 *  Supabase: https://<ref>.supabase.co/auth/v1
 *  Clerk:    https://<slug>.clerk.accounts.dev  OR  https://clerk.<domain>
 *  Returns null when it can't be classified (caller treats as legacy Supabase). */
export function providerForToken(token: string): AuthProvider | null {
  const payload = decodeJwtPayload(token)
  const iss = typeof payload?.iss === 'string' ? payload.iss : ''
  if (!iss) return null
  if (iss.includes('supabase.') || iss.includes('/auth/v1')) return 'supabase'
  if (iss.includes('clerk.') || iss.includes('.accounts.dev')) return 'clerk'
  return null
}

/** Resolve the caller's normalised identity, or null on any auth failure. */
export async function identityFromRequest(req: Request, deps: ResolveDeps): Promise<Identity | null> {
  const token = parseBearer(req)
  if (!token) return null

  if (providerForToken(token) === 'clerk') {
    const claims = await deps.verifyClerk(token).catch(() => null)
    if (!claims?.sub) return null
    return { provider: 'clerk', userId: claims.sub, email: claims.email }
  }

  // Supabase, or an unclassifiable token → legacy Supabase verification path.
  const { data, error } = await deps.supabase.auth.getUser(token)
  if (error || !data.user) return null
  return { provider: 'supabase', userId: data.user.id, email: data.user.email ?? null }
}

/** Resolve the caller and load their tenant row by the provider-appropriate key.
 *  `columns` follows the PostgREST select syntax used elsewhere ('*' or a list). */
export async function tenantFromRequest(
  req: Request,
  deps: ResolveDeps,
  columns = 'id',
): Promise<{ identity: Identity; tenant: Record<string, unknown> | null } | null> {
  const identity = await identityFromRequest(req, deps)
  if (!identity) return null
  const column = identity.provider === 'clerk' ? 'clerk_user_id' : 'owner_user_id'
  const { data } = await deps.supabase
    .from('tenants')
    .select(columns)
    .eq(column, identity.userId)
    .maybeSingle()
  return { identity, tenant: (data as Record<string, unknown> | null) ?? null }
}
