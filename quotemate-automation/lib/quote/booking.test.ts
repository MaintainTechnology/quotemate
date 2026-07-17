// Funnel-order regression coverage.
//
// Deposit tiers: BOOK FIRST, PAY LAST (WP6 reorder) — locks the order so a
// future change can't silently put payment back before booking.
// The $99 inspection: PAY FIRST, BOOK SECOND (spec
// customer-quote-five-sections R7, D1a — pay $99 → Stripe → booking page →
// thank-you), matching the dedicated trade surfaces.

import { describe, expect, it } from 'vitest'
import { BOOKING_STATE } from './hold'
import {
  bookingStateOnPaid,
  paidPageTarget,
  payRedirectTarget,
  resolveGoogleBookingUrl,
  resolveNextTier,
  shouldFinaliseBookingOnPaid,
} from './booking'

describe('payRedirectTarget — the flip', () => {
  it('not paid + no slot → book first (the whole point)', () => {
    expect(
      payRedirectTarget({ paid: false, scheduledAt: null, tier: 'better' }),
    ).toBe('book')
    expect(
      payRedirectTarget({ paid: false, scheduledAt: undefined, tier: 'good' }),
    ).toBe('book')
  })

  it('not paid + slot already chosen → Stripe (deposit is the last step)', () => {
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

  it('inspection $99 is PAY-FIRST — unpaid goes straight to Stripe (five-sections R7, D1a)', () => {
    expect(
      payRedirectTarget({ paid: false, scheduledAt: null, tier: 'inspection' }),
    ).toBe('stripe')
  })

  it('inspection with a slot somehow pre-chosen still pays first (never bounced to /book)', () => {
    expect(
      payRedirectTarget({
        paid: false,
        scheduledAt: '2026-05-20T03:00:00.000Z',
        tier: 'inspection',
      }),
    ).toBe('stripe')
  })

  it('deposit tiers stay BOOK-FIRST — the inspection flip must not leak (D1a scope)', () => {
    for (const tier of ['good', 'better', 'best']) {
      expect(payRedirectTarget({ paid: false, scheduledAt: null, tier })).toBe('book')
    }
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

describe('paidPageTarget — /q/[token]/paid routing after payment', () => {
  it('paid with no slot → send the customer straight to the booking page (Jon: auto-navigate)', () => {
    expect(paidPageTarget({ paid: true, scheduledAt: null })).toBe('book')
    expect(paidPageTarget({ paid: true, scheduledAt: undefined })).toBe('book')
  })

  it('paid with a slot → stay and show the booked confirmation', () => {
    expect(paidPageTarget({ paid: true, scheduledAt: '2026-07-10T02:00:00Z' })).toBe('stay')
  })

  it('not paid (webhook + session check both unresolved) → stay, never bounce', () => {
    expect(paidPageTarget({ paid: false, scheduledAt: null })).toBe('stay')
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
