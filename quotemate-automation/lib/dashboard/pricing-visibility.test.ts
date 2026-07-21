// Which pricing cards a trade hub's PRICING tab surfaces.
//
// The reported bug: a newly-created roofing account showed an hourly-labour
// "Pricing Book" card ($/hr) while an existing account showed the per-m² Roof
// Rates card — even though roofing (like painting/signage/aircon) prices from a
// rate card and its pricing_book.hourly_rate is INERT. Self-serve onboarding
// seeds a pricing_book row per trade, so the stray row surfaced as an
// authoritative $/hr book. These guards lock the rule that rate-card trades
// never show the hourly book, so the PRICING tab is identical for every account.

import { describe, expect, it } from 'vitest'
import { NO_BOOK_HUB_TRADES, showsHourlyPricingBook } from './pricing-visibility'

describe('showsHourlyPricingBook', () => {
  it('hides the hourly labour book for roofing (prices per-m²)', () => {
    expect(showsHourlyPricingBook('roofing')).toBe(false)
  })

  it('hides the hourly labour book for painting/signage/aircon', () => {
    expect(showsHourlyPricingBook('painting')).toBe(false)
    expect(showsHourlyPricingBook('signage')).toBe(false)
    expect(showsHourlyPricingBook('aircon')).toBe(false)
  })

  it('shows the hourly labour book for electrical and plumbing (they price by $/hr)', () => {
    expect(showsHourlyPricingBook('electrical')).toBe(true)
    expect(showsHourlyPricingBook('plumbing')).toBe(true)
  })

  it('shows hourly books on the General pricing tab (no trade filter)', () => {
    expect(showsHourlyPricingBook(undefined)).toBe(true)
    expect(showsHourlyPricingBook(null)).toBe(true)
  })

  it('is case-insensitive (tenants.trades may carry mixed casing)', () => {
    expect(showsHourlyPricingBook('Roofing')).toBe(false)
    expect(showsHourlyPricingBook('ROOFING')).toBe(false)
  })

  it('every NO_BOOK_HUB trade is hidden — no rate-card trade leaks an hourly book', () => {
    for (const t of NO_BOOK_HUB_TRADES) {
      expect(showsHourlyPricingBook(t)).toBe(false)
    }
  })
})
