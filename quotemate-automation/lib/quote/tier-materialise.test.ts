// seedLineItems — opens a tier with no stored line_items (solar quotes-row
// tiers are {label, subtotal_ex_gst} only, lib/solar/persist-helpers.ts:84-95)
// as ONE seeded line whose total equals the tier subtotal, so the dashboard
// editor isn't empty and Save passes the edit route's min-1-line schema while
// round-tripping the engine's subtotal unchanged (the route recomputes
// subtotal from lines — app/api/quote/[id]/edit/route.ts:281-283).

import { describe, expect, it } from 'vitest'
import { seedLineItems } from './tier-materialise'

describe('seedLineItems', () => {
  it('a line-item-less tier with a subtotal seeds one line equalling that subtotal', () => {
    const lines = seedLineItems({ label: 'Solar system', subtotal_ex_gst: 12000 })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      quantity: 1,
      unit_price_ex_gst: 12000,
    })
    // Satisfies the edit route's LineItemSchema: non-empty description,
    // quantity ≥ 0, price ≥ 0 — and qty × price round-trips the subtotal.
    expect(lines[0].description.trim().length).toBeGreaterThan(0)
    expect(lines[0].quantity * lines[0].unit_price_ex_gst).toBe(12000)
  })

  it('uses the tier label in the seeded description', () => {
    expect(seedLineItems({ label: 'Best — premium panels', subtotal_ex_gst: 500 })[0].description).toContain(
      'Best — premium panels',
    )
  })

  it('returns stored line_items untouched when present', () => {
    const stored = [{ description: 'Downlights ×6', quantity: 6, unit_price_ex_gst: 90 }]
    expect(seedLineItems({ label: 'Good', subtotal_ex_gst: 540, line_items: stored })).toBe(stored)
  })

  it('never seeds without a positive finite subtotal', () => {
    expect(seedLineItems({ label: 'Good' })).toEqual([])
    expect(seedLineItems({ label: 'Good', subtotal_ex_gst: 0 })).toEqual([])
    expect(seedLineItems({ label: 'Good', subtotal_ex_gst: Number.NaN })).toEqual([])
    expect(seedLineItems({ label: 'Good', subtotal_ex_gst: 12000, line_items: [] })).toHaveLength(1)
  })
})
