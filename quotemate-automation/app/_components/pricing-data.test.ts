import { describe, it, expect } from 'vitest'
import { aud, COMPARISON, hasFreeTrial, PLANS, PRICING_FAQ } from './pricing-data'

describe('hasFreeTrial — Starter Monthly only', () => {
  it('is true ONLY for starter + month', () => {
    expect(hasFreeTrial('starter', 'month')).toBe(true)
  })

  it('is false for every other plan/interval combination', () => {
    const plans = ['starter', 'pro', 'crew']
    const intervals = ['month', 'year']
    for (const plan of plans) {
      for (const interval of intervals) {
        const expected = plan === 'starter' && interval === 'month'
        expect(hasFreeTrial(plan, interval)).toBe(expected)
      }
    }
  })

  it('does not offer a trial on Starter Annual', () => {
    expect(hasFreeTrial('starter', 'year')).toBe(false)
  })

  it('does not offer a trial on Pro or Crew (either interval)', () => {
    expect(hasFreeTrial('pro', 'month')).toBe(false)
    expect(hasFreeTrial('pro', 'year')).toBe(false)
    expect(hasFreeTrial('crew', 'month')).toBe(false)
    expect(hasFreeTrial('crew', 'year')).toBe(false)
  })

  it('covers all three live plan ids', () => {
    expect(PLANS.map((p) => p.id).sort()).toEqual(['crew', 'pro', 'starter'])
  })
})

// A bare "$" reads as US dollars to anyone who isn't already sure the site is
// Australian. Every money figure the pricing surfaces render must carry the
// A$ prefix — the helper for plan prices, and the hand-written strings for
// the overage rates and the site-visit fee.
describe('AUD is explicit — never a bare $', () => {
  it('prefixes plan prices with A$', () => {
    expect(aud(49)).toBe('A$49')
    expect(aud(1290)).toBe('A$1,290')
  })

  const bareDollar = /(^|[^A])\$\d/

  it('has no bare $ figure in the comparison table', () => {
    for (const row of COMPARISON) {
      for (const v of row.values) expect(v).not.toMatch(bareDollar)
    }
  })

  it('has no bare $ figure in the pricing FAQ', () => {
    for (const item of PRICING_FAQ) {
      expect(item.q).not.toMatch(bareDollar)
      expect(item.a).not.toMatch(bareDollar)
    }
  })
})
