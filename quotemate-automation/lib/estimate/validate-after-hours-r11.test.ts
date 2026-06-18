// R11 (2026-06-18, validator half) — after_hours_multiplier TYPE + VALUE
// validation in validateQuoteGrounding.
//
// The after-hours accept branches are the ONLY place the validator signs
// off on a labour/callout price ABOVE the standard rate. Pre-R11 the
// multiplier was only checked for `Number.isFinite && > 0`, and `n()`
// blindly parseFloat()s its input. So a forged/garbage multiplier (a wrong
// type, an absurd value, or a ≤1 non-surcharge) could establish an
// arbitrarily inflated "accepted" after-hours rate that an after-hours
// tagged line would then pass against.
//
// R11 hardening: the multiplier must be a finite number strictly > 1 and
// ≤ AFTER_HOURS_MAX_MULTIPLIER (3). Anything else leaves the after-hours
// accept branch dormant, so the inflated price falls through to a normal
// grounding failure. A legitimately tagged after-hours line at
// hourly × (valid multiplier) still grounds.

import { describe, expect, it } from 'vitest'
import {
  validateQuoteGrounding,
  buildCandidatePrices,
  type PricingBookForValidation,
} from './validate'

const baseBook: PricingBookForValidation = {
  hourly_rate: 100,
  apprentice_rate: 70,
  call_out_minimum: 150,
  default_markup_pct: 28,
  min_labour_hours: 3,
}
const noCandidates = buildCandidatePrices([], [], baseBook)

function tier(lines: any[]) {
  return { needs_inspection: false, good: { line_items: lines }, better: null, best: null }
}

const calloutLine = { description: 'Call-out', quantity: 1, unit: 'each', unit_price_ex_gst: 150, source: 'callout' }

describe('R11: legitimate multiplier still grounds a tagged after-hours line', () => {
  it('ACCEPTS labour at hourly × 1.5 with a valid multiplier', () => {
    const r = validateQuoteGrounding(
      tier([
        calloutLine,
        { description: 'After-hours diagnostic', quantity: 3, unit: 'hr', unit_price_ex_gst: 150, source: 'after_hours' }, // 100 × 1.5
      ]),
      { ...baseBook, after_hours_multiplier: 1.5 },
      noCandidates,
    )
    expect(r.valid).toBe(true)
  })

  it('ACCEPTS labour at hourly × 2 (cap boundary band) with a valid multiplier', () => {
    const r = validateQuoteGrounding(
      tier([
        calloutLine,
        { description: 'After-hours labour', quantity: 3, unit: 'hr', unit_price_ex_gst: 200, source: 'after_hours' }, // 100 × 2
      ]),
      { ...baseBook, after_hours_multiplier: 2 },
      noCandidates,
    )
    expect(r.valid).toBe(true)
  })

  it('ACCEPTS a call-out at call_out_minimum × multiplier when tagged', () => {
    const r = validateQuoteGrounding(
      tier([
        { description: 'After-hours call-out', quantity: 1, unit: 'each', unit_price_ex_gst: 300, source: 'after_hours_callout' }, // 150 × 2
        { description: 'After-hours labour', quantity: 3, unit: 'hr', unit_price_ex_gst: 200, source: 'after_hours' },
      ]),
      { ...baseBook, after_hours_multiplier: 2 },
      noCandidates,
    )
    expect(r.valid).toBe(true)
  })
})

