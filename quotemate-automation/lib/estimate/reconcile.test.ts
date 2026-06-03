import { describe, expect, it } from 'vitest'
import {
  reconcileTierMath,
  checkQuantityVsItemCount,
  collapseDuplicateTiers,
  reconcileInflatedLabour,
} from './reconcile'
import { findHeadlineMaterialIndex } from './catalogue'

function tier(line_items: any[], subtotal?: number) {
  return { line_items, subtotal_ex_gst: subtotal, label: 'x' }
}

describe('reconcileTierMath', () => {
  it('fixes a wrong line total and a wrong subtotal from the grounded unit prices', () => {
    const draft: any = {
      good: tier(
        [
          { description: 'LED downlight', unit: 'each', quantity: 6, unit_price_ex_gst: 20.48, total_ex_gst: 99 },
          { description: 'Labour', unit: 'hr', quantity: 3, unit_price_ex_gst: 110, total_ex_gst: 330 },
        ],
        999,
      ),
    }
    const { corrections } = reconcileTierMath(draft)
    expect(draft.good.line_items[0].total_ex_gst).toBe(122.88)
    expect(draft.good.line_items[1].total_ex_gst).toBe(330)
    expect(draft.good.subtotal_ex_gst).toBe(452.88)
    expect(corrections.length).toBeGreaterThan(0)
  })

  it('is a no-op when the maths is already correct', () => {
    const draft: any = {
      better: tier([{ description: 'GPO', unit: 'each', quantity: 2, unit_price_ex_gst: 35, total_ex_gst: 70 }], 70),
    }
    const { corrections } = reconcileTierMath(draft)
    expect(corrections).toHaveLength(0)
    expect(draft.better.subtotal_ex_gst).toBe(70)
  })

  it('leaves a line with non-finite numbers untouched (never fabricates a price)', () => {
    const draft: any = {
      good: tier([{ description: 'Mystery', unit: 'each', quantity: null, unit_price_ex_gst: undefined, total_ex_gst: 50 }], 50),
    }
    reconcileTierMath(draft)
    expect(draft.good.line_items[0].total_ex_gst).toBe(50)
    expect(draft.good.subtotal_ex_gst).toBe(50)
  })

  it('skips null tiers (inspection-style draft)', () => {
    const draft: any = { good: null, better: null, best: null }
    const { corrections } = reconcileTierMath(draft)
    expect(corrections).toHaveLength(0)
  })
})

describe('checkQuantityVsItemCount', () => {
  it('flags a headline each-line whose quantity disagrees with item_count, without changing it', () => {
    const draft: any = {
      good: tier([
        { description: 'LED downlight', unit: 'each', quantity: 4, unit_price_ex_gst: 20, total_ex_gst: 80, source: 'material' },
        { description: 'Labour', unit: 'hr', quantity: 3, unit_price_ex_gst: 110, total_ex_gst: 330, source: 'labour' },
      ]),
    }
    const flags = checkQuantityVsItemCount(draft, 6)
    expect(flags).toHaveLength(1)
    expect(flags[0]).toContain('quantity 4')
    expect(flags[0]).toContain('item_count 6')
    expect(draft.good.line_items[0].quantity).toBe(4) // unchanged
  })

  it('is silent when the headline quantity matches item_count', () => {
    const draft: any = { good: tier([{ description: 'GPO', unit: 'each', quantity: 6, unit_price_ex_gst: 30, source: 'material' }]) }
    expect(checkQuantityVsItemCount(draft, 6)).toHaveLength(0)
  })

  it('is silent when item_count is absent or non-positive', () => {
    const draft: any = { good: tier([{ description: 'GPO', unit: 'each', quantity: 6, unit_price_ex_gst: 30, source: 'material' }]) }
    expect(checkQuantityVsItemCount(draft, undefined)).toHaveLength(0)
    expect(checkQuantityVsItemCount(draft, 0)).toHaveLength(0)
  })
})

describe('collapseDuplicateTiers', () => {
  const line = (d: string, q: number, p: number) => ({
    description: d, unit: 'each', quantity: q, unit_price_ex_gst: p, total_ex_gst: q * p, source: 'material',
  })

  it('collapses three identical tiers to one and re-points selected_tier off a nulled tier', () => {
    const items = () => [line('LED downlight', 6, 20)]
    const draft: any = {
      good: tier(items(), 120),
      better: tier(items(), 120),
      best: tier(items(), 120),
      selected_tier: 'best',
    }
    const { collapsed } = collapseDuplicateTiers(draft)
    expect(collapsed.sort()).toEqual(['best', 'better'])
    expect(draft.good).not.toBeNull()
    expect(draft.better).toBeNull()
    expect(draft.best).toBeNull()
    expect(draft.selected_tier).toBe('good')
  })

  it('leaves genuinely-different tiers untouched', () => {
    const draft: any = {
      good: tier([line('Budget downlight', 6, 16)], 96),
      better: tier([line('Mid downlight', 6, 28)], 168),
      best: tier([line('Premium downlight', 6, 55)], 330),
    }
    const { collapsed } = collapseDuplicateTiers(draft)
    expect(collapsed).toHaveLength(0)
    expect(draft.good).not.toBeNull()
    expect(draft.better).not.toBeNull()
    expect(draft.best).not.toBeNull()
  })
})

