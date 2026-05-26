// D-1 (2026-05-26) — duplicate-line guard in validateQuoteGrounding.
//
// Real-world incident: quote 3669a680... (Sparky → James, plumbing HWS,
// 2026-05-26) had the SAME Dux Proflo 315L appear as two separate line
// items: one at raw cost ($1,645, source: "material") and one at the
// marked-up price ($2,237.20, source: "material:<id>"). Both passed the
// per-line validator (raw via loose path, marked-up via strict UUID
// path). The customer was charged for the product twice, inflating the
// total by ~$1,810 inc GST.
//
// D-1 adds a tier-level dedup pass: for each line, resolve the catalogue
// row it maps to (by explicit UUID OR by description + price match), then
// flag any tier where two lines resolve to the same catalogue row.

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

const candidates = buildCandidatePrices(
  [
    {
      id: 'mat-dux-proflo-315',
      name: 'Dux Proflo 315L electric storage HWS',
      price: 1645,
      category: 'hot_water',
    },
    {
      id: 'mat-rheem-260',
      name: 'Rheem 5-star 260L gas storage HWS',
      price: 1845,
      category: 'hot_water',
    },
  ],
  [
    {
      id: 'asm-install-electric-hws',
      name: 'Install electric HWS',
      price: 45,
      category: 'hot_water',
    },
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

const baseLabour = [
  {
    description: 'Labour — HWS changeover (plumber)',
    quantity: 3,
    unit: 'hr',
    unit_price_ex_gst: 118,
    source: 'labour',
  },
]

describe('D-1: duplicate-line guard', () => {
  it('fails when same catalogue row appears as both raw and marked-up', () => {
    // This is the exact shape of the real incident quote 3669a680.
    const r = validateQuoteGrounding(
      tier([
        // Line 1: raw price, "material" source without UUID (Opus prompt violation)
        {
          description: 'Dux Proflo 315L electric storage HWS',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 1645,
          source: 'material',
        },
        ...baseLabour,
        // Line 3: marked-up price, full UUID source, decorated description
        {
          description: 'Dux Proflo 315L electric storage HWS (supplied)',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 2237.2,
          source: 'material:mat-dux-proflo-315',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      const dup = r.failures.find((f) => f.expected.includes('D-1 dedup'))
      expect(dup).toBeDefined()
      expect(dup?.lineIndex).toBe(2)
    }
  })

  it('fails when same catalogue row appears as two UUID-anchored lines', () => {
    const r = validateQuoteGrounding(
      tier([
        ...baseLabour,
        {
          description: 'Dux Proflo 315L electric storage HWS',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 2237.2,
          source: 'material:mat-dux-proflo-315',
        },
        {
          description: 'Dux Proflo 315L electric storage HWS',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 2237.2,
          source: 'material:mat-dux-proflo-315',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      const dup = r.failures.find((f) => f.expected.includes('D-1 dedup'))
      expect(dup).toBeDefined()
    }
  })

  it('passes when same product is rolled into a single line with quantity > 1', () => {
    const r = validateQuoteGrounding(
      tier([
        ...baseLabour,
        // The correct shape: one line, quantity=2, at marked-up price.
        {
          description: 'Dux Proflo 315L electric storage HWS',
          quantity: 2,
          unit: 'each',
          unit_price_ex_gst: 2237.2,
          source: 'material:mat-dux-proflo-315',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(true)
  })

  it('passes when two DIFFERENT catalogue products appear in the same tier', () => {
    // Legitimate quote: customer wants both an electric AND a gas HWS quoted.
    const r = validateQuoteGrounding(
      tier([
        ...baseLabour,
        {
          description: 'Dux Proflo 315L electric storage HWS',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 2237.2,
          source: 'material:mat-dux-proflo-315',
        },
        {
          description: 'Rheem 5-star 260L gas storage HWS',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 2509.2,
          source: 'material:mat-rheem-260',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(true)
  })

  it('does not flag labour/callout lines as duplicates of each other', () => {
    // Multiple labour lines at the same hourly rate are legitimate (e.g.
    // separate "callout labour" + "install labour" lines). They have no
    // catalogue anchor so dedup ignores them.
    const r = validateQuoteGrounding(
      tier([
        {
          description: 'Call-out labour',
          quantity: 1,
          unit: 'hr',
          unit_price_ex_gst: 118,
          source: 'labour',
        },
        {
          description: 'Install labour',
          quantity: 2,
          unit: 'hr',
          unit_price_ex_gst: 118,
          source: 'labour',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(true)
  })

  it('catches duplicates even when the second line has a decorated description', () => {
    // The "(supplied)" / "(installed)" suffix is a hallucination shape.
    // Dedup strips parenthetical tails before name-matching the catalogue.
    const r = validateQuoteGrounding(
      tier([
        ...baseLabour,
        {
          description: 'Dux Proflo 315L electric storage HWS',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 1645,
          source: 'material',
        },
        {
          description: 'Dux Proflo 315L electric storage HWS (installed)',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 2237.2,
          source: 'material',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(false)
  })
})
