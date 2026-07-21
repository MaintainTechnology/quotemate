import { describe, it, expect } from 'vitest'
import { resolvePaidAmount, formatPaidAmount } from './paid-amount'

describe('resolvePaidAmount', () => {
  it('prefers the recorded Stripe amount over anything inferred', () => {
    expect(
      resolvePaidAmount({ paidAmountCents: 9900, paidTier: 'inspection', totalIncGst: 22000 }),
    ).toBe(99)
  })

  it('reads the recorded figure as CENTS, not dollars', () => {
    expect(
      resolvePaidAmount({ paidAmountCents: 660000, paidTier: 'better', totalIncGst: null }),
    ).toBe(6600)
  })

  it('falls back to the flat inspection fee for a legacy row with no amount', () => {
    // Pre-migration-181 roofing/painting rows recorded paid_tier only.
    expect(
      resolvePaidAmount({ paidAmountCents: null, paidTier: 'inspection', totalIncGst: 22000 }),
    ).toBe(99)
  })

  it('falls back to the quote total for a legacy deposit row', () => {
    expect(
      resolvePaidAmount({ paidAmountCents: null, paidTier: 'better', totalIncGst: 22000 }),
    ).toBe(22000)
  })

  it('returns null when nothing is known rather than inventing a figure', () => {
    expect(
      resolvePaidAmount({ paidAmountCents: null, paidTier: null, totalIncGst: null }),
    ).toBeNull()
    expect(
      resolvePaidAmount({ paidAmountCents: undefined, paidTier: undefined, totalIncGst: undefined }),
    ).toBeNull()
  })

  it('ignores a zero, negative or non-numeric recorded amount', () => {
    expect(
      resolvePaidAmount({ paidAmountCents: 0, paidTier: 'inspection', totalIncGst: null }),
    ).toBe(99)
    expect(
      resolvePaidAmount({ paidAmountCents: -5, paidTier: 'inspection', totalIncGst: null }),
    ).toBe(99)
    expect(
      resolvePaidAmount({ paidAmountCents: Number.NaN, paidTier: 'inspection', totalIncGst: null }),
    ).toBe(99)
  })

  it('never shows the tier total for an inspection payment', () => {
    // The five-sections live check caught exactly this: a $99 site-visit
    // payment rendered "Paid $22,000.00" because the card read total_inc_gst.
    expect(
      resolvePaidAmount({ paidAmountCents: null, paidTier: 'inspection', totalIncGst: 22000 }),
    ).not.toBe(22000)
  })

  it('ignores a zero or negative quote total', () => {
    expect(
      resolvePaidAmount({ paidAmountCents: null, paidTier: 'better', totalIncGst: 0 }),
    ).toBeNull()
  })
})

describe('formatPaidAmount', () => {
  it('formats AU currency with two decimals', () => {
    expect(formatPaidAmount(99)).toBe('$99.00')
    expect(formatPaidAmount(22000)).toBe('$22,000.00')
    expect(formatPaidAmount(6600.5)).toBe('$6,600.50')
  })

  it('returns null for null so the caller can omit the row', () => {
    expect(formatPaidAmount(null)).toBeNull()
  })
})
