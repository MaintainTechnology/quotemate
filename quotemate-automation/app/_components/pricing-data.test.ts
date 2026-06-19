import { describe, it, expect } from 'vitest'
import { hasFreeTrial, PLANS } from './pricing-data'

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
