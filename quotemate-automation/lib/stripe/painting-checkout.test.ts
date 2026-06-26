import { describe, expect, it } from 'vitest'
import { DEFAULT_PAINTING_DEPOSIT_PCT, paintingDepositCents } from './painting-checkout'
import { buildPaintRedirectUrl, VALID_PAINT_TIERS } from '@/lib/painting/pay-redirect'

describe('paintingDepositCents', () => {
  it('computes the deposit in cents at the given pct', () => {
    expect(paintingDepositCents(5000, 30)).toBe(150000) // $5,000 × 30% = $1,500
    expect(paintingDepositCents(1234.5, 30)).toBe(Math.round(1234.5 * 100 * 0.3))
  })
  it('falls back to the default pct on a non-positive / NaN pct', () => {
    expect(paintingDepositCents(1000, 0)).toBe(Math.round(1000 * 100 * (DEFAULT_PAINTING_DEPOSIT_PCT / 100)))
    expect(paintingDepositCents(1000, Number.NaN)).toBe(30000)
  })
  it('returns 0 for a non-positive price', () => {
    expect(paintingDepositCents(0, 30)).toBe(0)
    expect(paintingDepositCents(-100, 30)).toBe(0)
  })
})

describe('buildPaintRedirectUrl', () => {
  it('redirects to the stored Stripe URL when unpaid', () => {
    expect(
      buildPaintRedirectUrl({ paid: false, token: 'tok', tier: 'better', stripeUrl: 'https://checkout.stripe.com/c/pay/cs_test_x', appUrl: 'https://x.test' }),
    ).toBe('https://checkout.stripe.com/c/pay/cs_test_x')
  })
  it('sends a paid customer back to the quote page (no re-charge)', () => {
    expect(
      buildPaintRedirectUrl({ paid: true, token: 'tok', tier: 'better', stripeUrl: 'https://checkout.stripe.com/c/pay/cs_test_x', appUrl: 'https://x.test' }),
    ).toBe('https://x.test/q/paint/tok?paid=1&tier=better')
  })
  it('returns null when there is no stored link (caller 404s)', () => {
    expect(buildPaintRedirectUrl({ paid: false, token: 'tok', tier: 'good', stripeUrl: null, appUrl: 'https://x.test' })).toBeNull()
  })
  it('knows the valid tiers', () => {
    expect(VALID_PAINT_TIERS.has('good')).toBe(true)
    expect(VALID_PAINT_TIERS.has('inspection')).toBe(false)
  })
})
