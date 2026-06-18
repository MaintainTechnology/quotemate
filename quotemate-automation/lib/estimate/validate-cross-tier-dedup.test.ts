// R6 (2026-06-18) — CROSS-TIER duplicate prevention.
//
// Good / Better / Best are presented as mutually-exclusive options; the
// customer picks ONE and pays for it. So the same catalogue row appearing
// across tiers is normal tier progression — EXCEPT when it appears at
// DIFFERENT quantities with no scope_of_works/assumptions framing the
// change, which is how an unexplained cross-tier over/double-charge hides.
//
// detectCrossTierDuplicates() runs across all three tiers and returns the
// offending anchors. validateQuoteGrounding wires it in so cross-tier dupes
// surface as grounding failures (→ inspection downgrade).
//
// Policy under test:
//   - same row, SAME quantity in 2+ tiers      → allowed (no flag)
//   - same row, DIFFERENT quantities, FRAMED   → allowed (no flag)
//   - same row, DIFFERENT quantities, UNFRAMED → flagged
//   - DIFFERENT rows per tier (basic vs premium HWS) → never collide

import { describe, expect, it } from 'vitest'
import {
  validateQuoteGrounding,
  detectCrossTierDuplicates,
  buildCandidatePrices,
  type PricingBookForValidation,
} from './validate'

const pricingBook: PricingBookForValidation = {
  hourly_rate: 110,
  apprentice_rate: 80,
  call_out_minimum: 150,
  default_markup_pct: 28,
  min_labour_hours: 2,
}

const candidates = buildCandidatePrices(
  [
    { id: 'mat-downlight', name: 'Brilliant 9W LED downlight', price: 20, category: 'downlight' },
    { id: 'mat-basic-hws', name: 'Aquamax 250L basic HWS', price: 1200, category: 'hot_water' },
    { id: 'mat-premium-hws', name: 'Rheem 5-star premium HWS', price: 1900, category: 'hot_water' },
  ],
  [],
  pricingBook,
)

const labour = (hours: number) => ({
  description: 'Electrician labour',
  quantity: hours,
  unit: 'hr',
  unit_price_ex_gst: 110,
  source: 'labour',
})

// downlight line at the configured 28% markup ($20 × 1.28 = $25.60).
const downlightLine = (qty: number) => ({
  description: 'Brilliant 9W LED downlight',
  quantity: qty,
  unit: 'each',
  unit_price_ex_gst: 25.6,
  source: 'material:mat-downlight',
})

describe('R6: detectCrossTierDuplicates — UNFRAMED quantity difference', () => {
  it('flags the same downlight row at 3 / 6 / 9 across tiers with no framing', () => {
    const draft = {
      needs_inspection: false,
      // No scope_of_works / assumptions explaining the count change.
      good: { label: 'Good', line_items: [labour(2), downlightLine(3)] },
      better: { label: 'Better', line_items: [labour(2), downlightLine(6)] },
      best: { label: 'Best', line_items: [labour(2), downlightLine(9)] },
    }
    const dups = detectCrossTierDuplicates(draft, candidates)
    expect(dups.length).toBe(1)
    expect(dups[0].anchor).toBe('material:mat-downlight')
    expect(dups[0].sameQuantity).toBe(false)
    expect(dups[0].occurrences.length).toBe(3)

    // And it surfaces as a grounding failure → quote would downgrade.
    const r = validateQuoteGrounding(draft, pricingBook, candidates)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.failures.some((f) => f.expected.includes('cross-tier duplicate'))).toBe(true)
    }
  })
})

describe('R6: ALLOWED — framed quantity difference', () => {
  it('does NOT flag 3 vs 6 downlights when scope_of_works frames it', () => {
    const draft = {
      needs_inspection: false,
      scope_of_works:
        'Install Brilliant 9W LED downlight units: Good covers 3 downlights in the kitchen; ' +
        'Best extends to 6 downlights across the kitchen and hallway.',
      good: { label: 'Good', line_items: [labour(2), downlightLine(3)] },
      better: null,
      best: { label: 'Best', line_items: [labour(2), downlightLine(6)] },
    }
    const dups = detectCrossTierDuplicates(draft, candidates)
    expect(dups.length).toBe(0)

    const r = validateQuoteGrounding(draft, pricingBook, candidates)
    expect(r.valid).toBe(true)
  })

  it('honours framing carried in assumptions[] instead of scope_of_works', () => {
    const draft = {
      needs_inspection: false,
      assumptions: [
        'Good = 3 Brilliant 9W LED downlight units; Best = 6 downlight units.',
      ],
      good: { label: 'Good', line_items: [labour(2), downlightLine(3)] },
      better: null,
      best: { label: 'Best', line_items: [labour(2), downlightLine(6)] },
    }
    const dups = detectCrossTierDuplicates(draft, candidates)
    expect(dups.length).toBe(0)
  })
})

