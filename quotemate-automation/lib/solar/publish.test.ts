import { describe, it, expect } from 'vitest'
import { canShowPrices } from './publish'

describe('canShowPrices', () => {
  it('hides prices until the tradie has confirmed (no auto-send)', () => {
    const r = canShowPrices({ confirmedAt: null, guardrailFlags: [], configStale: false })
    expect(r.showPrices).toBe(false)
    expect(r.reason).toMatch(/estimated the system size and output/i)
    expect(r.reason).toMatch(/review the price/i)
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

// solarPayRedirectTarget's suite was removed 2026-07-22 with the function and
// app/r/solar/[token]/[tier] — see the note in publish.ts. The behaviour it
// covered is still tested, in the two places that actually run in production:
//   • the tradie-confirmation gate → lib/solar/deposit-cta.test.ts
//   • the pay-first funnel order   → lib/quote/booking.test.ts