describe('R11: forged / garbage multiplier cannot establish an inflated accepted rate', () => {
  it('REJECTS an inflated rate when the multiplier is a non-numeric string', () => {
    // Forged tag: multiplier is "lots". The after-hours branch must stay
    // dormant; $1000/hr is not a valid standard rate either → fails.
    const r = validateQuoteGrounding(
      tier([
        calloutLine,
        { description: 'After-hours labour', quantity: 3, unit: 'hr', unit_price_ex_gst: 1000, source: 'after_hours' },
      ]),
      { ...baseBook, after_hours_multiplier: 'lots' as unknown as number },
      noCandidates,
    )
    expect(r.valid).toBe(false)
  })

  it('REJECTS an inflated rate when the multiplier is absurd (× 50, above the cap)', () => {
    // 100 × 50 = 5000. Pre-R11 this would derive an accepted $5000/hr rate.
    const r = validateQuoteGrounding(
      tier([
        calloutLine,
        { description: 'After-hours labour', quantity: 3, unit: 'hr', unit_price_ex_gst: 5000, source: 'after_hours' },
      ]),
      { ...baseBook, after_hours_multiplier: 50 },
      noCandidates,
    )
    expect(r.valid).toBe(false)
  })

  it('REJECTS an inflated rate when the multiplier is Infinity', () => {
    const r = validateQuoteGrounding(
      tier([
        calloutLine,
        { description: 'After-hours labour', quantity: 3, unit: 'hr', unit_price_ex_gst: 999, source: 'after_hours' },
      ]),
      { ...baseBook, after_hours_multiplier: Infinity as unknown as number },
      noCandidates,
    )
    expect(r.valid).toBe(false)
  })

  it('REJECTS a ≤1 multiplier being used to ground an UNDER-rate line under an after-hours tag', () => {
    // multiplier 0.5 would derive a $50/hr "after-hours" rate (below cost).
    // A ≤1 value is not a surcharge → branch dormant → $50 fails grounding.
    const r = validateQuoteGrounding(
      tier([
        calloutLine,
        { description: 'After-hours labour', quantity: 3, unit: 'hr', unit_price_ex_gst: 50, source: 'after_hours' },
      ]),
      { ...baseBook, after_hours_multiplier: 0.5 },
      noCandidates,
    )
    expect(r.valid).toBe(false)
  })

  it('REJECTS an inflated rate just above the cap (× 3.5)', () => {
    const r = validateQuoteGrounding(
      tier([
        calloutLine,
        { description: 'After-hours labour', quantity: 3, unit: 'hr', unit_price_ex_gst: 350, source: 'after_hours' }, // 100 × 3.5
      ]),
      { ...baseBook, after_hours_multiplier: 3.5 },
      noCandidates,
    )
    expect(r.valid).toBe(false)
  })

  // R11 nit (2026-06-18) — cap lowered 3 → 2.5 to match the documented AU
  // after-hours ceiling. ×2.5 is the new accepted boundary; anything above it
  // (e.g. ×2.6, previously allowed under the ×3 cap) is now rejected.
  it('ACCEPTS labour at exactly the new ×2.5 ceiling', () => {
    const r = validateQuoteGrounding(
      tier([
        calloutLine,
        { description: 'After-hours labour', quantity: 3, unit: 'hr', unit_price_ex_gst: 250, source: 'after_hours' }, // 100 × 2.5
      ]),
      { ...baseBook, after_hours_multiplier: 2.5 },
      noCandidates,
    )
    expect(r.valid).toBe(true)
  })

  it('REJECTS a ×2.6 multiplier (above the new 2.5 ceiling, was allowed under the old ×3 cap)', () => {
    const r = validateQuoteGrounding(
      tier([
        calloutLine,
        { description: 'After-hours labour', quantity: 3, unit: 'hr', unit_price_ex_gst: 260, source: 'after_hours' }, // 100 × 2.6
      ]),
      { ...baseBook, after_hours_multiplier: 2.6 },
      noCandidates,
    )
    expect(r.valid).toBe(false)
  })
})

describe('R11: forged TAG (no multiplier configured) still cannot inflate', () => {
  it('REJECTS an after-hours-tagged inflated rate when no multiplier is set', () => {
    const r = validateQuoteGrounding(
      tier([
        calloutLine,
        { description: 'After-hours labour', quantity: 3, unit: 'hr', unit_price_ex_gst: 200, source: 'after_hours' },
      ]),
      { ...baseBook, after_hours_multiplier: null },
      noCandidates,
    )
    expect(r.valid).toBe(false)
  })

  it('REJECTS the inflated rate on a plain labour line even WITH a valid multiplier (tag required)', () => {
    // Valid × 2 multiplier configured, but the line is NOT tagged
    // after-hours. The inflated $200 rate must still fail (C-2 invariant).
    const r = validateQuoteGrounding(
      tier([
        calloutLine,
        { description: 'Install labour', quantity: 3, unit: 'hr', unit_price_ex_gst: 200, source: 'labour' },
      ]),
      { ...baseBook, after_hours_multiplier: 2 },
      noCandidates,
    )
    expect(r.valid).toBe(false)
  })
})