describe('R6: ALLOWED — customer-PROSE framing (category + quantity signal, no verbatim SKU)', () => {
  // R6 false-positive fix: real quotes frame the quantity difference in
  // customer prose that mentions the product CATEGORY ("downlights") and a
  // quantity signal, WITHOUT repeating the verbatim catalogue SKU name
  // "Brilliant 9W LED downlight". These framings must now PASS.

  it('passes when prose mentions the category + two bare quantities (no SKU string)', () => {
    const draft = {
      needs_inspection: false,
      scope_of_works:
        '3 downlights in the lounge for the standard option, 6 in the best option.',
      good: { label: 'Good', line_items: [labour(2), downlightLine(3)] },
      better: null,
      best: { label: 'Best', line_items: [labour(2), downlightLine(6)] },
    }
    // Sanity: the framing does NOT contain the verbatim SKU name.
    expect(draft.scope_of_works.toLowerCase()).not.toContain('brilliant 9w led downlight')
    const dups = detectCrossTierDuplicates(draft, candidates)
    expect(dups.length).toBe(0)
    const r = validateQuoteGrounding(draft, pricingBook, candidates)
    expect(r.valid).toBe(true)
  })

  it('passes when prose uses an "extends to" upgrade phrase + category mention', () => {
    const draft = {
      needs_inspection: false,
      scope_of_works:
        'Standard covers the lounge downlights; the premium option extends to additional downlights through the hallway.',
      good: { label: 'Good', line_items: [labour(2), downlightLine(3)] },
      better: null,
      best: { label: 'Best', line_items: [labour(2), downlightLine(6)] },
    }
    expect(draft.scope_of_works.toLowerCase()).not.toContain('brilliant 9w led downlight')
    const dups = detectCrossTierDuplicates(draft, candidates)
    expect(dups.length).toBe(0)
  })

  it('passes when prose uses an "N vs M" comparison + category mention', () => {
    const draft = {
      needs_inspection: false,
      assumptions: ['Downlight count steps up across tiers: 3 vs 6.'],
      good: { label: 'Good', line_items: [labour(2), downlightLine(3)] },
      better: null,
      best: { label: 'Best', line_items: [labour(2), downlightLine(6)] },
    }
    const dups = detectCrossTierDuplicates(draft, candidates)
    expect(dups.length).toBe(0)
  })
})

describe('R6: STILL FLAGGED — unframed silent stack (no item mention OR no quantity signal)', () => {
  it('flags a category mention with NO quantity signal at all', () => {
    // Framing names the category but gives no quantity difference cue — this
    // is not real framing of WHY the count changes, so it must still flag.
    const draft = {
      needs_inspection: false,
      scope_of_works: 'Downlights will be installed to a high standard throughout.',
      good: { label: 'Good', line_items: [labour(2), downlightLine(3)] },
      better: null,
      best: { label: 'Best', line_items: [labour(2), downlightLine(6)] },
    }
    const dups = detectCrossTierDuplicates(draft, candidates)
    expect(dups.length).toBe(1)
    expect(dups[0].anchor).toBe('material:mat-downlight')
    const r = validateQuoteGrounding(draft, pricingBook, candidates)
    expect(r.valid).toBe(false)
  })

  it('flags a quantity signal that mentions a DIFFERENT, unrelated product (no category overlap)', () => {
    // Two quantities and an item mention, but the item is a tap — NOT the
    // downlight that is actually stacked. No category overlap → still flagged.
    const draft = {
      needs_inspection: false,
      scope_of_works: 'Good fits 3 taps; Best fits 6 taps in the ensuite.',
      good: { label: 'Good', line_items: [labour(2), downlightLine(3)] },
      better: null,
      best: { label: 'Best', line_items: [labour(2), downlightLine(6)] },
    }
    const dups = detectCrossTierDuplicates(draft, candidates)
    expect(dups.length).toBe(1)
    expect(dups[0].anchor).toBe('material:mat-downlight')
  })

  it('flags a totally unframed silent stack (empty scope)', () => {
    const draft = {
      needs_inspection: false,
      good: { label: 'Good', line_items: [labour(2), downlightLine(3)] },
      better: null,
      best: { label: 'Best', line_items: [labour(2), downlightLine(6)] },
    }
    const dups = detectCrossTierDuplicates(draft, candidates)
    expect(dups.length).toBe(1)
  })
})

