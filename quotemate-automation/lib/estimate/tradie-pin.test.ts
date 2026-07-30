import { describe, it, expect } from 'vitest'
import { applyChosenProduct, findHeadlineMaterialIndex, isTradiePin } from './catalogue'

// ════════════════════════════════════════════════════════════════════
// The dashboard job quoter's product pin. A tradie picking a catalogue product
// writes scope.chosen_product with pinned_by:'tradie', which routes through the
// SAME estimator code as a customer's mid-SMS pick — so the two behaviours have
// to be told apart deliberately.
// ════════════════════════════════════════════════════════════════════

describe('isTradiePin', () => {
  it('is true only for a tradie pin', () => {
    expect(isTradiePin({ pinned_by: 'tradie' })).toBe(true)
    // A customer's SMS pick carries no marker — it must keep the old collapse.
    expect(isTradiePin({ catalogue_id: 'x', name: 'y' } as never)).toBe(false)
    expect(isTradiePin({ pinned_by: 'customer' })).toBe(false)
    expect(isTradiePin(null)).toBe(false)
    expect(isTradiePin(undefined)).toBe(false)
  })
})

// The collapse decision as run.ts applies it. Extracted here as the exact
// expression from run.ts so the RULE is asserted; the spec called this out
// because it is the one edit in the change set that alters tier output for
// live SMS customers.
function tiersAfterCollapse(
  draft: Record<string, unknown>,
  chosen: { pinned_by?: unknown } | null,
  applied: string[],
): Record<string, unknown> {
  const tradiePinned = isTradiePin(chosen)
  const keep = applied.includes('good') ? 'good' : applied[0]
  if (draft[keep] && !tradiePinned) {
    for (const t of ['good', 'better', 'best']) if (t !== keep) draft[t] = null
    draft.selected_tier = keep
  }
  return draft
}

describe('the tier collapse', () => {
  const tiers = () => ({ good: { n: 1 }, better: { n: 2 }, best: { n: 3 } }) as Record<string, unknown>

  it("collapses for a CUSTOMER's SMS pick — they chose, so one option is honest", () => {
    const d = tiersAfterCollapse(tiers(), { catalogue_id: 'x' } as never, ['good', 'better', 'best'])
    expect(d.good).not.toBeNull()
    expect(d.better).toBeNull()
    expect(d.best).toBeNull()
    expect(d.selected_tier).toBe('good')
  })

  it('KEEPS the menu for a tradie pin', () => {
    // TierSelect renders nothing below two priced tiers, so collapsing here
    // would delete the only tier control on a quote held for tradie review.
    const d = tiersAfterCollapse(tiers(), { pinned_by: 'tradie' }, ['good', 'better', 'best'])
    expect(d.good).not.toBeNull()
    expect(d.better).not.toBeNull()
    expect(d.best).not.toBeNull()
    expect(d.selected_tier).toBeUndefined()
  })

  it('leaves the draft alone when nothing was applied', () => {
    const d = tiersAfterCollapse(tiers(), { catalogue_id: 'x' } as never, [])
    expect(d.better).not.toBeNull()
  })
})

describe('applyChosenProduct — which line gets rewritten', () => {
  const chosen = {
    catalogue_id: '11111111-1111-4111-8111-111111111111',
    name: 'Clipsal 2000 double GPO',
    price_ex_gst: 36,
    image_path: null,
    description: null,
    category: 'gpo',
    trade: 'electrical',
    pinned_by: 'tradie',
  }

  it('rewrites the line that already references the pinned row', () => {
    // The happy path: the estimator emitted the product, so the pin lands on it.
    const draft = {
      good: {
        line_items: [
          { description: 'TPS cable 2.5mm²', quantity: 10, unit: 'lm', unit_price_ex_gst: 6.4, source: 'material:7c2a4561-8b9d-4e1c-a3f4-b5d6e7f80250' },
          { description: 'Double GPO', quantity: 2, unit: 'each', unit_price_ex_gst: 30, source: 'material:11111111-1111-4111-8111-111111111111' },
          { description: 'Labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110, source: 'labour' },
        ],
        subtotal_ex_gst: 356,
      },
    }
    const r = applyChosenProduct(draft, chosen)
    expect(r.applied).toContain('good')
    const items = draft.good.line_items
    expect(items[1].unit_price_ex_gst).toBe(36)
    // The cable is untouched.
    expect(items[0].unit_price_ex_gst).toBe(6.4)
  })

  // ⚠ THE HAZARD, pinned deliberately rather than left as a surprise.
  // When the pinned product is NOT already in the tier, applyChosenProduct falls
  // back to findHeadlineMaterialIndex — the first line that is neither labour
  // nor a sundry. SUNDRY_RE is /sundr|seal|tape|\bclip\b|terminal|^fittings,/i,
  // which does NOT match "TPS cable" — so on a power_points tier the recipe's
  // cable line is the headline and gets rewritten into the GPO.
  //
  // The portal is more exposed than SMS here: the tradie's transcript names the
  // product in prose but not as a catalogue row, so the estimator may not emit
  // it and put the happy path above out of reach. Keeping the prose directive in
  // the transcript is what makes that unlikely; this test is what makes the
  // consequence visible if it happens.
  it('falls back to the first non-sundry line when the product is absent — including a cable line', () => {
    const draft = {
      good: {
        line_items: [
          { description: 'TPS cable 2.5mm² × 10m (longer run)', quantity: 10, unit: 'lm', unit_price_ex_gst: 6.4, source: 'material:7c2a4561-8b9d-4e1c-a3f4-b5d6e7f80250' },
          { description: 'Labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110, source: 'labour' },
        ],
        subtotal_ex_gst: 284,
      },
    }
    expect(findHeadlineMaterialIndex(draft.good.line_items)).toBe(0)
    const r = applyChosenProduct(draft, chosen)
    expect(r.applied).toContain('good')
    // The CABLE line is now the GPO. Documented, not endorsed.
    expect(draft.good.line_items[0].unit_price_ex_gst).toBe(36)
    expect(String(draft.good.line_items[0].description)).toContain('Clipsal')
  })

  it('leaves labour alone', () => {
    const draft = {
      good: {
        line_items: [{ description: 'Labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110, source: 'labour' }],
        subtotal_ex_gst: 220,
      },
    }
    expect(findHeadlineMaterialIndex(draft.good.line_items)).toBe(-1)
    const r = applyChosenProduct(draft, chosen)
    expect(r.applied).toEqual([])
    expect(draft.good.line_items[0].unit_price_ex_gst).toBe(110)
  })
})
