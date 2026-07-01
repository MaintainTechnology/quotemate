import { describe, it, expect } from 'vitest'
import { buildSolarRedirectUrl, VALID_SOLAR_TIERS } from './route'

const APP = 'https://www.quotemax.com.au'

describe('VALID_SOLAR_TIERS', () => {
  it('accepts good/better/best/inspection only', () => {
    expect([...VALID_SOLAR_TIERS].sort()).toEqual(
      ['best', 'better', 'good', 'inspection'].sort(),
    )
  })
})

describe('buildSolarRedirectUrl', () => {
  const token = 'tok_demo_123456'

  it('locked → back to the price-hidden quote page', () => {
    const url = buildSolarRedirectUrl({
      target: 'locked',
      token,
      tier: 'better',
      stripeUrl: null,
      appUrl: APP,
    })
    expect(url).toBe(`${APP}/q/solar/${token}?locked=1`)
  })

  it('book → the solar slot picker for that tier', () => {
    const url = buildSolarRedirectUrl({
      target: 'book',
      token,
      tier: 'better',
      stripeUrl: null,
      appUrl: APP,
    })
    expect(url).toBe(`${APP}/q/solar/${token}/book?tier=better`)
  })

  it('paid → the thank-you page for that tier', () => {
    const url = buildSolarRedirectUrl({
      target: 'paid',
      token,
      tier: 'best',
      stripeUrl: null,
      appUrl: APP,
    })
    expect(url).toBe(`${APP}/q/solar/${token}/paid?tier=best&already=1`)
  })

  it('stripe → the stored Stripe checkout URL', () => {
    const url = buildSolarRedirectUrl({
      target: 'stripe',
      token,
      tier: 'good',
      stripeUrl: 'https://checkout.stripe.com/c/pay/cs_test_abc',
      appUrl: APP,
    })
    expect(url).toBe('https://checkout.stripe.com/c/pay/cs_test_abc')
  })

  it('stripe with no stored link → null (caller 404s)', () => {
    const url = buildSolarRedirectUrl({
      target: 'stripe',
      token,
      tier: 'good',
      stripeUrl: null,
      appUrl: APP,
    })
    expect(url).toBeNull()
  })
})
