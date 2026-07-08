import { describe, it, expect } from 'vitest'
import { resolvePayRedirect, VALID_TIERS } from './route'

const APP = 'https://www.quotemax.com.au'
const token = 'tok_demo_123456'

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
    })
    expect(d).toEqual({ kind: 'expired', url: `${APP}/q/${token}` })
  })

  it('expired does NOT block the inspection fee (no price hold on it)', () => {
    // Since 2026-07-08 the $99 inspection is book-first like every tier
    // (Jon's workflow: pick a time, THEN pay), so with no slot chosen the
    // un-blocked destination is the booking page, not Stripe.
    const d = resolvePayRedirect({
      tier: 'inspection',
      paid: false,
      scheduledAt: null,
      expired: true,
      token,
      appUrl: APP,
    })
    expect(d).toEqual({ kind: 'book', url: `${APP}/q/${token}/book?tier=inspection` })
  })

  it('inspection with a slot already held → Stripe even when expired ($99 is the last step)', () => {
    const d = resolvePayRedirect({
      tier: 'inspection',
      paid: false,
      scheduledAt: '2026-05-20T03:00:00.000Z',
      expired: true,
      token,
      appUrl: APP,
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
    })
    expect(d).toEqual({ kind: 'paid', url: `${APP}/q/${token}/paid?tier=good&already=1` })
  })

  it('not expired, unpaid, no slot → book first', () => {
    const d = resolvePayRedirect({
      tier: 'better',
      paid: false,
      scheduledAt: null,
      expired: false,
      token,
      appUrl: APP,
    })
    expect(d).toEqual({ kind: 'book', url: `${APP}/q/${token}/book?tier=better` })
  })

  it('not expired, unpaid, slot chosen → stripe (caller mints a fresh session)', () => {
    const d = resolvePayRedirect({
      tier: 'best',
      paid: false,
      scheduledAt: '2026-07-10T00:00:00.000Z',
      expired: false,
      token,
      appUrl: APP,
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
    })
    expect(d).toEqual({ kind: 'paid', url: `${APP}/q/${token}/paid?tier=good&already=1` })
  })
})