describe('findHeadlineMaterialIndex', () => {
  it('prefers a non-sundry material line, falls back to any non-labour line, else -1', () => {
    expect(
      findHeadlineMaterialIndex([
        { description: 'Sundries & fixings', source: 'material' },
        { description: 'LED downlight', source: 'material' },
        { description: 'Labour', source: 'labour' },
      ]),
    ).toBe(1)
    expect(
      findHeadlineMaterialIndex([
        { description: 'Cable clip', source: 'material' },
        { description: 'Labour', source: 'labour' },
      ]),
    ).toBe(0)
    expect(findHeadlineMaterialIndex([{ description: 'Labour', source: 'labour' }])).toBe(-1)
    expect(findHeadlineMaterialIndex(null)).toBe(-1)
  })
})

describe('reconcileInflatedLabour', () => {
  const BOOK = { itemCount: 6, minLabourHours: 3.0, hourlyRate: 118 }

  it('fixes the real downlight picker quote (6 hr install → 2.4, total labour back on the 3.0 floor)', () => {
    // The exact shape observed live: install line billed 6 hr (= item_count)
    // plus a 0.6 hr "minimum job allowance" top-up, + the chosen material.
    const draft: any = {
      good: tier(
        [
          { description: 'Replace existing downlight (Replace LED downlight assembly)', unit: 'hr', quantity: 6, unit_price_ex_gst: 118, total_ex_gst: 708, source: 'labour' },
          { description: 'Site visit + setup time (minimum job allowance)', unit: 'hr', quantity: 0.6, unit_price_ex_gst: 118, total_ex_gst: 70.8, source: 'labour' },
          { description: 'Brilliant Halo 90 9W LED downlight', unit: 'each', quantity: 6, unit_price_ex_gst: 19.5, total_ex_gst: 117, source: 'material:abc' },
        ],
        895.8,
      ),
    }
    const { corrections } = reconcileInflatedLabour(draft, BOOK)
    expect(corrections).toHaveLength(1)
    expect(draft.good.line_items[0].quantity).toBe(2.4)
    expect(draft.good.line_items[0].total_ex_gst).toBe(283.2)
    // total labour now exactly the floor: 2.4 + 0.6 = 3.0 hr
    const labourHrs = draft.good.line_items.filter((l: any) => l.unit === 'hr').reduce((s: number, l: any) => s + l.quantity, 0)
    expect(labourHrs).toBeCloseTo(3.0, 5)
    // subtotal drops by the over-billed 3.6 hr × $118 = $424.80 → 471.00
    expect(draft.good.subtotal_ex_gst).toBe(471)
  })

  it('fixes the real smoke-alarm picker quote (4 hr → 2.0, allowance 1.0 → floor)', () => {
    const draft: any = {
      good: tier(
        [
          { description: 'Install kit (Hardwire 240V smoke alarm assembly)', unit: 'hr', quantity: 4, unit_price_ex_gst: 118, total_ex_gst: 472, source: 'assembly:c26' },
          { description: 'Site visit + setup time (minimum job allowance)', unit: 'hr', quantity: 1, unit_price_ex_gst: 118, total_ex_gst: 118, source: 'labour' },
          { description: 'Brooks 9V photoelectric smoke alarm', unit: 'each', quantity: 4, unit_price_ex_gst: 32, total_ex_gst: 128, source: 'material:aab' },
        ],
        718,
      ),
    }
    const { corrections } = reconcileInflatedLabour(draft, { itemCount: 4, minLabourHours: 3.0, hourlyRate: 118 })
    expect(corrections).toHaveLength(1)
    expect(draft.good.line_items[0].quantity).toBe(2)
    expect(draft.good.subtotal_ex_gst).toBe(482) // 236 + 118 + 128
  })

  it('is a no-op for the single-unit fan quote (install 1 hr is already correct)', () => {
    // 1 fan: install 1 hr + 2 hr allowance = 3.0 floor. item_count=1 ⇒ guard skips.
    const draft: any = {
      good: tier(
        [
          { description: 'Install kit (Supply + install AC ceiling fan assembly)', unit: 'hr', quantity: 1, unit_price_ex_gst: 118, total_ex_gst: 118, source: 'assembly:6fb' },
          { description: 'Site visit + setup time (minimum job allowance)', unit: 'hr', quantity: 2, unit_price_ex_gst: 118, total_ex_gst: 236, source: 'labour' },
          { description: 'Brilliant Tempest 48" fan', unit: 'each', quantity: 1, unit_price_ex_gst: 178, total_ex_gst: 178, source: 'material:988' },
        ],
        532,
      ),
    }
    const { corrections } = reconcileInflatedLabour(draft, { itemCount: 1, minLabourHours: 3.0, hourlyRate: 118 })
    expect(corrections).toHaveLength(0)
    expect(draft.good.subtotal_ex_gst).toBe(532)
  })

  it('is a no-op on the correct standard-quote path (single labour line, no allowance)', () => {
    // 8 downlights: labour 3.2 hr (=8×0.4), no allowance line ⇒ nothing to undo.
    const draft: any = {
      good: tier(
        [
          { description: 'Replace existing downlight', unit: 'each', quantity: 8, unit_price_ex_gst: 38.08, total_ex_gst: 304.64, source: 'assembly:915' },
          { description: 'Labour — remove, terminate, test each downlight', unit: 'hr', quantity: 3.2, unit_price_ex_gst: 118, total_ex_gst: 377.6, source: 'labour' },
        ],
        682.24,
      ),
    }
    const { corrections } = reconcileInflatedLabour(draft, { itemCount: 8, minLabourHours: 3.0, hourlyRate: 118 })
    expect(corrections).toHaveLength(0)
    expect(draft.good.subtotal_ex_gst).toBe(682.24)
  })

  it('does not fire when total labour is already at/below the floor', () => {
    // install 2 hr + allowance 1 hr = 3.0 floor exactly — no excess to remove.
    const draft: any = {
      good: tier(
        [
          { description: 'Install', unit: 'hr', quantity: 2, unit_price_ex_gst: 118, total_ex_gst: 236, source: 'labour' },
          { description: 'minimum job allowance', unit: 'hr', quantity: 1, unit_price_ex_gst: 118, total_ex_gst: 118, source: 'labour' },
        ],
        354,
      ),
    }
    // item_count=2 matches install qty, but no excess over floor ⇒ skip.
    const { corrections } = reconcileInflatedLabour(draft, { itemCount: 2, minLabourHours: 3.0, hourlyRate: 118 })
    expect(corrections).toHaveLength(0)
  })

  it('skips when there is an extra (risk) labour line — too ambiguous to reduce safely', () => {
    const draft: any = {
      good: tier(
        [
          { description: 'Install', unit: 'hr', quantity: 6, unit_price_ex_gst: 118, total_ex_gst: 708, source: 'labour' },
          { description: 'Risk allowance — restricted access', unit: 'hr', quantity: 0.5, unit_price_ex_gst: 118, total_ex_gst: 59, source: 'labour' },
          { description: 'Site visit + setup time (minimum job allowance)', unit: 'hr', quantity: 0.6, unit_price_ex_gst: 118, total_ex_gst: 70.8, source: 'labour' },
        ],
        837.8,
      ),
    }
    const { corrections } = reconcileInflatedLabour(draft, BOOK) // 3 hr lines ⇒ no-op
    expect(corrections).toHaveLength(0)
  })

  it('never increases a charge: skips when the install line is below item_count', () => {
    const draft: any = {
      good: tier(
        [
          { description: 'Install', unit: 'hr', quantity: 2, unit_price_ex_gst: 118, total_ex_gst: 236, source: 'labour' },
          { description: 'minimum job allowance', unit: 'hr', quantity: 0.6, unit_price_ex_gst: 118, total_ex_gst: 70.8, source: 'labour' },
        ],
        306.8,
      ),
    }
    // install (2) ≠ item_count (6) ⇒ not the bug signature ⇒ untouched.
    const { corrections } = reconcileInflatedLabour(draft, BOOK)
    expect(corrections).toHaveLength(0)
    expect(draft.good.line_items[0].quantity).toBe(2)
  })

  it('degrades to no-op without item_count / rate / floor', () => {
    const mk = () => ({
      good: tier([
        { description: 'Install', unit: 'hr', quantity: 6, unit_price_ex_gst: 118, total_ex_gst: 708, source: 'labour' },
        { description: 'minimum job allowance', unit: 'hr', quantity: 0.6, unit_price_ex_gst: 118, total_ex_gst: 70.8, source: 'labour' },
      ], 778.8),
    })
    expect(reconcileInflatedLabour(mk(), { itemCount: null, minLabourHours: 3, hourlyRate: 118 }).corrections).toHaveLength(0)
    expect(reconcileInflatedLabour(mk(), { itemCount: 6, minLabourHours: null, hourlyRate: 118 }).corrections).toHaveLength(0)
    expect(reconcileInflatedLabour(mk(), { itemCount: 6, minLabourHours: 3, hourlyRate: null }).corrections).toHaveLength(0)
  })
})
