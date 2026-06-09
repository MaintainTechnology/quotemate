import { describe, it, expect } from 'vitest'
import { canShowPrices } from './publish'

describe('canShowPrices', () => {
  it('hides prices until the tradie has confirmed (no auto-send)', () => {
    const r = canShowPrices({ confirmedAt: null, guardrailFlags: [], configStale: false })
    expect(r.showPrices).toBe(false)
    expect(r.reason).toMatch(/installer will confirm/i)
  })

  it('shows prices once confirmed, clean, and config is fresh', () => {
    const r = canShowPrices({
      confirmedAt: '2026-06-08T02:00:00Z',
      guardrailFlags: [],
      configStale: false,
    })
    expect(r.showPrices).toBe(true)
    expect(r.reason).toBeNull()
  })

  it('blocks publish when guardrail flags exist, even after confirmation', () => {
    const r = canShowPrices({
      confirmedAt: '2026-06-08T02:00:00Z',
      guardrailFlags: ['better: net price ($1.00) does not equal gross − STC ...'],
      configStale: false,
    })
    expect(r.showPrices).toBe(false)
    expect(r.reason).toMatch(/checks/i)
  })

  it('blocks publish when the solar config is stale, even after confirmation', () => {
    const r = canShowPrices({
      confirmedAt: '2026-06-08T02:00:00Z',
      guardrailFlags: [],
      configStale: true,
    })
    expect(r.showPrices).toBe(false)
    expect(r.reason).toMatch(/pricing data is being refreshed/i)
  })
})

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
