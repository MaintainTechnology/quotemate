// R-4 (2026-05-25) — strict UUID grounding in validateQuoteGrounding.
//
// The audit found that pre-R-4 the validator only checked that a line's
// price was within ±$0.50 of SOME candidate row's expanded price (with
// ±5pp markup drift), plus a category overlap. That let Opus "swap
// rows" silently — e.g. pick HPM Premium at $32 but emit Clipsal Iconic's
// $35 × 1.36 = $47.60. The line still grounded because $47.60 matched
// Clipsal's candidate.
//
// Post-R-4: when a line's `source` field carries `"material:<id>"` or
// `"assembly:<id>"`, the validator looks up THAT exact row in the
// candidate set and requires the line price to match one of its raw or
// markup-expanded variants — no category fallback, no cross-row match.
// Lines without a UUID in source still use the loose path (backward
// compat for legacy / tradie_edit / labour / callout lines).

import { describe, expect, it } from 'vitest'
import {
  validateQuoteGrounding,
  buildCandidatePrices,
  type PricingBookForValidation,
} from './validate'

const pricingBook: PricingBookForValidation = {
  hourly_rate: 118,
  apprentice_rate: 86,
  call_out_minimum: 160,
  default_markup_pct: 36,
  min_labour_hours: 3,
}

// Two distinct downlight rows — same category, similar prices. Pre-R-4
// these would have been interchangeable by the validator because both
// land within the markup-drift band. Post-R-4 the UUID picks one.
const candidates = buildCandidatePrices(
  [
    { id: 'mat-hpm-premium', name: 'HPM Premium downlight 9W', price: 32, category: 'downlight' },
    { id: 'mat-clipsal-iconic', name: 'Clipsal Iconic LED downlight', price: 35, category: 'downlight' },
    { id: 'mat-sal-apollo', name: 'Sal Apollo dimmable LED', price: 40, category: 'downlight' },
  ],
  [
    { id: 'asm-install-led', name: 'Install LED downlight', price: 28, category: 'downlight' },
  ],
  pricingBook,
)

function tier(lines: any[]) {
  return {
    needs_inspection: false,
    good: { line_items: lines },
    better: null,
    best: null,
  }
}

// Standard line set: callout + 3 hr labour to satisfy min-labour floor.
// Tests add their material line(s) to this base.
const baseLines = [
  { description: 'Call-out', quantity: 1, unit: 'each', unit_price_ex_gst: 160, source: 'callout' },
  { description: 'Install labour', quantity: 3, unit: 'hr', unit_price_ex_gst: 118, source: 'labour' },
]

