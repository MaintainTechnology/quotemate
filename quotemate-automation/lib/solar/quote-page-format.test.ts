// c:/Users/dalig/Downloads/QuoteMate/quoteMate/.claude/worktrees/solar-estimate/quotemate-automation/lib/solar/quote-page-format.test.ts
import { describe, expect, it } from 'vitest'
import {
  money,
  kwh,
  kw,
  paybackBand,
  pct,
  perKwh,
} from './quote-page-format'

describe('money', () => {
  it('formats a whole-dollar AUD figure with no decimals and thousands separators', () => {
    expect(money(18990)).toBe('18,990')
  })
  it('rounds to the nearest dollar', () => {
    expect(money(18990.6)).toBe('18,991')
  })
  it('returns 0 for null, undefined or non-finite input', () => {
    expect(money(null)).toBe('0')
    expect(money(undefined)).toBe('0')
    expect(money(Number.NaN)).toBe('0')
    expect(money(Number.POSITIVE_INFINITY)).toBe('0')
  })
})

describe('kwh', () => {
  it('formats annual production with thousands separators and no decimals', () => {
    expect(kwh(9540)).toBe('9,540')
  })
  it('returns 0 for non-finite input', () => {
    expect(kwh(Number.NaN)).toBe('0')
  })
})

describe('kw', () => {
  it('formats system size to one decimal place', () => {
    expect(kw(6.6)).toBe('6.6')
  })
  it('keeps a trailing .0 for whole kW values', () => {
    expect(kw(10)).toBe('10.0')
  })
  it('returns 0.0 for non-finite input', () => {
    expect(kw(Number.NaN)).toBe('0.0')
  })
})

describe('paybackBand', () => {
  it('renders a low–high range with one decimal and a yrs suffix', () => {
    expect(paybackBand(4.2, 6.8)).toBe('4.2–6.8 yrs')
  })
  it('collapses to a single figure when low equals high', () => {
    expect(paybackBand(5, 5)).toBe('5.0 yrs')
  })
  it('returns an em dash when either bound is non-finite', () => {
    expect(paybackBand(Number.NaN, 6)).toBe('—')
    expect(paybackBand(4, Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('pct', () => {
  it('formats a 0–1 fraction as a whole-number percentage', () => {
    expect(pct(0.4)).toBe('40%')
  })
  it('rounds to the nearest whole percent', () => {
    expect(pct(0.405)).toBe('41%')
  })
})

describe('perKwh', () => {
  it('formats a $/kWh rate to two decimals with a cent symbol view', () => {
    expect(perKwh(0.32)).toBe('$0.32/kWh')
  })
  it('pads a single-decimal rate to two places', () => {
    expect(perKwh(0.3)).toBe('$0.30/kWh')
  })
})