describe('R6: ALLOWED — same quantity across tiers (ordinary progression)', () => {
  it('does NOT flag the same row at the SAME quantity in every tier', () => {
    const draft = {
      needs_inspection: false,
      good: { label: 'Good', line_items: [labour(2), downlightLine(6)] },
      better: { label: 'Better', line_items: [labour(3), downlightLine(6)] },
      best: { label: 'Best', line_items: [labour(4), downlightLine(6)] },
    }
    const dups = detectCrossTierDuplicates(draft, candidates)
    expect(dups.length).toBe(0)
    const r = validateQuoteGrounding(draft, pricingBook, candidates)
    expect(r.valid).toBe(true)
  })
})

describe('R6: ALLOWED — DIFFERENT products per tier (legit tier differentiation)', () => {
  it('does NOT flag good=basic HWS vs better=premium HWS (different rows)', () => {
    const basicLine = {
      description: 'Aquamax 250L basic HWS',
      quantity: 1,
      unit: 'each',
      unit_price_ex_gst: 1536, // 1200 × 1.28
      source: 'material:mat-basic-hws',
    }
    const premiumLine = {
      description: 'Rheem 5-star premium HWS',
      quantity: 1,
      unit: 'each',
      unit_price_ex_gst: 2432, // 1900 × 1.28
      source: 'material:mat-premium-hws',
    }
    const draft = {
      needs_inspection: false,
      good: { label: 'Good', line_items: [labour(2), basicLine] },
      better: null,
      best: { label: 'Best', line_items: [labour(3), premiumLine] },
    }
    const dups = detectCrossTierDuplicates(draft, candidates)
    expect(dups.length).toBe(0)
    const r = validateQuoteGrounding(draft, pricingBook, candidates)
    expect(r.valid).toBe(true)
  })
})

describe('R6: catches cross-tier dup even WITHOUT explicit UUIDs (price-only anchor)', () => {
  it('flags differing quantities of the same row across tiers when only price links them', () => {
    // No UUID source on the downlight lines; they anchor by price-only to
    // mat-downlight (the only row priced at $25.60). Different quantities,
    // no framing → flagged.
    const loose = (qty: number) => ({
      description: 'LED downlight install',
      quantity: qty,
      unit: 'each',
      unit_price_ex_gst: 25.6,
      source: 'material',
    })
    const draft = {
      needs_inspection: false,
      good: { label: 'Good', line_items: [labour(2), loose(4)] },
      better: null,
      best: { label: 'Best', line_items: [labour(2), loose(8)] },
    }
    const dups = detectCrossTierDuplicates(draft, candidates)
    expect(dups.length).toBe(1)
    expect(dups[0].anchor).toBe('material:mat-downlight')
  })
})

