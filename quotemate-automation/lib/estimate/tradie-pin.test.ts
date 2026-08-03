import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
    // A customer's SMS pick carries no marker. Since Phase 4 R5 that no
    // longer means "always collapse" — it collapses only on the Opus
    // fallback, where R3's anchor never ran. isTradiePin itself is still
    // load-bearing: run.ts uses it to open the WP9 gate without the flag,
    // to keep the tier menu on a held quote, and to skip the main-path
    // spec guard.
    expect(isTradiePin({ catalogue_id: 'x', name: 'y' } as never)).toBe(false)
    expect(isTradiePin({ pinned_by: 'customer' })).toBe(false)
    expect(isTradiePin(null)).toBe(false)
    expect(isTradiePin(undefined)).toBe(false)
  })
})

// ⚠ THIS HELPER IS A MIRROR OF run.ts, AND A MIRROR CANNOT FAIL ON ITS OWN.
//
// The previous version hand-copied the collapse expression and asserted
// against the copy. When Phase 4 R5 changed the real rule in run.ts, all
// three tests below kept passing — they were still asserting the OLD rule
// against a duplicate of the old rule, reporting green for behaviour
// production no longer had. That is worse than no test.
//
// So the mirror stays (it is the readable way to express the rule) but it is
// now pinned by source assertions on run.ts underneath, which DO fail when
// the real expression changes. Keep the two in step.
function tiersAfterCollapse(
  draft: Record<string, unknown>,
  chosen: { pinned_by?: unknown } | null,
  applied: string[],
  opts: { anchored?: boolean } = {},
): Record<string, unknown> {
  const tradiePinned = isTradiePin(chosen)
  const keep = applied.includes('good') ? 'good' : applied[0]
  if (applied.length > 0) {
    // R5 — the deterministic builder anchors the pick into ONE tier
    // (Phase 4 R3), so the three tiers genuinely differ and there is
    // nothing to hide. Only the Opus fallback still collapses.
    if (draft[keep] && !tradiePinned && !opts.anchored) {
      for (const t of ['good', 'better', 'best']) if (t !== keep) draft[t] = null
    }
    // Set on BOTH paths: quote_tier_mode defaults to 'single', so without
    // it a customer who picked the cheap option is shown the dearer tier.
    if (draft[keep]) draft.selected_tier = keep
  }
  return draft
}

describe('the tier collapse', () => {
  const tiers = () => ({ good: { n: 1 }, better: { n: 2 }, best: { n: 3 } }) as Record<string, unknown>
  const customer = { catalogue_id: 'x' } as never

  it('R5 — an ANCHORED quote keeps all three tiers', () => {
    // The behaviour this phase exists to deliver. R3 gave each tier its own
    // product, so collapsing would now throw away a real choice.
    const d = tiersAfterCollapse(tiers(), customer, ['good', 'better', 'best'], { anchored: true })
    expect(d.good).not.toBeNull()
    expect(d.better).not.toBeNull()
    expect(d.best).not.toBeNull()
  })

  it('R5 — the Opus fallback STILL collapses', () => {
    // R3 never ran, so applyChosenProduct wrote the same product, price and
    // label into all three. Three identical tiers read as a bug.
    const d = tiersAfterCollapse(tiers(), customer, ['good', 'better', 'best'], { anchored: false })
    expect(d.good).not.toBeNull()
    expect(d.better).toBeNull()
    expect(d.best).toBeNull()
  })

  it('selected_tier is set on BOTH paths — the silent price rise guard', () => {
    // quote_tier_mode defaults to 'single'. Leaving selected_tier unset lets
    // draft/route.ts fall through to `better → good → best`, showing a
    // customer who picked the cheap option the dearer tier.
    for (const anchored of [true, false]) {
      const d = tiersAfterCollapse(tiers(), customer, ['good', 'better', 'best'], { anchored })
      expect(d.selected_tier, `anchored=${anchored}`).toBe('good')
    }
  })

  it('KEEPS the menu for a tradie pin, on either path', () => {
    // TierSelect renders nothing below two priced tiers, so collapsing here
    // would delete the only tier control on a quote held for tradie review.
    for (const anchored of [true, false]) {
      const d = tiersAfterCollapse(tiers(), { pinned_by: 'tradie' }, ['good', 'better', 'best'], { anchored })
      expect(d.good, `anchored=${anchored}`).not.toBeNull()
      expect(d.better, `anchored=${anchored}`).not.toBeNull()
      expect(d.best, `anchored=${anchored}`).not.toBeNull()
    }
  })

  it('leaves the draft alone when nothing was applied', () => {
    const d = tiersAfterCollapse(tiers(), customer, [])
    expect(d.better).not.toBeNull()
    expect(d.selected_tier).toBeUndefined()
  })
})

describe('the mirror above matches the real rule in run.ts', () => {
  // These are what make the mirror honest. Without them the helper is a
  // duplicate asserting itself, which is exactly how the pre-R5 version of
  // this file went green against behaviour that no longer existed.
  const runTs = readFileSync(resolve(process.cwd(), 'lib', 'estimate', 'run.ts'), 'utf8')
  const block = runTs.slice(
    runTs.indexOf('if (r.applied.length > 0)'),
    runTs.indexOf('WP9 chosen-product apply failed'),
  )

  it('the block exists', () => {
    expect(block.length, 'the chosen-product apply block moved or went').toBeGreaterThan(200)
  })

  it('derives `anchored` from the deterministic pricing path', () => {
    expect(block).toMatch(/const anchored\s*=\s*draft\?\.pricing_path === 'deterministic'/)
  })

  it('guards the tier nulling on !anchored as well as !tradiePinned', () => {
    expect(block).toMatch(/if \(draft\[keep\] && !tradiePinned && !anchored\)/)
  })

  it('sets selected_tier OUTSIDE that guard, so both paths get it', () => {
    // The ordering matters: if this moved back inside the guard, an
    // anchored quote would lose selected_tier and show the wrong tier.
    const nulling = block.indexOf('!tradiePinned && !anchored')
    const setSel = block.indexOf('draft.selected_tier = keep')
    expect(setSel).toBeGreaterThan(nulling)
    expect(block).toMatch(/if \(draft\[keep\]\) draft\.selected_tier = keep/)
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
