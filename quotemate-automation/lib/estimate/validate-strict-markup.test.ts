// R10 — strict markup grounding for deterministically-priced quotes.
//
// Normal (Opus) path keeps the ±5pp drift band (forgives LLM rounding).
// When a quote was priced DETERMINISTICALLY, the markup is exactly
// default_markup_pct, so buildCandidatePrices({ strictMarkup:true }) drops the
// band — a line that drifted +5pp (the over-pricing hole) now FAILS grounding.

import { describe, expect, it } from 'vitest'
import { validateQuoteGrounding, buildCandidatePrices, type PricingBookForValidation } from './validate'

const pricingBook: PricingBookForValidation = {
  hourly_rate: 118,
  apprentice_rate: 86,
  call_out_minimum: 160,
  default_markup_pct: 20, // clean math: ×1.20 = exact, ×1.25 = +5pp drift
  min_labour_hours: 3,
}

const MAT = [{ id: 'mat-dl', name: 'Basic LED downlight', price: 100, category: 'downlight' }]
const ASM = [{ id: 'asm-dl', name: 'Install LED downlight', price: 28, category: 'downlight' }]

const looseCandidates = buildCandidatePrices(MAT, ASM, pricingBook)
const strictCandidates = buildCandidatePrices(MAT, ASM, pricingBook, { strictMarkup: true })

const base = [
  { description: 'Call-out', quantity: 1, unit: 'each', unit_price_ex_gst: 160, source: 'callout' },
  { description: 'Install labour', quantity: 3, unit: 'hr', unit_price_ex_gst: 118, source: 'labour' },
]
function tier(matPrice: number) {
  return {
    needs_inspection: false,
    good: {
      line_items: [
        ...base,
        { description: 'Basic LED downlight', quantity: 6, unit: 'each', unit_price_ex_gst: matPrice, source: 'material:mat-dl' },
      ],
    },
    better: null,
    best: null,
  }
}

describe('R10 — strict markup grounding', () => {
  it('exact default markup (×1.20 = 120) grounds in BOTH modes', () => {
    expect(validateQuoteGrounding(tier(120), pricingBook, looseCandidates).valid).toBe(true)
    expect(validateQuoteGrounding(tier(120), pricingBook, strictCandidates).valid).toBe(true)
  })

  it('a +5pp drifted price (×1.25 = 125) grounds LOOSE but FAILS STRICT', () => {
    // Opus path tolerates the rounding drift...
    expect(validateQuoteGrounding(tier(125), pricingBook, looseCandidates).valid).toBe(true)
    // ...deterministic path does not — the over-pricing hole is closed.
    expect(validateQuoteGrounding(tier(125), pricingBook, strictCandidates).valid).toBe(false)
  })

  it('the raw price (no markup) still grounds in strict mode (customer-supply line)', () => {
    expect(validateQuoteGrounding(tier(100), pricingBook, strictCandidates).valid).toBe(true)
  })
})
