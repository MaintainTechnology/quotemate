// Pure decision logic for linking QuoteMax accounts (Supabase `tenants`) to
// Clerk users and stamping their subscription + admin state as Clerk
// publicMetadata. No I/O — scripts/link-accounts-clerk.ts does the DB + Clerk
// calls; this holds the rules so they're unit-testable (same pattern as
// lib/billing/entitlements.ts).

/**
 * @deprecated Not a real plan tier. The link step must NOT invent a
 * subscription plan — the authoritative plan (starter|pro|crew|null) is synced
 * from Stripe by the webhook into both tenants.subscription_plan and Clerk
 * publicMetadata.subscription (see lib/clerk/metadata.ts). Kept only so old
 * references resolve; do not write it into any entitlement-consumed column.
 */
export const PROFESSIONAL_PLAN = 'professional'

export type AccountPublicMetadata = {
  is_admin: boolean
}

/**
 * The publicMetadata to stamp on a tradie/admin account's Clerk user at link
 * time: identity/admin only. `is_admin` is true only for a designated admin.
 * The subscription is NOT set here — it is owned by the Stripe webhook, which
 * writes publicMetadata.subscription = { plan, status, interval } with the REAL
 * tier. This avoids the old bug of stamping the invalid 'professional' plan.
 */
export function accountPublicMetadata(opts: { isAdmin: boolean }): AccountPublicMetadata {
  return { is_admin: opts.isAdmin }
}

/**
 * Merge a publicMetadata patch over a Clerk user's existing publicMetadata so
 * unrelated keys survive (Clerk stores an opaque object we don't own).
 */
export function mergePublicMetadata(
  existing: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(existing ?? {}), ...patch }
}

/** Normalise an email for set membership: trimmed + lower-cased. */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

/** The set of designated-admin emails, from admin_users rows. */
export function adminEmailSet(rows: { email: string | null }[]): Set<string> {
  return new Set(rows.map((r) => normalizeEmail(r.email)).filter(Boolean))
}

/** Is this email one of the designated admins? */
export function isAdminEmail(
  email: string | null | undefined,
  adminEmails: Set<string>,
): boolean {
  const e = normalizeEmail(email)
  return e ? adminEmails.has(e) : false
}

/**
 * A deterministic, unique, Clerk-valid username for a backend-created user.
 * Some Clerk instances require a username; we derive one from the email
 * local-part plus a slice of a stable seed (the owner's user id) so it is
 * unique and re-runs produce the same value. Only [a-z0-9_], 4-64 chars.
 */
export function deriveUsername(email: string, seed: string): string {
  const local = normalizeEmail(email).split('@')[0] ?? ''
  const base = local.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'user'
  const suffix = (seed || '').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase() || 'acct'
  return `qm_${base}_${suffix}`.slice(0, 64)
}
