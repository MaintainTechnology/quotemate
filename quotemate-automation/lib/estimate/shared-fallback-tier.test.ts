// Phase 4 R4 — the shared fallback must honour the tier it was asked for.
//
// `chooseMaterial` takes a `tier`, uses it to score TENANT rows, and then
// ignores it completely on the shared path: `pick = brandHit ?? shared[0]`
// takes whichever row came back first. So a tenant with an empty catalogue
// gets the SAME shared product at the SAME price for Good, Better and Best —
// three identical tiers, which then read as one option to the customer.
//
// This is live: DETERMINISTIC_BOM is ON in production.
//
// The rule: price-sort ascending, then index by tier. Good is the cheapest,
// Best the dearest, Better in between. An explicit brand match still wins,
// because that is a stated request rather than an inferred preference.

import { describe, it, expect } from 'vitest'
import { chooseMaterial } from './catalogue'

const shared = [
  { name: 'Budget downlight', category: 'downlight', default_unit_price_ex_gst: 18 },
  { name: 'Mid downlight', category: 'downlight', default_unit_price_ex_gst: 34 },
  { name: 'Premium downlight', category: 'downlight', default_unit_price_ex_gst: 62 },
]
const pick = (tier?: 'good' | 'better' | 'best', brand?: string) =>
  chooseMaterial({ tenantRows: [], sharedRows: shared, category: 'downlight', tier, brand })

describe('Phase 4 R4 — shared fallback honours the tier', () => {
  it('good takes the cheapest', () => {
    expect(pick('good')?.row.name).toBe('Budget downlight')
  })

  it('best takes the dearest', () => {
    expect(pick('best')?.row.name).toBe('Premium downlight')
  })

  it('better sits in between', () => {
    expect(pick('better')?.row.name).toBe('Mid downlight')
  })

  it('THE BUG: the three tiers must not all return the same product', () => {
    const names = (['good', 'better', 'best'] as const).map((t) => pick(t)?.row.name)
    expect(new Set(names).size, `all tiers returned ${names[0]}`).toBe(3)
  })

  it('prices ascend across the tiers', () => {
    const p = (['good', 'better', 'best'] as const).map((t) => pick(t)?.price ?? 0)
    expect(p[0]).toBeLessThan(p[1])
    expect(p[1]).toBeLessThan(p[2])
  })
})

describe('Phase 4 R4 — what must NOT change', () => {
  it('an explicit brand match still wins over the tier index', () => {
    const withBrand = [
      { name: 'Budget', category: 'downlight', default_unit_price_ex_gst: 18 },
      { name: 'Clipsal unit', category: 'downlight', brand: 'Clipsal', default_unit_price_ex_gst: 55 },
    ]
    const r = chooseMaterial({
      tenantRows: [], sharedRows: withBrand, category: 'downlight',
      tier: 'good', brand: 'Clipsal',
    })
    expect(r?.row.name, 'a stated brand beats an inferred tier').toBe('Clipsal unit')
  })

  it('no tier behaves exactly as before — first matching row', () => {
    expect(pick(undefined)?.row.name).toBe('Budget downlight')
  })

  it('a single candidate serves every tier rather than returning null', () => {
    const one = [{ name: 'Only one', category: 'downlight', default_unit_price_ex_gst: 25 }]
    for (const t of ['good', 'better', 'best'] as const) {
      const r = chooseMaterial({ tenantRows: [], sharedRows: one, category: 'downlight', tier: t })
      expect(r?.row.name, t).toBe('Only one')
    }
  })

  it('two candidates still spread rather than collapsing', () => {
    const two = [
      { name: 'Cheap', category: 'downlight', default_unit_price_ex_gst: 20 },
      { name: 'Dear', category: 'downlight', default_unit_price_ex_gst: 60 },
    ]
    const p = (t: 'good' | 'better' | 'best') =>
      chooseMaterial({ tenantRows: [], sharedRows: two, category: 'downlight', tier: t })?.row.name
    expect(p('good')).toBe('Cheap')
    expect(p('best')).toBe('Dear')
  })

  it('a tenant row still beats every shared row', () => {
    const r = chooseMaterial({
      tenantRows: [{ category: 'downlight', name: 'Tenant own', unit_price_ex_gst: 99 }],
      sharedRows: shared, category: 'downlight', tier: 'good',
    })
    expect(r?.source).toBe('tenant')
  })

  it('returns null when nothing matches the category', () => {
    expect(chooseMaterial({ tenantRows: [], sharedRows: shared, category: 'gpo', tier: 'good' })).toBeNull()
  })
})
