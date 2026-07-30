// Duplicate-email handling for the Clerk signup funnel — the port of
// resumeAbandonedSignup (app/api/auth/signup/route.ts:66-100).
//
// The legacy Supabase funnel treats "email already exists" as recoverable: an
// auth user with NO tenant row is an abandoned wizard run, not a real account,
// and a bare 409 would lock the tradie out of their own email forever. It proves
// ownership with the submitted password FIRST, then checks for a tenant, then
// continues in the same submit.
//
// The Clerk port keeps that order, which is what stops it becoming an
// email-enumeration oracle: nothing about tenant existence is disclosed until
// the password has authenticated against Clerk. The tenant question is answered
// by GET /api/tenant/me, which already resolves dual-auth and returns 404 for
// authed-but-no-tenant — the same signal app/dashboard/page.tsx:715 relies on.
//
// Pure so it unit-tests without the Clerk SDK or a browser.

/** Why `signUp.password()` did not produce a session. */
export type SignUpFailureKind =
  /** A session is already live, so Clerk could not create another. Must be
   *  handled BEFORE a duplicate-email resume, or we'd sign in on top of it. */
  | 'already_signed_in'
  /** The email already has a Clerk user — the resume case. */
  | 'identifier_taken'
  /** Anything else; show Clerk's own message. */
  | 'other'

/**
 * Classify a failed sign-up.
 *
 * Prefers Clerk's two first-class resource signals over sniffing error text:
 *   • `existingSession` — "the sign-up was not able to create a new session
 *     because the identifier already exists in an existing session"
 *   • `isTransferable`  — "there is a matching user for provided identifier,
 *     and the sign-up can be transferred to a sign-in"
 * (both on SignUpFutureResource, @clerk/shared 4.22.1).
 *
 * The string predicates below stay as the fallback for instances/versions where
 * those fields aren't populated. A Clerk wording change then degrades to
 * 'other' — raw message shown, no resume attempted — which is the safe direction.
 */
export function classifySignUpFailure(input: {
  existingSession?: boolean
  isTransferable?: boolean
  error: unknown
}): SignUpFailureKind {
  if (input.existingSession || isAlreadySignedInError(input.error)) return 'already_signed_in'
  if (input.isTransferable || isIdentifierTakenError(input.error)) return 'identifier_taken'
  return 'other'
}

/** What the /sign-up page should do about a duplicate email. */
export type DuplicateEmailOutcome =
  /** The password did NOT authenticate. No session exists, and nothing about
   *  tenant existence may be disclosed. Show /signup's "already exists — sign
   *  in instead" and stop. */
  | 'needs_signin'
  /** Authenticated, and /api/tenant/me confirmed no tenant → abandoned wizard
   *  run. Continue to /onboard in this same submit, identity populated. */
  | 'resume'
  /** Authenticated, but not a confirmed-empty account — either a real tenant
   *  exists, or we could not get a clean answer. Send them to /dashboard, which
   *  self-routes to /onboard when no tenant is found
   *  (app/dashboard/page.tsx:714-717). */
  | 'existing_account'

/** Codes/messages Clerk uses when the email is already registered. Matched as a
 *  family rather than one literal so a Clerk rename degrades to /signup's copy
 *  instead of leaking raw Clerk text (spec R3). */
const TAKEN_MESSAGE = /already\s+(?:been\s+)?(?:exists?|taken|registered|in use)/i

type ClerkErrorLike = {
  code?: unknown
  message?: unknown
  longMessage?: unknown
  errors?: unknown
}

function firstNested(err: ClerkErrorLike): ClerkErrorLike | undefined {
  return Array.isArray(err.errors) ? (err.errors[0] as ClerkErrorLike | undefined) : undefined
}

/** Codes/messages Clerk uses when a sign-up is attempted with a live session. */
const SIGNED_IN_MESSAGE = /already\s+signed\s+in/i

/** Every code + message on the error and its first nested error. */
function codesAndMessages(error: unknown): { codes: string[]; messages: string[] } {
  if (!error || typeof error !== 'object') return { codes: [], messages: [] }
  const e = error as ClerkErrorLike
  const nested = firstNested(e)
  const isStr = (v: unknown): v is string => typeof v === 'string'
  return {
    codes: [e.code, nested?.code].filter(isStr),
    messages: [e.longMessage, e.message, nested?.longMessage, nested?.message].filter(isStr),
  }
}

/** True when this error means "that email is already registered". */
export function isIdentifierTakenError(error: unknown): boolean {
  const { codes, messages } = codesAndMessages(error)
  return (
    codes.some((c) => c.includes('identifier_exists')) || messages.some((m) => TAKEN_MESSAGE.test(m))
  )
}

/**
 * True when Clerk refused because a session is already live.
 *
 * Reachable on the second submit: a duplicate-email attempt whose password
 * authenticated leaves a finalised session behind, so if the tradie then edits
 * the email and resubmits, `signUp.password()` is called while signed in. Without
 * this branch they get a raw SDK string and no way forward.
 */
export function isAlreadySignedInError(error: unknown): boolean {
  const { codes, messages } = codesAndMessages(error)
  return (
    codes.some((c) => c.includes('session_exists') || c.includes('already_signed_in')) ||
    messages.some((m) => SIGNED_IN_MESSAGE.test(m))
  )
}

/**
 * Decide the duplicate-email outcome.
 *
 * @param signInFailed  the password did NOT authenticate against Clerk
 * @param tenantStatus  HTTP status from GET /api/tenant/me, or null if the call
 *                      never completed
 *
 * Two invariants, both load-bearing:
 *
 *   1. ONLY a clean 404 resumes. An outage, a 401, or a 3xx must never open the
 *      wizard — that is the fail-closed half.
 *   2. `needs_signin` is reachable ONLY when the password failed. Once the
 *      password authenticates we have finalised a real Clerk session, so
 *      "sign in instead" would be both false and a dead end (the link bounces a
 *      signed-in user straight back). An authenticated tradie we can't resume
 *      goes to the dashboard, which routes itself.
 */
export function decideDuplicateEmail(input: {
  signInFailed: boolean
  tenantStatus: number | null
}): DuplicateEmailOutcome {
  if (input.signInFailed) return 'needs_signin'
  if (input.tenantStatus === 404) return 'resume'
  return 'existing_account'
}
