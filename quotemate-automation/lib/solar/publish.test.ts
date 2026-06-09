import { describe, it, expect } from 'vitest'
import { solarPayRedirectTarget } from './publish'

describe('solarPayRedirectTarget', () => {
  const base = {
    confirmedAt: '2026-06-08T02:00:00Z',
    paid: false,
    scheduledAt: null as string | null,
    tier: 'better',
  }

  it('blocks the deposit until the tradie confirms (no auto-send)', () => {
    expect(solarPayRedirectTarget({ ...base, confirmedAt: null })).toBe('locked')
  })

  it('routes confirmed-but-unbooked to book-first', () => {
    expect(solarPayRedirectTarget(base)).toBe('book')
  })

  it('routes confirmed + booked + unpaid straight to Stripe (deposit last)', () => {
    expect(
      solarPayRedirectTarget({ ...base, scheduledAt: '2026-07-01T03:00:00Z' }),
    ).toBe('stripe')
  })

  it('routes an already-paid customer to the thank-you page', () => {
    expect(solarPayRedirectTarget({ ...base, paid: true })).toBe('paid')
  })

  it('keeps the inspection fee pay-first even when unconfirmed', () => {
    expect(
      solarPayRedirectTarget({ ...base, confirmedAt: null, tier: 'inspection' }),
    ).toBe('stripe')
  })
})
