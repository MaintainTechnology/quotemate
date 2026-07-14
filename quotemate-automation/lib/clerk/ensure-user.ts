// Ensure a Clerk user exists for a tenant owner, and return its id.
//
// Why this exists: the web funnel (/signup -> /api/auth/signup) creates a
// SUPABASE auth user only. Nothing in the onboarding chain ever created a Clerk
// user, so every web-onboarded tenant landed with clerk_user_id = NULL and was
// invisible in Clerk until someone ran scripts/link-accounts-clerk.ts by hand.
// /api/onboard/activate calls this so the link happens automatically.
//
// The pure rules (username, publicMetadata) live in ./link and are shared with
// that backfill script, so both paths produce identical users.

import { createClerkClient } from '@clerk/backend'
import {
  accountPublicMetadata,
  deriveUsername,
  mergePublicMetadata,
  normalizeEmail,
} from './link'

export type EnsuredClerkUser = { id: string; created: boolean }

/**
 * Find the Clerk user for `email`, or create one (no password — the tradie
 * signs in through Supabase; the Clerk record is the identity/admin surface).
 * Idempotent: a second call returns the same user and re-merges metadata.
 *
 * Returns null when CLERK_SECRET_KEY is unset (local dev without Clerk), so the
 * caller can treat Clerk as an optional, skippable step rather than an error.
 */
export async function ensureClerkUser(opts: {
  email: string
  /** Stable seed for the derived username — the owner's auth user id. */
  seed: string
  isAdmin: boolean
}): Promise<EnsuredClerkUser | null> {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) return null

  const email = normalizeEmail(opts.email)
  if (!email) return null

  const clerk = createClerkClient({ secretKey })
  const desired = accountPublicMetadata({ isAdmin: opts.isAdmin }) as unknown as Record<
    string,
    unknown
  >

  const found = await clerk.users.getUserList({ emailAddress: [email], limit: 1 })
  const existing = found.data[0]
  if (existing) {
    await clerk.users.updateUserMetadata(existing.id, {
      publicMetadata: mergePublicMetadata(
        existing.publicMetadata as Record<string, unknown>,
        desired,
      ),
    })
    return { id: existing.id, created: false }
  }

  const user = await clerk.users.createUser({
    emailAddress: [email],
    username: deriveUsername(email, opts.seed),
    skipPasswordRequirement: true,
    publicMetadata: desired,
  })
  return { id: user.id, created: true }
}
