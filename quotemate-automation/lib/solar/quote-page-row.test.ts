import { describe, expect, it } from 'vitest'
import { resolveSolarQuoteView } from './quote-page-row'
import type { SolarEstimate } from './types'

const estimate = {
  token: 'abc123def456',
  coverage_source: 'google',
  confidence_band: 'tight',
  routing: { decision: 'tradie_review', reason: 'Solar quote needs sign-off.' },
  sizing: {
    tiers: [
      { tier: 'good', system_kw_dc: 6.6, panels_count: 16 },
      { tier: 'better', system_kw_dc: 10, panels_count: 25 },
    ],
  },
} as unknown as SolarEstimate

describe('resolveSolarQuoteView', () => {
  it('hides prices and the CTA before confirmation', () => {
    const view = resolveSolarQuoteView({ estimate, confirmedAt: null })
    expect(view.confirmed).toBe(false)
    expect(view.showPrices).toBe(false)
    expect(view.inspectionRequired).toBe(false)
  })

  it('shows prices once confirmed and not routed to inspection', () => {
    const view = resolveSolarQuoteView({
      estimate,
      confirmedAt: '2026-06-08T04:00:00Z',
    })
    expect(view.confirmed).toBe(true)
    expect(view.showPrices).toBe(true)
  })

  it('never shows prices when routed to inspection, even confirmed', () => {
    const inspect = {
      ...estimate,
      routing: { decision: 'inspection_required', reason: 'Steep roof.' },
    } as unknown as SolarEstimate
    const view = resolveSolarQuoteView({
      estimate: inspect,
      confirmedAt: '2026-06-08T04:00:00Z',
    })
    expect(view.confirmed).toBe(true)
    expect(view.inspectionRequired).toBe(true)
    expect(view.showPrices).toBe(false)
  })

  it('exposes the headline tier as the largest sizing tier (last in order)', () => {
    const view = resolveSolarQuoteView({ estimate, confirmedAt: null })
    expect(view.headlineTier?.system_kw_dc).toBe(10)
    expect(view.headlineTier?.panels_count).toBe(25)
  })

  it('allows no headline tier when sizing produced no tiers', () => {
    const empty = {
      ...estimate,
      sizing: { tiers: [] },
    } as unknown as SolarEstimate
    const view = resolveSolarQuoteView({ estimate: empty, confirmedAt: null })
    expect(view.headlineTier).toBeNull()
  })
})
