// R12 (2026-06-18) — SAFETY-CRITICAL category whitelist + cross-trade
// mismatch guard in categoriesMatch (exercised end-to-end through
// validateQuoteGrounding's loose grounding path).
//
// The loose path grounds a line when (price matches a candidate) AND
// (line category overlaps the candidate row category). For ordinary
// categories a near-miss is a pricing bug. For SAFETY-CRITICAL categories
// (smoke_alarm, gas, switchboard, rcbo/safety-switch) a wrong-category
// ground is a LIABILITY — a customer sold "smoke alarm work" priced off a
// downlight row of the same dollar amount.
//
// R12 contract:
//   1. A candidate ROW that carries a safety-critical tag can only ground a
//      line whose OWN text carries that same safety tag.
//   2. A safety-critical LINE can only ground from a row carrying that same
//      safety tag — never from a generic same-priced row.
//   3. Cross-trade: an electrical-only line can never ground a plumbing-only
//      row of the same price, and vice versa.
//   4. Legitimate same-category safety lines are UNAFFECTED (no regression).

import { describe, expect, it } from 'vitest'
import {
  validateQuoteGrounding,
  buildCandidatePrices,
  categorise,
  type Category,
  type PricingBookForValidation,
} from './validate'

const pricingBook: PricingBookForValidation = {
  hourly_rate: 110,
  apprentice_rate: 80,
  call_out_minimum: 150,
  default_markup_pct: 28,
  min_labour_hours: 2,
}

const baseLines = [
  { description: 'Call-out', quantity: 1, unit: 'each', unit_price_ex_gst: 150, source: 'callout' },
  { description: 'Install labour', quantity: 2, unit: 'hr', unit_price_ex_gst: 110, source: 'labour' },
]

function goodWith(line: any) {
  return {
    needs_inspection: false,
    good: { label: 'Standard', line_items: [...baseLines, line] },
    better: null,
    best: null,
  }
}

// ── Documented product_name → expected_categories matrix ────────────────
// Each row asserts categorise() tags the product into the EXPECTED set.
// This is the contract the whitelist + cross-trade guard rely on.
describe('R12 matrix: product_name → expected_categories', () => {
  const matrix: Array<{ name: string; expected: Category[]; notExpected?: Category[] }> = [
    // Safety-critical — electrical
    { name: 'Replace 240V interconnected smoke alarm', expected: ['smoke_alarm'] },
    { name: 'Hardwire photoelectric smoke alarm', expected: ['smoke_alarm'] },
    { name: 'Upgrade main switchboard with new enclosure', expected: ['switchboard'] },
    { name: 'Install RCBO safety switch on the kitchen circuit', expected: ['rcbo'] },
    // Safety-critical — plumbing
    { name: 'Connect gas cooktop to existing bayonet', expected: ['gas'] },
    { name: 'Repair gas leak at the meter', expected: ['gas'], notExpected: ['leak_detection'] },
    // Ordinary electrical
    { name: 'Install 9W LED downlight', expected: ['downlight'] },
    { name: 'Replace double GPO power point', expected: ['gpo'] },
    // Ordinary plumbing
    { name: 'Replace kitchen mixer tap', expected: ['tap'] },
    { name: 'Replace 250L electric hot water storage tank', expected: ['hot_water'], notExpected: ['rainwater_tank'] },
  ]

  for (const { name, expected, notExpected } of matrix) {
    it(`"${name}" → [${expected.join(',')}]`, () => {
      const cats = categorise(name)
      for (const e of expected) expect(cats.has(e)).toBe(true)
      for (const ne of notExpected ?? []) expect(cats.has(ne)).toBe(false)
    })
  }
})

