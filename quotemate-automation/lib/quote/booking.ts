// Funnel-order decisions for the pay short-link.
//
// EVERY funnel is PAY-FIRST, BOOK-SECOND (2026-07-22 reversal):
//   quote → Stripe → /book (pick a time) → /thanks (confirmed).
// Enforced at the pay short-link layer so it covers BOTH the on-page tier
// buttons AND the pay links already sitting in customers' SMS threads.
//
// This unifies what were three different orders: the $99 inspection and the
// dedicated trade surfaces (roofing, painting) were already pay-first
// (app/api/q/book/[trade]/[token]: "these jobs book AFTER paying"); the
// deposit tiers were book-first under the WP6 reorder. One order means one
// three-page shape to build and maintain.
//
// [History: inspection book-first 2026-07-08 → 2026-07-17; deposit tiers
// book-first (WP6) until 2026-07-22. See
// docs/superpowers/specs/2026-07-22-booking-three-page-split-design.md R5.]
//
// The trade-off pay-first carries — the customer commits before seeing any
// times — is bounded by canTakePayment() below: a tenant with zero published
// windows is never charged.
//
// Pure + unit-tested (booking.test.ts) so the funnel order can't silently
// regress. No DB / Stripe / Next here.

import { BOOKING_STATE, type BookingState } from './hold'

export type PayRedirectKind =
  /** Already paid — send to the thank-you / confirmed page. */
  | 'paid'
  /** Payment is the next step → Stripe. */
  | 'stripe'

export type PayRedirectInput = {
  paid: boolean
  /** Kept in the shape for the caller's convenience (and for legacy rows that
   *  chose a slot under the old book-first order). Pay-first no longer branches
   *  on it — an unpaid quote pays next whether or not a time is held. */
  scheduledAt: string | null | undefined
  /** Stripe metadata tier — 'good' | 'better' | 'best' | 'inspection'. */
  tier: string
}

/**
 * Where should /r/<token>/<tier> send the customer?
 *
 *  already paid → 'paid'   (NEVER re-charge — including the $99 inspection fee)
 *  otherwise    → 'stripe' (payment is the FIRST step on every funnel)
 *
 * ORDERING MATTERS: paid is checked FIRST. /r mints a FRESH payable Session
 * per click (2026-07-01), so routing a paid quote to 'stripe' would mint a
 * new charge on every re-click of the old SMS link.
 */
export function payRedirectTarget(input: PayRedirectInput): PayRedirectKind {
  if (input.paid) return 'paid'
  return 'stripe'
}

/**
 * May we take money for this job yet?
 *
 * Pay-first means the customer commits BEFORE seeing any times, so a tenant
 * with zero published windows must not be charged — they would have paid for a
 * visit nobody can schedule. The caller resolves the tenant's bookable windows
 * with the same resolver the booking page renders from, so this answer and the
 * calendar the customer lands on can never disagree.
 */
export function canTakePayment(input: { bookableCount: number }): boolean {
  return input.bookableCount > 0
}

/**
 * Booking state once the deposit is paid (the last step).
 *  • a slot was chosen before paying → 'booked' (confirmed, terminal)
 *  • paid with no slot (legacy SMS link / no slots published) →
 *    'reserved' — the /paid page then prompts them to pick a time.
 */
export function bookingStateOnPaid(
  scheduledAt: string | null | undefined,
): BookingState {
  return scheduledAt ? BOOKING_STATE.BOOKED : BOOKING_STATE.RESERVED
}

/** Deposit tiers a booking may charge. 'inspection' is valid too but is
 *  passed through explicitly (it is a flat $99 fee, not a deposit).
 *  'deposit'/'balance' are the post-site-visit child literals: a child never
 *  reaches the booking pages, but resolveNextTier is also what /paid uses to
 *  echo the tier back, and mapping them to 'better' there would mislabel the
 *  charge (spec post-visit-money-sequence R7). */
const NEXT_PAY_TIERS = new Set(['good', 'better', 'best', 'deposit', 'balance'])

/**
 * Which tier the pay step charges. Shared by the /book page and POST
 * /api/q/[token]/book so both resolve identically:
 *   requested 'inspection'      → 'inspection' (the pay-first $99 fee — must
 *                                 never fall back to a 30% deposit tier)
 *   requested valid deposit tier → itself
 *   else                        → the quote's selected_tier, else 'better'.
 */
export function resolveNextTier(
  requested: string | null | undefined,
  selectedTier: string | null | undefined,
): string {
  if (requested === 'inspection') return 'inspection'
  if (requested && NEXT_PAY_TIERS.has(requested)) return requested
  if (selectedTier && NEXT_PAY_TIERS.has(selectedTier)) return selectedTier
  return 'better'
}

/** True when paying should finalise a confirmed booking (slot already
 *  chosen). Drives the webhook: accepted + booked + prune slot + send
 *  the confirmation SMS. */
export function shouldFinaliseBookingOnPaid(
  scheduledAt: string | null | undefined,
): boolean {
  return !!scheduledAt
}

/**
 * Where /q/<token>/paid sends the customer once the paid state is known
 * (webhook, or the page's own session_id verification).
 *
 * /paid is a ROUTER, not a rendered surface — it exists only to absorb
 * Stripe's success_url and run the webhook-race guard before handing off to
 * one of the three real pages:
 *   paid + no slot → 'book'   (pick a time)
 *   paid + slot    → 'thanks' (confirmed)
 *   not paid yet   → 'quote'  (payment still settling; never strand them here)
 */
export function paidPageTarget(input: {
  paid: boolean
  scheduledAt: string | null | undefined
  /** quotes.quote_kind (spec post-visit-money-sequence R11). A 'final' or
   *  'balance' child has no visit to schedule — the site visit already
   *  happened — so it goes to the quote page, whose paid state reads
   *  "Deposit received" / "Paid in full". Sending it to 'book' would hand the
   *  customer a calendar for a visit that is behind them, let them prune a
   *  real slot out of the tenant's availability, and fire the tradie's
   *  "booked and paid the deposit" SMS for a job with no appointment. */
  quoteKind?: string | null | undefined
}): 'book' | 'thanks' | 'quote' {
  if (isChildKind(input.quoteKind)) return 'quote'
  if (!input.paid) return 'quote'
  return input.scheduledAt ? 'thanks' : 'book'
}

/** True for the post-site-visit child rows ('final' | 'balance'). Local to
 *  this module so the pure booking helpers stay dependency-free. */
function isChildKind(v: string | null | undefined): boolean {
  return v === 'final' || v === 'balance'
}

// ── Off-platform "book directly on the tradie's calendar" option ────
//
// A Google Appointment link (calendar.app.google/…) has no callback, so
// bookings made there are invisible to QuoteMax and the deposit is
// arranged by the tradie directly (decision: "DB = pay-last; Google =
// off-platform"). We surface the link ONLY when it is a real https URL
// so a blank/typo'd env var can never render a broken or non-secure
// "book here" button. Sourced from env (GOOGLE_BOOKING_URL) — not
// hardcoded — so it's configurable per deploy without a code change.

/**
 * Validate + normalise the configured off-platform booking URL.
 * Returns the trimmed URL only if it's an absolute https:// link,
 * otherwise null (→ the Google option simply doesn't render).
 */
export function resolveGoogleBookingUrl(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed)
    if (u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}
