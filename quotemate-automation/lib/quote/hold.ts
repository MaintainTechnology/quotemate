// WP6 — price-hold / urgency + post-deposit booking-state model.
//
// Pure, dependency-free helpers (unit-tested in hold.test.ts). No DB, no
// Stripe, no Next runtime — safe to import from server components, API
// routes, SMS templates, and tests alike. This is the single source of
// truth for "how long is this price held" and "what state is the booking
// in after a deposit", so the quote page, the SMS templates, and the
// Stripe webhook all agree.
//
// Scope (the brief's WP6 "cheap win"): the held-price countdown + the
// deposit -> reserved -> booked handoff. NOT a full calendar/availability
// product (explicitly multi-week, out of scope).

export const DEFAULT_HOLD_DAYS = 7

export type PriceHoldState = 'none' | 'held' | 'expired'

export interface PriceHoldStatus {
  state: PriceHoldState
  /** ms until expiry. Negative once expired; 0 when there is no hold. */
  msRemaining: number
  /** Whole days remaining, floored, never negative. */
  daysRemaining: number
  /** The resolved hold-until ISO, or null when state === 'none'. */
  holdUntil: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * createdAt + N days -> ISO hold-until string.
 * Returns null for missing/unparseable input so callers can treat
 * "no derivable hold" as "no urgency banner" rather than crash.
 */
export function computePriceHoldUntil(
  createdAtIso: string | null | undefined,
  days: number = DEFAULT_HOLD_DAYS,
): string | null {
  if (!createdAtIso) return null
  const t = Date.parse(createdAtIso)
  if (!Number.isFinite(t)) return null
  return new Date(t + days * DAY_MS).toISOString()
}

/**
 * Resolve the urgency state of a quote.
 * `holdUntilIso` should be quotes.price_hold_until when set, otherwise
 * derive it at the call site via computePriceHoldUntil(created_at).
 */
export function priceHoldStatus(
  holdUntilIso: string | null | undefined,
  nowMs: number = Date.now(),
): PriceHoldStatus {
  if (!holdUntilIso) {
    return { state: 'none', msRemaining: 0, daysRemaining: 0, holdUntil: null }
  }
  const until = Date.parse(holdUntilIso)
  if (!Number.isFinite(until)) {
    return { state: 'none', msRemaining: 0, daysRemaining: 0, holdUntil: null }
  }
  const msRemaining = until - nowMs
  if (msRemaining <= 0) {
    return { state: 'expired', msRemaining, daysRemaining: 0, holdUntil: holdUntilIso }
  }
  return {
    state: 'held',
    msRemaining,
    daysRemaining: Math.floor(msRemaining / DAY_MS),
    holdUntil: holdUntilIso,
  }
}

/**
 * Resolve the effective "price held until" ISO for a quote: prefer the
 * persisted `quotes.price_hold_until` (migration 026); otherwise derive it
 * from `created_at` (+ N days) so a hold exists even before the column is
 * populated. This is the ONE place "effective hold" is defined, so the quote
 * page, the pay redirector, the booking page, and the booking API all agree
 * on when a price has lapsed. Returns null when neither input yields a
 * parseable date (→ 'no hold', never treated as expired).
 */
export function resolvePriceHoldUntil(
  priceHoldUntilIso: string | null | undefined,
  createdAtIso: string | null | undefined,
  days: number = DEFAULT_HOLD_DAYS,
): string | null {
  return priceHoldUntilIso ?? computePriceHoldUntil(createdAtIso, days)
}

/**
 * True once a quote's held price has lapsed. Convenience over
 * resolvePriceHoldUntil + priceHoldStatus for the booking/pay surfaces that
 * only need the boolean gate. A quote with no derivable hold is NOT expired.
 */
export function isPriceHoldExpired(
  priceHoldUntilIso: string | null | undefined,
  createdAtIso: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  return (
    priceHoldStatus(resolvePriceHoldUntil(priceHoldUntilIso, createdAtIso), nowMs)
      .state === 'expired'
  )
}

/**
 * Short AU date label, ASCII-only so it is GSM-7 safe for SMS, e.g.
 * "Thu 22 May". Returns '' for missing/unparseable input.
 */
export function fmtHoldUntilAU(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  try {
    return new Date(t)
      .toLocaleDateString('en-AU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'Australia/Sydney',
      })
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  } catch {
    return ''
  }
}

// ── Post-deposit booking-state model ────────────────────────────────
//   null/undefined -> quote drafted, no deposit yet
//   'requested'    -> self-serve customer booking request, awaiting tradie
//                     confirmation (no estimate, no deposit) — see
//                     specs/dashboard-calendar-tab.md
//   'reserved'     -> deposit paid, slot not yet chosen (locked-in intent)
//   'confirmed'    -> tradie accepted a self-serve request (no deposit taken)
//   'booked'       -> slot chosen / job scheduled (terminal)
export const BOOKING_STATE = {
  REQUESTED: 'requested',
  RESERVED: 'reserved',
  CONFIRMED: 'confirmed',
  BOOKED: 'booked',
} as const

export type BookingState = (typeof BOOKING_STATE)[keyof typeof BOOKING_STATE]

/**
 * Deposit paid -> 'reserved'. Idempotent and never downgrades: if the
 * quote is already 'booked' it stays 'booked' (a re-delivered Stripe
 * event must not knock a scheduled job back to merely reserved).
 */
export function bookingStateAfterDepositPaid(
  prev: string | null | undefined,
): BookingState {
  return prev === BOOKING_STATE.BOOKED ? BOOKING_STATE.BOOKED : BOOKING_STATE.RESERVED
}

/** Slot chosen -> 'booked' (terminal state). */
export function bookingStateAfterSlotPicked(): BookingState {
  return BOOKING_STATE.BOOKED
}

/** Human label for the customer-facing status chip. */
export function bookingStateLabel(state: string | null | undefined): string {
  if (state === BOOKING_STATE.BOOKED) return 'Booked'
  if (state === BOOKING_STATE.CONFIRMED) return 'Confirmed'
  if (state === BOOKING_STATE.RESERVED) return 'Reserved'
  if (state === BOOKING_STATE.REQUESTED) return 'Requested'
  return 'Draft'
}
