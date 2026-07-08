// Book-first / pay-last funnel decisions (WP6 reorder).
//
// Old flow: quote → pay deposit → pick a time.  John's call: paying
// before booking is bad UX; the deposit must be the LAST step.
//
// New flow: quote → pick a time (held on the quote) → pay deposit →
// booking confirmed. This is enforced at the pay short-link layer so it
// covers BOTH the on-page tier buttons AND the pay links already sitting
// in 138 customers' SMS threads ("force book-first for all").
//
// Pure + unit-tested (booking.test.ts) so the funnel order can't silently
// regress. No DB / Stripe / Next here.

import { BOOKING_STATE, type BookingState } from './hold'

export type PayRedirectKind =
  /** Already paid — send to the thank-you / confirmed page. */
  | 'paid'
  /** Not paid and no slot chosen yet — must pick a time FIRST. */
  | 'book'
  /** Slot already chosen, not paid — deposit is the final step → Stripe. */
  | 'stripe'

export type PayRedirectInput = {
  paid: boolean
  scheduledAt: string | null | undefined
  /** Stripe metadata tier. Kept for callers/logging; since 2026-07-08 the
   *  $99 'inspection' fee follows the same book-first order as the deposit
   *  tiers (Jon's workflow: select a time slot, THEN pay). */
  tier: string
}

/**
 * Where should /r/<token>/<tier> send the customer?
 *
 *  already paid          → 'paid'   (NEVER re-charge — including the $99
 *                          inspection fee; see ordering note below)
 *  not paid, no slot      → 'book'   (choose a time first — ALL tiers,
 *                          inspection included since 2026-07-08)
 *  not paid, slot chosen  → 'stripe' (payment is the last step)
 *
 * ORDERING MATTERS: paid is checked FIRST. /r mints a FRESH payable Session
 * per click (2026-07-01), so routing a paid quote to 'stripe' would mint a
 * new charge on every re-click of the old SMS link.
 */
export function payRedirectTarget(input: PayRedirectInput): PayRedirectKind {
  if (input.paid) return 'paid'
  if (!input.scheduledAt) return 'book'
  return 'stripe'
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
 *  passed through explicitly (it is a flat $99 fee, not a deposit). */
const NEXT_PAY_TIERS = new Set(['good', 'better', 'best'])

/**
 * Which tier the pay step AFTER booking charges. Shared by the /book page
 * and POST /api/q/[token]/book so both resolve identically:
 *   requested 'inspection'      → 'inspection' (book-first $99 fee — must
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
 * (webhook, or the page's own session_id verification):
 *   paid + no slot → 'book'  (auto-navigate to the slot picker — the $99
 *                    inspection is date-less at payment time, and legacy
 *                    deposits paid off old SMS links can be too)
 *   otherwise      → 'stay'  (booked confirmation, or payment still pending)
 */
export function paidPageTarget(input: {
  paid: boolean
  scheduledAt: string | null | undefined
}): 'book' | 'stay' {
  return input.paid && !input.scheduledAt ? 'book' : 'stay'
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