describe('R12: SAFETY-CRITICAL row cannot ground a non-matching line', () => {
  // smoke_alarm row at $40 × 1.28 = $51.20. A line at the SAME price that
  // does NOT mention smoke/alarm must NOT ground off it.
  const smokeCandidates = buildCandidatePrices(
    [{ id: 'mat-smoke', name: 'Clipsal 240V photoelectric smoke alarm', price: 40, category: 'smoke_alarm' }],
    [],
    pricingBook,
  )

  it('REJECTS a downlight line priced off a same-$ smoke_alarm row', () => {
    const r = validateQuoteGrounding(
      goodWith({
        description: 'Install LED downlight',
        quantity: 1,
        unit: 'each',
        unit_price_ex_gst: 51.2, // same price as the smoke alarm row × markup
        source: 'material',
      }),
      pricingBook,
      smokeCandidates,
    )
    expect(r.valid).toBe(false)
  })

  it('REJECTS a generic/uncategorised line priced off a smoke_alarm row', () => {
    const r = validateQuoteGrounding(
      goodWith({
        description: 'Sundry electrical item',
        quantity: 1,
        unit: 'each',
        unit_price_ex_gst: 51.2,
        source: 'material',
      }),
      pricingBook,
      smokeCandidates,
    )
    expect(r.valid).toBe(false)
  })

  it('ACCEPTS a genuine smoke alarm line off the smoke_alarm row (no regression)', () => {
    const r = validateQuoteGrounding(
      goodWith({
        description: 'Supply & install 240V interconnected smoke alarm',
        quantity: 1,
        unit: 'each',
        unit_price_ex_gst: 51.2,
        source: 'material',
      }),
      pricingBook,
      smokeCandidates,
    )
    expect(r.valid).toBe(true)
  })
})

describe('R12: SAFETY-CRITICAL line cannot ground off a generic row', () => {
  // A downlight row at $40 × 1.28 = $51.20 (NOT safety). A smoke-alarm LINE
  // at the same price must NOT ground off it.
  const downlightCandidates = buildCandidatePrices(
    [{ id: 'mat-dl', name: 'Brilliant 9W LED downlight', price: 40, category: 'downlight' }],
    [],
    pricingBook,
  )

  it('REJECTS a smoke alarm line priced off a same-$ downlight row', () => {
    const r = validateQuoteGrounding(
      goodWith({
        description: 'Replace hardwired smoke alarm',
        quantity: 1,
        unit: 'each',
        unit_price_ex_gst: 51.2,
        source: 'material',
      }),
      pricingBook,
      downlightCandidates,
    )
    expect(r.valid).toBe(false)
  })

  it('REJECTS a switchboard line priced off a same-$ downlight row', () => {
    const r = validateQuoteGrounding(
      goodWith({
        description: 'Switchboard upgrade allowance',
        quantity: 1,
        unit: 'each',
        unit_price_ex_gst: 51.2,
        source: 'material',
      }),
      pricingBook,
      downlightCandidates,
    )
    expect(r.valid).toBe(false)
  })

  it('REJECTS a gas line priced off a generic same-$ row', () => {
    const r = validateQuoteGrounding(
      goodWith({
        description: 'Gas appliance connection',
        quantity: 1,
        unit: 'each',
        unit_price_ex_gst: 51.2,
        source: 'material',
      }),
      pricingBook,
      downlightCandidates,
    )
    expect(r.valid).toBe(false)
  })
})

describe('R12: CROSS-TRADE mismatch guard', () => {
  // A plumbing tap row at $80 × 1.28 = $102.40. An electrical (downlight)
  // line at the same price must NOT ground off it.
  const tapCandidates = buildCandidatePrices(
    [{ id: 'mat-tap', name: 'Methven kitchen mixer tap', price: 80, category: 'tap' }],
    [],
    pricingBook,
  )

  it('REJECTS an electrical downlight line priced off a plumbing tap row', () => {
    const r = validateQuoteGrounding(
      goodWith({
        description: 'Install 6 LED downlights',
        quantity: 1,
        unit: 'each',
        unit_price_ex_gst: 102.4,
        source: 'material',
      }),
      pricingBook,
      tapCandidates,
    )
    expect(r.valid).toBe(false)
  })

  it('ACCEPTS a genuine tap line off the tap row (no regression)', () => {
    const r = validateQuoteGrounding(
      goodWith({
        description: 'Replace kitchen mixer tap',
        quantity: 1,
        unit: 'each',
        unit_price_ex_gst: 102.4,
        source: 'material',
      }),
      pricingBook,
      tapCandidates,
    )
    expect(r.valid).toBe(true)
  })

  it('REJECTS a plumbing drain line priced off an electrical GPO row', () => {
    const gpoCandidates = buildCandidatePrices(
      [{ id: 'mat-gpo', name: 'Clipsal double GPO', price: 80, category: 'gpo' }],
      [],
      pricingBook,
    )
    const r = validateQuoteGrounding(
      goodWith({
        description: 'Clear blocked drain by hand-rodding',
        quantity: 1,
        unit: 'each',
        unit_price_ex_gst: 102.4,
        source: 'material',
      }),
      pricingBook,
      gpoCandidates,
    )
    expect(r.valid).toBe(false)
  })
})

