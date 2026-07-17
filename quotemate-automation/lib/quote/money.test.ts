// The shared money module (spec customer-quote-five-sections R9) — the
// canonical order is discount-the-ex-GST-base → GST-if-registered → round
// once, in cents. Locks P1 (GST conditional), P2 (deposit % clamped, not
// hardcoded), and P4 (one discount order) at the source.

import { describe, expect, it } from 'vitest'
import {
  INSPECTION_FEE_AUD,
  INSPECTION_FEE_AUD_CENTS,
  clampDepositPct,
  depositCents,
  displayDeposit,
  displayIncGst,
  dollars,
  fmtAud,
  totalIncGstCents,
} from './money'

describe('totalIncGstCents — the canonical customer price', () => {
  it('applies 10% GST for a registered tradie (the default)', () => {
    expect(totalIncGstCents(1000)).toBe(110000)
    expect(totalIncGstCents('1000')).toBe(110000)
  })

  it('P1 — no GST for a non-registered tradie', () => {
    expect(totalIncGstCents(1000, { gstRegistered: false })).toBe(100000)
  })

  it('P4 — discounts the EX-GST base BEFORE the GST multiply, rounded once', () => {
    // 1000 ex · 10% off → 900 ex → 990 inc. (The old page path rounded to
    // inc-GST dollars first, then discounted — off-by-a-dollar on odd bases.)
    expect(totalIncGstCents(1000, { discountPct: 10 })).toBe(99000)
    // Odd base: 333.33 ex · 5% off → 316.6635 ex → 348.32985 inc → 34833c.
    expect(totalIncGstCents(333.33, { discountPct: 5 })).toBe(34833)
  })

  it('clamps the discount to the platform cap and ignores junk', () => {
    // 50% is over the 15% early-bird cap → clamped, not honoured.
    expect(totalIncGstCents(1000, { discountPct: 50 })).toBe(
      totalIncGstCents(1000, { discountPct: 15 }),
    )
    expect(totalIncGstCents(1000, { discountPct: null })).toBe(110000)
    expect(totalIncGstCents(1000, { discountPct: -5 })).toBe(110000)
  })

  it('junk ex-GST input is treated as zero, never NaN', () => {
    expect(totalIncGstCents('not a number')).toBe(0)
    expect(totalIncGstCents(undefined as unknown as number)).toBe(0)
  })
})

describe('deposits', () => {
  it('deposit is a % of the inc-GST cents, rounded to a cent', () => {
    expect(depositCents(110000, 30)).toBe(33000)
    expect(depositCents(110000, 0)).toBe(0)
    expect(depositCents(110000, null)).toBe(0)
  })

  it('displayDeposit — whole dollars of the same cents Stripe charges', () => {
    expect(displayDeposit(1000, 30)).toBe(330)
    expect(displayDeposit(1000, 30, { discountPct: 10 })).toBe(297)
    expect(displayDeposit(1000, null)).toBeNull()
  })

  it('P2 — clampDepositPct honours the quote value inside 1..90, else 30', () => {
    expect(clampDepositPct(20)).toBe(20)
    expect(clampDepositPct('45')).toBe(45)
    expect(clampDepositPct(0)).toBe(30)
    expect(clampDepositPct(91)).toBe(30)
    expect(clampDepositPct(null)).toBe(30)
    expect(clampDepositPct(undefined)).toBe(30)
  })
})

describe('display helpers', () => {
  it('dollars() and displayIncGst() are whole-dollar views of the cents', () => {
    expect(dollars(110000)).toBe(1100)
    expect(displayIncGst(1000)).toBe(1100)
    expect(displayIncGst(1000, { discountPct: 10 })).toBe(990)
    expect(displayIncGst(1000, { gstRegistered: false })).toBe(1000)
  })

  it('fmtAud — en-AU thousands, no decimals', () => {
    expect(fmtAud(22000)).toBe('22,000')
    expect(fmtAud(99)).toBe('99')
  })
})

describe('the $99 site-visit fee — single source of truth', () => {
  it('dollar and cent constants agree', () => {
    expect(INSPECTION_FEE_AUD).toBe(99)
    expect(INSPECTION_FEE_AUD_CENTS).toBe(9900)
    expect(INSPECTION_FEE_AUD_CENTS).toBe(INSPECTION_FEE_AUD * 100)
  })
})