describe('R-4: strict UUID grounding — happy path', () => {
  it('accepts a line that prices to the named row at default markup', () => {
    // HPM Premium $32 × 1.36 = $43.52
    const r = validateQuoteGrounding(
      tier([
        ...baseLines,
        {
          description: 'HPM Premium downlight 9W',
          quantity: 6,
          unit: 'each',
          unit_price_ex_gst: 43.52,
          source: 'material:mat-hpm-premium',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(true)
  })

  it('accepts a line at the raw price (no markup — e.g. customer-supply rate)', () => {
    const r = validateQuoteGrounding(
      tier([
        ...baseLines,
        {
          description: 'Customer to supply — HPM Premium downlight',
          quantity: 6,
          unit: 'each',
          unit_price_ex_gst: 32,
          source: 'material:mat-hpm-premium',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(true)
  })

  it('accepts assembly:<id> lines the same way', () => {
    // Install LED downlight assembly $28 × 1.36 = $38.08
    const r = validateQuoteGrounding(
      tier([
        ...baseLines,
        {
          description: 'Install kit per downlight',
          quantity: 6,
          unit: 'each',
          unit_price_ex_gst: 38.08,
          source: 'assembly:asm-install-led',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(true)
  })
})

describe('R-4: strict UUID grounding — the bug it closes', () => {
  it('REJECTS the "wrong row, right price band" swap', () => {
    // Opus stamps HPM Premium's id but emits Clipsal's marked-up price
    // ($35 × 1.36 = $47.60). Pre-R-4 this passed via the markup drift
    // band. Post-R-4 the row-by-id lookup forbids the swap.
    const r = validateQuoteGrounding(
      tier([
        ...baseLines,
        {
          description: 'Tri-colour dimmable downlight (HPM Premium)',
          quantity: 6,
          unit: 'each',
          unit_price_ex_gst: 47.60,
          source: 'material:mat-hpm-premium',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.failures[0].expected).toContain('mat-hpm-premium')
      expect(r.failures[0].expected).toContain('HPM Premium')
    }
  })

  it('REJECTS a fabricated row id (Opus invented a UUID)', () => {
    const r = validateQuoteGrounding(
      tier([
        ...baseLines,
        {
          description: 'Tri-colour dimmable downlight',
          quantity: 6,
          unit: 'each',
          unit_price_ex_gst: 43.52,
          source: 'material:does-not-exist-12345',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.failures[0].expected).toContain('not found')
    }
  })

  it('REJECTS material:<id> when the row is in candidates but the price is off by more than $0.50', () => {
    // $32 × 1.36 = $43.52; line at $44.50 (~$1 off) — fails
    const r = validateQuoteGrounding(
      tier([
        ...baseLines,
        {
          description: 'HPM Premium downlight 9W',
          quantity: 6,
          unit: 'each',
          unit_price_ex_gst: 44.50,
          source: 'material:mat-hpm-premium',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(false)
  })
})

describe('R-4: backward compat — lines without UUID use loose path', () => {
  it('accepts a "material" source without a UUID via the loose path', () => {
    // Source is just "material" — no colon, no id. Falls through to
    // the legacy price + category match logic (HPM Premium price × markup
    // matches some candidate AND "downlight" category overlaps).
    const r = validateQuoteGrounding(
      tier([
        ...baseLines,
        {
          description: 'Tri-colour dimmable downlight',
          quantity: 6,
          unit: 'each',
          unit_price_ex_gst: 43.52,
          source: 'material',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(true)
  })

  it('accepts a "tradie_edit" line via the loose path', () => {
    // Tradie hand-edited line via /api/quote/[id]/edit (H-2 grounding).
    // Source is "tradie_edit", no UUID. Loose path validates.
    const r = validateQuoteGrounding(
      tier([
        ...baseLines,
        {
          description: 'HPM Premium downlight 9W',
          quantity: 6,
          unit: 'each',
          unit_price_ex_gst: 43.52,
          source: 'tradie_edit',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(true)
  })

  it('accepts a line with no source at all via the loose path (legacy quotes)', () => {
    const r = validateQuoteGrounding(
      tier([
        ...baseLines,
        {
          description: 'HPM Premium downlight 9W',
          quantity: 6,
          unit: 'each',
          unit_price_ex_gst: 43.52,
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(true)
  })

  it('rejects the placeholder source "material:UUID" (literal) via no-UUID treatment', () => {
    // Opus could copy the prompt example verbatim. Treat "UUID" as no-id
    // and fall through to loose grounding — line still passes because
    // the price matches HPM Premium × markup in some candidate.
    const r = validateQuoteGrounding(
      tier([
        ...baseLines,
        {
          description: 'HPM Premium downlight 9W',
          quantity: 6,
          unit: 'each',
          unit_price_ex_gst: 43.52,
          source: 'material:UUID',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(true)
  })
})

describe('R-4: mixed strict + loose in same tier', () => {
  it('one strict (correct), one loose — both pass', () => {
    const r = validateQuoteGrounding(
      tier([
        ...baseLines,
        {
          description: 'HPM Premium 9W (strict)',
          quantity: 3,
          unit: 'each',
          unit_price_ex_gst: 43.52,
          source: 'material:mat-hpm-premium',
        },
        {
          description: 'Tri-colour dimmable downlight (loose)',
          quantity: 3,
          unit: 'each',
          unit_price_ex_gst: 47.60,
          source: 'material',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(true)
  })

  it('one strict (wrong row), one loose (right) — whole tier fails', () => {
    const r = validateQuoteGrounding(
      tier([
        ...baseLines,
        {
          // Strict failure: HPM Premium id, Clipsal price ($47.60 = $35 × 1.36)
          description: 'HPM Premium 9W downlight',
          quantity: 3,
          unit: 'each',
          unit_price_ex_gst: 47.60,
          source: 'material:mat-hpm-premium',
        },
        {
          // Loose path: 'downlight' in description matches candidate
          // category tag, price ($47.60 = $35 × 1.36) matches Clipsal Iconic
          // expanded variant → passes loose grounding.
          description: 'Clipsal Iconic LED downlight',
          quantity: 3,
          unit: 'each',
          unit_price_ex_gst: 47.60,
          source: 'material',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      // Only the strict line fails; loose line passed.
      expect(r.failures.length).toBe(1)
      // baseLines = 2 items (callout idx 0, labour idx 1), then strict at idx 2.
      expect(r.failures[0].lineIndex).toBe(2)
    }
  })
})