describe('R12: row-side veto only fires for a PURE safety row or no shared non-safety tag (false-positive fix)', () => {
  // A MIXED catalogue row tagged [oven_cooktop, gas] (gas is safety-critical,
  // oven_cooktop is not). A genuine [oven_cooktop] line that shares the real
  // non-safety oven_cooktop tag must STILL ground — pre-fix the row's gas
  // safety tag vetoed the legitimate oven_cooktop overlap.
  it('ACCEPTS an oven_cooktop line against a [oven_cooktop, gas] mixed row', () => {
    const mixed = buildCandidatePrices(
      [
        {
          id: 'asm-gas-cooktop',
          // "gas cooktop" → both `gas` (safety) and `oven_cooktop` tags.
          name: 'Supply & connect gas cooktop appliance',
          price: 300,
          category: 'oven_cooktop',
        },
      ],
      [],
      pricingBook,
    )
    // Confirm the row really is a mixed safety+non-safety row.
    const rowCats = categorise('Supply & connect gas cooktop appliance')
    expect(rowCats.has('gas')).toBe(true)
    expect(rowCats.has('oven_cooktop')).toBe(true)

    const r = validateQuoteGrounding(
      goodWith({
        // Electric oven/cooktop line — oven_cooktop only, NO gas tag.
        description: 'Install electric oven and cooktop',
        quantity: 1,
        unit: 'each',
        unit_price_ex_gst: 384, // 300 × 1.28
        source: 'material',
      }),
      pricingBook,
      mixed,
    )
    expect(r.valid).toBe(true)
  })

  it('STILL REJECTS a downlight line against a [smoke_alarm]-only (pure safety) row', () => {
    const pureSafety = buildCandidatePrices(
      [{ id: 'mat-smoke', name: 'Clipsal 240V photoelectric smoke alarm', price: 300, category: 'smoke_alarm' }],
      [],
      pricingBook,
    )
    const r = validateQuoteGrounding(
      goodWith({
        description: 'Install LED downlight',
        quantity: 1,
        unit: 'each',
        unit_price_ex_gst: 384, // 300 × 1.28 — same price as the smoke alarm row
        source: 'material',
      }),
      pricingBook,
      pureSafety,
    )
    expect(r.valid).toBe(false)
  })

  it('STILL REJECTS a non-matching line against a MIXED row with NO shared non-safety tag', () => {
    // Mixed row [oven_cooktop, gas]; a downlight line shares NEITHER the
    // safety tag NOR the non-safety oven_cooktop tag → must be rejected even
    // though the row is not purely safety.
    const mixed = buildCandidatePrices(
      [{ id: 'asm-gas-cooktop', name: 'Supply & connect gas cooktop appliance', price: 300, category: 'oven_cooktop' }],
      [],
      pricingBook,
    )
    const r = validateQuoteGrounding(
      goodWith({
        description: 'Install LED downlight',
        quantity: 1,
        unit: 'each',
        unit_price_ex_gst: 384,
        source: 'material',
      }),
      pricingBook,
      mixed,
    )
    expect(r.valid).toBe(false)
  })
})

describe('R12: ordinary same-category grounding is untouched', () => {
  it('a downlight line still grounds off a downlight row at the same price', () => {
    const dl = buildCandidatePrices(
      [{ id: 'mat-dl', name: 'Sal Apollo LED downlight', price: 40, category: 'downlight' }],
      [],
      pricingBook,
    )
    const r = validateQuoteGrounding(
      goodWith({
        description: 'Tri-colour dimmable downlight',
        quantity: 1,
        unit: 'each',
        unit_price_ex_gst: 51.2,
        source: 'material',
      }),
      pricingBook,
      dl,
    )
    expect(r.valid).toBe(true)
  })

  it('a general line still grounds off a pure sundry row (catch-all preserved)', () => {
    const sundry = buildCandidatePrices(
      [{ id: 'mat-sun', name: 'Sundries and consumables', price: 30, category: 'sundry' }],
      [],
      pricingBook,
    )
    const r = validateQuoteGrounding(
      goodWith({
        description: 'Disposal of old fittings',
        quantity: 1,
        unit: 'each',
        unit_price_ex_gst: 38.4, // 30 × 1.28
        source: 'material',
      }),
      pricingBook,
      sundry,
    )
    expect(r.valid).toBe(true)
  })
})
