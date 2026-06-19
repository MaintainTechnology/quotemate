import { describe, it, expect } from 'vitest'
import { carriedPricedTiers, forceInspectionTiers } from './inspection-normalize'

describe('carriedPricedTiers (R3)', () => {
  it('detects any priced tier', () => {
    expect(carriedPricedTiers({ good: { line_items: [] } })).toBe(true)
    expect(carriedPricedTiers({ better: {} })).toBe(true)
    expect(carriedPricedTiers({ best: { x: 1 } })).toBe(true)
  })
  it('false when all tiers null/absent', () => {
    expect(carriedPricedTiers({ good: null, better: null, best: null })).toBe(false)
    expect(carriedPricedTiers({})).toBe(false)
    expect(carriedPricedTiers(null)).toBe(false)
  })
})

describe('forceInspectionTiers (R3/R7)', () => {
  it('nulls all tiers and stamps pricing_path=inspection', () => {
    const d: Record<string, unknown> = {
      good: { line_items: [{ p: 1 }] },
      better: { line_items: [] },
      best: { line_items: [] },
      scope_of_works: 'keep me',
      needs_inspection: true,
    }
    const out = forceInspectionTiers(d)
    expect(out.good).toBeNull()
    expect(out.better).toBeNull()
    expect(out.best).toBeNull()
    expect(out.pricing_path).toBe('inspection')
    // non-tier fields are preserved
    expect(out.scope_of_works).toBe('keep me')
    expect(out.needs_inspection).toBe(true)
  })

  it('a model that self-declares inspection cannot ship a priced tier', () => {
    // the exact attack: needs_inspection=true but tiers populated
    const malicious: Record<string, unknown> = { needs_inspection: true, good: { line_items: [{ price: 9999 }] } }
    expect(carriedPricedTiers(malicious)).toBe(true)
    const out = forceInspectionTiers(malicious)
    expect(out.good).toBeNull()
    expect(carriedPricedTiers(out)).toBe(false)
  })
})
