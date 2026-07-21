// Funnel-order regression coverage.
//
// PAY FIRST, BOOK SECOND on every funnel (2026-07-22 reversal): quote → Stripe
// → /book (pick a time) → /thanks. Locks the order so a future change can't
// silently put booking back before payment.
//
// [History: deposit tiers were BOOK-FIRST, PAY-LAST under the WP6 reorder
// until 2026-07-22; the $99 inspection was already pay-first via
// customer-quote-five-sections R7/D1a. See
// docs/superpowers/specs/2026-07-22-booking-three-page-split-design.md R5.]

import { describe, expect, it } from 'vitest'
import { BOOKING_STATE } from './hold'
import {
  bookingStateOnPaid,
  canTakePayment,
  paidPageTarget,
  payRedirectTarget,
  resolveGoogleBookingUrl,
  resolveNextTier,
  shouldFinaliseBookingOnPaid,
} from './booking'

describe('payRedirectTarget — pay-first on every funnel', () => {
  it('not paid + no slot → Stripe (payment is now the FIRST step)', () => {
    expect(
      payRedirectTarget({ paid: false, scheduledAt: null, tier: 'better' }),
    ).toBe('stripe')
    expect(
      payRedirectTarget({ paid: false, scheduledAt: undefined, tier: 'good' }),
    ).toBe('stripe')
  })

  it('not paid + slot already chosen (legacy book-first row) → Stripe', () => {
    expect(
      payRedirectTarget({
        paid: false,
        scheduledAt: '2026-05-20T03:00:00.000Z',
        tier: 'best',
      }),
    ).toBe('stripe')
  })

  it('already paid → thank-you/confirmed page (never re-charge)', () => {
    expect(
      payRedirectTarget({ paid: true, scheduledAt: null, tier: 'better' }),
    ).toBe('paid')
    expect(
      payRedirectTarget({
        paid: true,
        scheduledAt: '2026-05-20T03:00:00.000Z',
        tier: 'good',
      }),
    ).toBe('paid')
  })

  it('inspection $99 stays PAY-FIRST (five-sections R7, D1a)', () => {
    expect(
      payRedirectTarget({ paid: false, scheduledAt: null, tier: 'inspection' }),
    ).toBe('stripe')
  })

  it('PAID inspection → thank-you, never a fresh $99 charge (double-charge guard)', () => {
    // /r mints a fresh payable Session per click since 2026-07-01; if a paid
    // inspection ever routed to 'stripe' again, every re-click of the old SMS
    // link would charge another $99.
    expect(
      payRedirectTarget({ paid: true, scheduledAt: null, tier: 'inspection' }),
    ).toBe('paid')
    expect(
      payRedirectTarget({
        paid: true,
        scheduledAt: '2026-05-20T03:00:00.000Z',
        tier: 'inspection',
      }),
    ).toBe('paid')
  })

  it('never returns "book" for ANY input — the order cannot silently revert', () => {
    for (const tier of ['good', 'better', 'best', 'inspection']) {
      for (const paid of [true, false]) {
        for (const scheduledAt of [null, '2026-05-20T03:00:00.000Z']) {
          expect(payRedirectTarget({ paid, scheduledAt, tier })).not.toBe('book')
        }
      }
    }
  })
})

describe('canTakePayment — no-slots guard', () => {
  it('allows the charge when the tenant has bookable windows', () => {
    expect(canTakePayment({ bookableCount: 3 })).toBe(true)
    expect(canTakePayment({ bookableCount: 1 })).toBe(true)
  })

  it('blocks the charge when the tenant has published none', () => {
    // Pay-first means the customer commits before seeing any times — charging
    // with zero windows sells a visit nobody can schedule.
    expect(canTakePayment({ bookableCount: 0 })).toBe(false)
  })
})

describe('resolveNextTier — which tier the post-booking pay step charges', () => {
  it('passes the inspection fee through (book-first inspection must NOT fall back to a deposit tier)', () => {
    expect(resolveNextTier('inspection', null)).toBe('inspection')
    expect(resolveNextTier('inspection', 'best')).toBe('inspection')
  })

  it('passes a valid deposit tier through', () => {
    expect(resolveNextTier('good', 'best')).toBe('good')
  })

  it('falls back to the quote selected_tier, then better', () => {
    expect(resolveNextTier(null, 'best')).toBe('best')
    expect(resolveNextTier(undefined, null)).toBe('better')
    expect(resolveNextTier('bogus', 'nonsense')).toBe('better')
  })
})

describe('paidPageTarget — /q/[token]/paid is a router, not a page', () => {
  it('paid with no slot → the booking page, to pick a time', () => {
    expect(paidPageTarget({ paid: true, scheduledAt: null })).toBe('book')
    expect(paidPageTarget({ paid: true, scheduledAt: undefined })).toBe('book')
  })

  it('paid with a slot → the thank-you page', () => {
    expect(paidPageTarget({ paid: true, scheduledAt: '2026-07-10T02:00:00Z' })).toBe('thanks')
  })

  it('not paid (webhook + session check both unresolved) → back to the quote', () => {
    expect(paidPageTarget({ paid: false, scheduledAt: null })).toBe('quote')
    expect(paidPageTarget({ paid: false, scheduledAt: '2026-07-10T02:00:00Z' })).toBe('quote')
  })
})

describe('bookingStateOnPaid', () => {
  it('slot chosen before paying → booked (confirmed)', () => {
    expect(bookingStateOnPaid('2026-05-20T03:00:00.000Z')).toBe(
      BOOKING_STATE.BOOKED,
    )
  })
  it('paid with no slot (legacy/no slots) → reserved (prompt to book)', () => {
    expect(bookingStateOnPaid(null)).toBe(BOOKING_STATE.RESERVED)
    expect(bookingStateOnPaid(undefined)).toBe(BOOKING_STATE.RESERVED)
  })
})

describe('shouldFinaliseBookingOnPaid', () => {
  it('finalises only when a slot was chosen pre-payment', () => {
    expect(shouldFinaliseBookingOnPaid('2026-05-20T03:00:00.000Z')).toBe(true)
    expect(shouldFinaliseBookingOnPaid(null)).toBe(false)
    expect(shouldFinaliseBookingOnPaid(undefined)).toBe(false)
  })
})

describe('resolveGoogleBookingUrl — off-platform link safety', () => {
  it('accepts a real https Google Appointment link', () => {
    expect(
      resolveGoogleBookingUrl('https://calendar.app.google/ispmShod4UYbCJ7r8'),
    ).toBe('https://calendar.app.google/ispmShod4UYbCJ7r8')
  })

  it('trims surrounding whitespace', () => {
    expect(
      resolveGoogleBookingUrl('  https://calendar.app.google/abc  '),
    ).toBe('https://calendar.app.google/abc')
  })

  it('returns null when unset / blank (option just does not render)', () => {
    expect(resolveGoogleBookingUrl(null)).toBeNull()
    expect(resolveGoogleBookingUrl(undefined)).toBeNull()
    expect(resolveGoogleBookingUrl('')).toBeNull()
    expect(resolveGoogleBookingUrl('   ')).toBeNull()
  })

  it('rejects non-https / non-URL values (never renders an unsafe link)', () => {
    expect(resolveGoogleBookingUrl('http://calendar.app.google/x')).toBeNull()
    expect(resolveGoogleBookingUrl('calendar.app.google/x')).toBeNull()
    expect(resolveGoogleBookingUrl('javascript:alert(1)')).toBeNull()
    expect(resolveGoogleBookingUrl('not a url')).toBeNull()
  })
})