// R8 (2026-06-18) — the edit route used to null untouched tiers before
// re-validating, so a tradie adding a line in GOOD that duplicates one
// still sitting in BETTER went undetected. The route now runs
// detectCrossTierDuplicates over the FULL merged tier set. These tests
// reproduce that exact merged-draft shape (one tier edited, the other
// carried forward unchanged) and prove the dup is caught.
describe('R8: cross-tier dedup over the full merged tier set (edit-route shape)', () => {
  it('flags a GOOD line that duplicates an UNTOUCHED BETTER line at a different qty', () => {
    // Tradie edited GOOD to add 4 downlights; BETTER (unedited) already
    // has 8 of the same row. The route merges both into the full draft.
    const downlightLoose = (qty: number) => ({
      description: 'Downlight install',
      quantity: qty,
      unit: 'each',
      unit_price_ex_gst: 25.6,
      source: 'material:mat-downlight',
    })
    const fullMergedDraft = {
      needs_inspection: false,
      // No framing carried forward → unframed quantity difference → flag.
      good: { label: 'Good', line_items: [labour(2), downlightLoose(4)] },
      better: { label: 'Better', line_items: [labour(3), downlightLoose(8)] },
      best: null,
    }
    const dups = detectCrossTierDuplicates(fullMergedDraft, candidates)
    expect(dups.length).toBe(1)
    expect(dups[0].anchor).toBe('material:mat-downlight')
    expect(dups[0].occurrences.map((o) => o.tier)).toEqual(['good', 'better'])
  })

  it('does NOT flag when the edited GOOD line matches BETTER at the SAME qty (progression)', () => {
    const downlightLoose = (qty: number) => ({
      description: 'Downlight install',
      quantity: qty,
      unit: 'each',
      unit_price_ex_gst: 25.6,
      source: 'material:mat-downlight',
    })
    const fullMergedDraft = {
      needs_inspection: false,
      good: { label: 'Good', line_items: [labour(2), downlightLoose(6)] },
      better: { label: 'Better', line_items: [labour(3), downlightLoose(6)] },
      best: null,
    }
    const dups = detectCrossTierDuplicates(fullMergedDraft, candidates)
    expect(dups.length).toBe(0)
  })

  // R8 select fix (2026-06-18) — the edit route builds `fullDraft` carrying
  // scope_of_works / assumptions for cross-tier framing. Pre-fix the quote
  // SELECT never pulled those columns, so fullDraft.scope_of_works was
  // ALWAYS undefined and a legitimately-framed "3 vs 6" quote got a spurious
  // 422 the moment the tradie touched any tier. These two tests pin the
  // exact fullDraft shape the route now constructs.
  it('does NOT flag a framed multi-qty edit when scope_of_works is carried forward (the select fix)', () => {
    const downlightLoose = (qty: number) => ({
      description: 'Downlight install',
      quantity: qty,
      unit: 'each',
      unit_price_ex_gst: 25.6,
      source: 'material:mat-downlight',
    })
    // Mirrors route.ts fullDraft: scope_of_works + assumptions sourced from
    // the freshly-SELECTed quote row; scope_short is intentionally null (not
    // a quotes column). The framing explains the count change.
    const fullDraft = {
      scope_of_works:
        'Brilliant 9W LED downlight install: Good covers 4 downlights in the kitchen; ' +
        'Best extends to 8 downlights across the kitchen and hallway.',
      scope_short: null,
      assumptions: null,
      good: { label: 'Good', line_items: [labour(2), downlightLoose(4)] },
      better: { label: 'Better', line_items: [labour(3), downlightLoose(8)] },
      best: null,
    }
    const dups = detectCrossTierDuplicates(fullDraft, candidates)
    expect(dups.length).toBe(0)
  })

  it('regression: WITHOUT the carried-forward framing the same edit is flagged (proves framing is load-bearing)', () => {
    const downlightLoose = (qty: number) => ({
      description: 'Downlight install',
      quantity: qty,
      unit: 'each',
      unit_price_ex_gst: 25.6,
      source: 'material:mat-downlight',
    })
    // Identical tiers to the test above, but with the pre-fix shape where the
    // framing columns were never selected (undefined / null). The unframed
    // quantity difference MUST still flag — confirming the fix removes a
    // false-positive ONLY when real framing exists, never weakening the gate.
    const fullDraft = {
      scope_of_works: null,
      scope_short: null,
      assumptions: null,
      good: { label: 'Good', line_items: [labour(2), downlightLoose(4)] },
      better: { label: 'Better', line_items: [labour(3), downlightLoose(8)] },
      best: null,
    }
    const dups = detectCrossTierDuplicates(fullDraft, candidates)
    expect(dups.length).toBe(1)
    expect(dups[0].anchor).toBe('material:mat-downlight')
    expect(dups[0].occurrences.map((o) => o.tier)).toEqual(['good', 'better'])
  })

  it('honours framing carried forward via assumptions[] (route fullDraft.assumptions path)', () => {
    const downlightLoose = (qty: number) => ({
      description: 'Downlight install',
      quantity: qty,
      unit: 'each',
      unit_price_ex_gst: 25.6,
      source: 'material:mat-downlight',
    })
    // quotes.assumptions is jsonb (an array) — route passes it through to
    // fullDraft.assumptions verbatim. detectCrossTierDuplicates joins the
    // array into the framing text.
    const fullDraft = {
      scope_of_works: null,
      scope_short: null,
      assumptions: [
        'Good = 4 Brilliant 9W LED downlight units; Best = 8 downlight units.',
      ],
      good: { label: 'Good', line_items: [labour(2), downlightLoose(4)] },
      better: { label: 'Better', line_items: [labour(3), downlightLoose(8)] },
      best: null,
    }
    const dups = detectCrossTierDuplicates(fullDraft, candidates)
    expect(dups.length).toBe(0)
  })
})

describe('R6: failure shape', () => {
  it('points the failure at the FIRST occurrence and lists all tiers', () => {
    const draft = {
      needs_inspection: false,
      good: { label: 'Good', line_items: [labour(2), downlightLine(3)] },
      better: null,
      best: { label: 'Best', line_items: [labour(2), downlightLine(6)] },
    }
    const r = validateQuoteGrounding(draft, pricingBook, candidates)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      const ct = r.failures.find((f) => f.expected.includes('cross-tier duplicate'))
      expect(ct).toBeDefined()
      expect(ct?.tier).toBe('good')
      // First downlight occurrence is index 1 (after the labour line).
      expect(ct?.lineIndex).toBe(1)
      expect(ct?.expected).toContain('good#1')
      expect(ct?.expected).toContain('best#1')
    }
  })
})
