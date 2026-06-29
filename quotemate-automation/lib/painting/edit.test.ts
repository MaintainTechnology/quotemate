// Painting — tradie quote-edit (applyTierEdits) tests.

import { describe, expect, it } from 'vitest'
import { applyTierEdits, resolveGstFactor, type PaintingTierEdit } from './edit'
import type { PaintingEstimate, PaintingPriceTier } from './types'

function tier(over: Partial<PaintingPriceTier> & Pick<PaintingPriceTier, 'tier'>): PaintingPriceTier {
  return {
    tier: over.tier,
    label: over.label ?? `${over.tier} label`,
    ex_gst: over.ex_gst ?? 1000,
    inc_gst: over.inc_gst ?? 1100,
    inc_gst_low: over.inc_gst_low ?? 990,
    inc_gst_high: over.inc_gst_high ?? 1210,
    scope: over.scope ?? `${over.tier} scope`,
  }
}

function estimate(): PaintingEstimate {
  return {
    provider: 'mock',
    facts: {} as PaintingEstimate['facts'],
    measurement: {} as PaintingEstimate['measurement'],
    warnings: [],
    price: {
      confidence: 'medium',
      total_area_m2: 200,
      tiers: [
        tier({ tier: 'good', inc_gst: 2200, ex_gst: 2000, inc_gst_low: 1980, inc_gst_high: 2420 }),
        tier({ tier: 'better', inc_gst: 3300, ex_gst: 3000, inc_gst_low: 2970, inc_gst_high: 3630 }),
        tier({ tier: 'best', inc_gst: 4400, ex_gst: 4000, inc_gst_low: 3960, inc_gst_high: 4840 }),
      ],
      loadings_applied: [],
      routing: { decision: 'tradie_review', reason: 'ok' },
      breakdown: { gst_factor: 1.1 } as PaintingEstimate['price']['breakdown'],
    },
  }
}

describe('resolveGstFactor', () => {
  it('prefers the breakdown factor', () => {
    expect(resolveGstFactor(estimate())).toBe(1.1)
  })
  it('recovers the factor from a tier when no breakdown', () => {
    const e = estimate()
    delete (e.price as { breakdown?: unknown }).breakdown
    expect(resolveGstFactor(e)).toBeCloseTo(1.1, 5)
  })
  it('defaults to 1.1 when nothing usable', () => {
    const e = estimate()
    delete (e.price as { breakdown?: unknown }).breakdown
    e.price.tiers = e.price.tiers.map((t) => ({ ...t, ex_gst: 0, inc_gst: 0 })) as typeof e.price.tiers
    expect(resolveGstFactor(e)).toBe(1.1)
  })
})

describe('applyTierEdits', () => {
  it('overrides the better-tier inc-GST and recomputes ex-GST + denorm headline', () => {
    const e = estimate()
    const res = applyTierEdits(e, [{ tier: 'better', inc_gst: 3500 }])
    expect(res.changed).toBe(true)
    const better = res.estimate.price.tiers.find((t) => t.tier === 'better')!
    expect(better.inc_gst).toBe(3500)
    expect(better.ex_gst).toBeCloseTo(3181.82, 1) // 3500 / 1.1
    expect(res.betterIncGst).toBe(3500)
    expect(res.estimate.price.manual_override).toBe(true)
  })

  it('scales the inc-GST band proportionally to the new headline', () => {
    const e = estimate()
    const res = applyTierEdits(e, [{ tier: 'better', inc_gst: 6600 }]) // 2× the 3300 headline
    const better = res.estimate.price.tiers.find((t) => t.tier === 'better')!
    expect(better.inc_gst_low).toBeCloseTo(5940, 0) // 2970 × 2
    expect(better.inc_gst_high).toBeCloseTo(7260, 0) // 3630 × 2
  })

  it('edits label and scope text', () => {
    const e = estimate()
    const res = applyTierEdits(e, [{ tier: 'good', label: 'Budget refresh', scope: '  One neat coat  ' }])
    const good = res.estimate.price.tiers.find((t) => t.tier === 'good')!
    expect(good.label).toBe('Budget refresh')
    expect(good.scope).toBe('One neat coat') // trimmed
    expect(res.changed).toBe(true)
  })

  it('does not mutate the input estimate', () => {
    const e = estimate()
    const before = JSON.parse(JSON.stringify(e))
    applyTierEdits(e, [{ tier: 'best', inc_gst: 9999 }])
    expect(e).toEqual(before)
  })

  it('reports no change for a no-op edit', () => {
    const e = estimate()
    const res = applyTierEdits(e, [{ tier: 'better', inc_gst: 3300 }]) // same value
    expect(res.changed).toBe(false)
    expect(res.estimate.price.manual_override).toBeUndefined()
  })

  it('ignores blank label/scope and untouched tiers', () => {
    const e = estimate()
    const edits: PaintingTierEdit[] = [{ tier: 'good', label: '   ' }]
    const res = applyTierEdits(e, edits)
    expect(res.changed).toBe(false)
  })

  it('applies several tier edits at once', () => {
    const e = estimate()
    const res = applyTierEdits(e, [
      { tier: 'good', inc_gst: 2000 },
      { tier: 'better', inc_gst: 3000, label: 'Standard' },
      { tier: 'best', inc_gst: 5000 },
    ])
    expect(res.changed).toBe(true)
    expect(res.priceChanged).toBe(true)
    expect(res.estimate.price.tiers.map((t) => t.inc_gst)).toEqual([2000, 3000, 5000])
    expect(res.estimate.price.tiers.find((t) => t.tier === 'better')!.label).toBe('Standard')
  })

  it('rejects a $0 or negative price override (no change, no $0 headline)', () => {
    const e = estimate()
    expect(applyTierEdits(e, [{ tier: 'better', inc_gst: 0 }]).changed).toBe(false)
    expect(applyTierEdits(e, [{ tier: 'better', inc_gst: -100 }]).changed).toBe(false)
    // The headline must never become 0.
    expect(applyTierEdits(e, [{ tier: 'better', inc_gst: 0 }]).betterIncGst).toBe(3300)
  })

  it('does not blank the scope on a whitespace-only edit', () => {
    const e = estimate()
    const res = applyTierEdits(e, [{ tier: 'good', scope: '   ' }])
    expect(res.changed).toBe(false)
    expect(res.estimate.price.tiers.find((t) => t.tier === 'good')!.scope).toBe('good scope')
  })

  it('flags priceChanged only when a price actually changed', () => {
    const e = estimate()
    expect(applyTierEdits(e, [{ tier: 'good', label: 'Budget' }]).priceChanged).toBe(false)
    expect(applyTierEdits(e, [{ tier: 'good', inc_gst: 2500 }]).priceChanged).toBe(true)
  })
})
