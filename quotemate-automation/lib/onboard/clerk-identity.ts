// Clerk equivalent of the wizard's Supabase session backfill.
//
// The Supabase funnel backfills business_name / first_name / email / mobile from
// `supabase.auth.getUser()` + user_metadata (app/onboard/page.tsx:322-334). The
// Clerk funnel had no equivalent: /onboard only ever recovered `clerk_user_id`
// from the live session (page.tsx:260-264) and never imported useUser, so a
// Clerk tradie who reached the wizard without URL params — bookmark, a refresh
// that dropped the query, or the dashboard's authed-but-no-tenant bounce
// (app/dashboard/page.tsx:715) — had to retype everything.
//
// /sign-up already stores what we need at signup time: `firstName` plus
// `unsafeMetadata.business_name` / `unsafeMetadata.owner_mobile`
// (app/sign-up/[[...sign-up]]/page.tsx:179-181).
//
// Pure, and typed structurally rather than against Clerk's UserResource, so it
// unit-tests without the SDK — same reason preflight-logic.ts is extracted.

import { normaliseAuMobile } from './schema'

/** The shape we read off a Clerk user. Structural on purpose. */
export type ClerkUserLike = {
  firstName?: string | null
  primaryEmailAddress?: { emailAddress?: string | null } | null
  unsafeMetadata?: Record<string, unknown> | null
} | null | undefined

/** Only the wizard fields a Clerk session can supply. */
export type ClerkIdentityPatch = Partial<{
  business_name: string
  owner_first_name: string
  owner_email: string
  owner_mobile: string
}>

/** A trimmed non-empty string, or undefined. Guards against non-string metadata
 *  (unsafeMetadata is `Record<string, unknown>` — anything can be in there). */
function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t === '' ? undefined : t
}

/**
 * Build the backfill patch for the wizard form.
 *
 * Keys whose source is absent are OMITTED, never set to ''. The caller merges
 * with `prev.x || patch.x`, so an empty string would clobber a URL param that
 * pass 1 already applied.
 */
export function identityFromClerkUser(user: ClerkUserLike): ClerkIdentityPatch {
  if (!user) return {}
  const meta = user.unsafeMetadata ?? {}
  const patch: ClerkIdentityPatch = {}

  const businessName = str(meta.business_name)
  if (businessName) patch.business_name = businessName

  const firstName = str(user.firstName)
  if (firstName) patch.owner_first_name = firstName

  const email = str(user.primaryEmailAddress?.emailAddress)
  if (email) patch.owner_email = email

  const mobile = str(meta.owner_mobile)
  if (mobile) {
    // Normalise like the URL pass does (app/onboard/page.tsx:288-292): the
    // activate schema's regex is stricter than the wizard's lock check, so a
    // raw '04 1234 5678' would 400. Unparseable values stay raw and visible.
    try {
      patch.owner_mobile = normaliseAuMobile(mobile)
    } catch {
      patch.owner_mobile = mobile
    }
  }

  return patch
}
