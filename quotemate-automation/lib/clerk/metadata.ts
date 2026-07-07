// Keep each tradie's Clerk publicMetadata in lockstep with their REAL Stripe
// subscription. Clerk is the authoritative, app-facing copy of the
// subscription (login + metadata live there); Stripe remains the payment
// system of record and the Stripe webhook is the single sync point that pushes
// the truth into both Supabase (tenants.subscription_*) and here.
//
// The subscription lives under publicMetadata.subscription = { plan, status,
// interval } — a namespaced object so it can't collide with is_admin (or the
// legacy top-level `plan` key). `plan` is a REAL tier (starter|pro|crew) or
// null — never the invalid 'professional' placeholder the old link script wrote.
//
// All writes are best-effort: a Clerk outage must NEVER fail the Stripe webhook.

import { createClerkClient } from '@clerk/backend'
import { mergePublicMetadata } from './link'

export type ClerkSubscription = {
  /** Real plan tier: 'starter' | 'pro' | 'crew' | null. */
  plan: string | null
  /** Stripe subscription status: 'trialing' | 'active' | 'past_due' | 'canceled' | … */
  status: string | null
  /** Billing interval: 'month' | 'year' | null. */
  interval: string | null
}

let _clerk: ReturnType<typeof createClerkClient> | null = null
function client(secretKey = process.env.CLERK_SECRET_KEY) {
  if (!secretKey) return null
  if (!_clerk) _clerk = createClerkClient({ secretKey })
  return _clerk
}

/**
 * Mirror the authoritative subscription onto the Clerk user's
 * publicMetadata.subscription, merged so is_admin and any other keys survive.
 * Returns true on success. Never throws — a Clerk failure returns false so the
 * caller (the Stripe webhook) still 2xx's and the Supabase mirror stays intact.
 */
export async function syncSubscriptionToClerk(
  clerkUserId: string | null | undefined,
  sub: ClerkSubscription,
  opts?: { secretKey?: string },
): Promise<boolean> {
  if (!clerkUserId) return false
  const clerk = client(opts?.secretKey)
  if (!clerk) return false
  try {
    const user = await clerk.users.getUser(clerkUserId)
    const merged = mergePublicMetadata(user.publicMetadata as Record<string, unknown>, {
      subscription: { plan: sub.plan, status: sub.status, interval: sub.interval },
    })
    await clerk.users.updateUserMetadata(clerkUserId, { publicMetadata: merged })
    return true
  } catch {
    return false
  }
}

/**
 * Pure reader for guards/middleware that trust Clerk as the source of truth.
 * Extracts publicMetadata.subscription; null if absent/malformed. Unit-testable
 * with no network.
 */
export function subscriptionFromPublicMetadata(pub: unknown): ClerkSubscription | null {
  if (!pub || typeof pub !== 'object') return null
  const s = (pub as Record<string, unknown>).subscription
  if (!s || typeof s !== 'object') return null
  const o = s as Record<string, unknown>
  return {
    plan: typeof o.plan === 'string' ? o.plan : null,
    status: typeof o.status === 'string' ? o.status : null,
    interval: typeof o.interval === 'string' ? o.interval : null,
  }
}
