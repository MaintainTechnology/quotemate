import { describe, it, expect } from 'vitest'
import { resolvePayRedirect, VALID_TIERS } from './route'

const APP = 'https://www.quotemax.com.au'
const token = 'tok_demo_123456'

/** Every call needs a slot count now — pay-first must not charge into an empty
 *  calendar. Default to "windows exist" so each test states only what it tests. */
const SLOTS_OPEN = 6

describe('VALID_TIERS', () => {
  it('accepts good/better/best/inspection only', () => {
    expect([...VALID_TIERS].sort()).toEqual(
      ['best', 'better', 'good', 'inspection'].sort(),
    )
  })
})

describe('resolvePayRedirect', () => {
  it('expired + unpaid priced tier → bounce to the quote page (blocked)', () => {
    const d = resolvePayRedirect({
      tier: 'better',
      paid: false,
      scheduledAt: '2026-07-10T00:00:00.000Z',
      expired: true,
      token,
      appUrl: APP,
      bookableCount: SLOTS_OPEN,
    })
    expect(d).toEqual({ kind: 'expired', url: `${APP}/q/${token}` })
  })

  it('unpaid inspection → Stripe, pay-first (five-sections R7, D1a) — expiry never blocks it', () => {
    // The $99 IS the product: pay → pick a time → thank-you, matching the
    // dedicated trade surfaces. No price hold applies to the flat fee.
    const d = resolvePayRedirect({
      tier: 'inspection',
      paid: false,
      scheduledAt: null,
      expired: true,
      token,
      appUrl: APP,
      bookableCount: SLOTS_OPEN,
    })
    expect(d.kind).toBe('stripe')
  })

  it('inspection with a slot already held still pays first', () => {
    const d = resolvePayRedirect({
      tier: 'inspection',
      paid: false,
      scheduledAt: '2026-05-20T03:00:00.000Z',
      expired: true,
      token,
      appUrl: APP,
      bookableCount: SLOTS_OPEN,
    })
    expect(d.kind).toBe('stripe')
  })

  it('PAID inspection → thank-you page, never a fresh $99 Session (double-charge guard)', () => {
    // /r mints a fresh payable Session per click; if a paid inspection ever
    // reached the stripe branch again, every re-click of the old SMS link
    // would charge another $99.
    const d = resolvePayRedirect({
      tier: 'inspection',
      paid: true,
      scheduledAt: null,
      expired: false,
      token,
      appUrl: APP,
      bookableCount: SLOTS_OPEN,
    })
    expect(d).toEqual({
      kind: 'paid',
      url: `${APP}/q/${token}/paid?tier=inspection&already=1`,
    })
  })

  it('expired does NOT block an already-paid quote', () => {
    const d = resolvePayRedirect({
      tier: 'good',
      paid: true,
      scheduledAt: '2026-07-10T00:00:00.000Z',
      expired: true,
      token,
      appUrl: APP,
      bookableCount: SLOTS_OPEN,
    })
    expect(d).toEqual({ kind: 'paid', url: `${APP}/q/${token}/paid?tier=good&already=1` })
  })

  it('not expired, unpaid, no slot → Stripe (pay-first, 2026-07-22)', () => {
    const d = resolvePayRedirect({
      tier: 'better',
      paid: false,
      scheduledAt: null,
      expired: false,
      token,
      appUrl: APP,
      bookableCount: SLOTS_OPEN,
    })
    expect(d).toEqual({ kind: 'stripe' })
  })

  it('not expired, unpaid, slot chosen → stripe (caller mints a fresh session)', () => {
    const d = resolvePayRedirect({
      tier: 'best',
      paid: false,
      scheduledAt: '2026-07-10T00:00:00.000Z',
      expired: false,
      token,
      appUrl: APP,
      bookableCount: SLOTS_OPEN,
    })
    expect(d.kind).toBe('stripe')
  })

  it('paid → thank-you page', () => {
    const d = resolvePayRedirect({
      tier: 'good',
      paid: true,
      scheduledAt: null,
      expired: false,
      token,
      appUrl: APP,
      bookableCount: SLOTS_OPEN,
    })
    expect(d).toEqual({ kind: 'paid', url: `${APP}/q/${token}/paid?tier=good&already=1` })
  })
})

describe('resolvePayRedirect — no-slots guard', () => {
  // Pay-first means the customer commits BEFORE seeing any times. A tenant with
  // zero published windows must not be charged: they would have paid for a
  // visit nobody can schedule. This also removes the old /r → /book → /r
  // redirect loop, where NoSlotsPayState's CTA pointed straight back here.
  const base = {
    paid: false,
    scheduledAt: null,
    expired: false,
    token,
    appUrl: APP,
    bookableCount: 0,
  }

  it('blocks the charge and returns to the quote when no windows are published', () => {
    expect(resolvePayRedirect({ ...base, tier: 'better' })).toEqual({
      kind: 'no-slots',
      url: `${APP}/q/${token}?slots=0`,
    })
  })

  it('blocks the $99 site visit too — same trap', () => {
    expect(resolvePayRedirect({ ...base, tier: 'inspection' })).toEqual({
      kind: 'no-slots',
      url: `${APP}/q/${token}?slots=0`,
    })
  })

  it('lets the charge through as soon as one window exists', () => {
    expect(resolvePayRedirect({ ...base, tier: 'better', bookableCount: 1 })).toEqual({
      kind: 'stripe',
    })
  })

  it('never blocks an already-paid quote — it is not being charged again', () => {
    expect(resolvePayRedirect({ ...base, tier: 'better', paid: true })).toEqual({
      kind: 'paid',
      url: `${APP}/q/${token}/paid?tier=better&already=1`,
    })
  })

  it('expiry still wins over the slots guard', () => {
    expect(resolvePayRedirect({ ...base, tier: 'better', expired: true })).toEqual({
      kind: 'expired',
      url: `${APP}/q/${token}`,
    })
  })
})
