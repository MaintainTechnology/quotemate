// Verify a Clerk session token (sent by the dashboard as `Authorization:
// Bearer <token>`) and return the minimal claims the tenant resolver needs.
// Wraps @clerk/backend#verifyToken, which validates the signature against
// Clerk's JWKS using CLERK_SECRET_KEY.
//
// ⚠ Runtime vs types: the installed @clerk/backend returns the CLAIMS PAYLOAD
// directly (r.sub, r.iss, …) and THROWS on an invalid token — even though its
// .d.ts describes a { data, errors } wrapper. extractClerkClaims tolerates
// BOTH shapes so a version bump can't silently 401 every Clerk user again.
//
// Runs in the Node runtime (the API routes already use pg / service-role
// Supabase, i.e. Node — not edge). Returns null on any failure so callers 401
// uniformly and the dual-auth resolver falls through cleanly.

import { verifyToken } from '@clerk/backend'

export type ClerkClaims = { sub: string; email: string | null }

/** Normalise verifyToken's result to { sub, email } | null. Pure + unit-tested.
 *  Accepts the claims-payload-directly shape (current runtime) AND the
 *  { data, errors } wrapper shape (older typings / a possible future bump). */
export function extractClerkClaims(res: unknown): ClerkClaims | null {
  if (!res || typeof res !== 'object') return null
  const r = res as Record<string, unknown>
  if (r.errors) return null
  const claims = (r.data && typeof r.data === 'object' ? r.data : r) as Record<string, unknown>
  const sub = typeof claims.sub === 'string' ? claims.sub : null
  if (!sub) return null
  const email = typeof claims.email === 'string' ? claims.email : null
  return { sub, email }
}

export async function verifyClerkSessionToken(
  token: string,
  secretKey: string | undefined = process.env.CLERK_SECRET_KEY,
): Promise<ClerkClaims | null> {
  if (!secretKey) return null
  try {
    const res = await verifyToken(token, { secretKey })
    return extractClerkClaims(res)
  } catch {
    return null
  }
}
