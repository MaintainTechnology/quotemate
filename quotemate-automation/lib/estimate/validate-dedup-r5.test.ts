// R5 (2026-06-18) — STRENGTHENED within-tier duplicate prevention.
//
// The D-1 guard (2026-05-26) caught the same catalogue row appearing twice
// in a tier ONLY when the second line either carried an explicit UUID or
// its DESCRIPTION aligned with the catalogue row name. Two harder shapes
// slipped through:
//
//   (a) DIFFERENT descriptions — Opus emits the same row as "Dux Proflo
//       315L" on one line and "Premium HWS 315L" on the other. The name
//       reverse-anchor never matched, so the two lines anchored to nothing
//       and the duplicate was never flagged.
//
//   (b) DIFFERENT markup bands — the two prices fall in different bands
//       (raw $1645 vs ×20% vs ×28%). The original guard could anchor by
//       name+price, but only when the NAME matched too.
//
// R5 resolves anchors sourceId-FIRST and adds a conservative PRICE-ONLY
// fallback: when a line's price unambiguously maps to exactly one catalogue
// row (across all markup variants), it anchors to that row regardless of
// the description Opus invented. Two lines that both map to the same row →
// the later one is flagged (D-1 fail behavior preserved).
//
// The price-only fallback is deliberately conservative: if a price matches
// more than one distinct catalogue row id it anchors to NEITHER (returns
// null), so two genuinely different products that merely cost the same are
// never falsely flagged.

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
  default_markup_pct: 28,
  min_labour_hours: 3,
}

// One HWS row + one clearly-distinct second HWS row at a price that does NOT
// collide with the first's markup variants, so price-only anchoring is
// unambiguous in the dup tests.
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
  [],
  pricingBook,
)

const baseLabour = [
  {
    description: 'Labour — HWS changeover (plumber)',
    quantity: 3,
    unit: 'hr',
    unit_price_ex_gst: 118,
    source: 'labour',
  },
]

function goodTier(lines: any[]) {
  return {
    needs_inspection: false,
    good: { line_items: lines },
    better: null,
    best: null,
  }
}

describe('R5: within-tier dedup — DIFFERENT descriptions', () => {
  it('flags the same row charged twice when the two descriptions differ', () => {
    // Dux Proflo 315L raw $1645 (source "material", no UUID, generic desc)
    // AND the same row marked up ×1.28 = $2105.60 with a UUID + a totally
    // different made-up name. Pre-R5 the name reverse-anchor would not
    // align "Premium HWS 315L" to the catalogue name, so the raw line
    // anchored to nothing. R5 anchors the raw line by price-only.
    const r = validateQuoteGrounding(
      goodTier([
        ...baseLabour,
        {
          // Legitimate strict-UUID line (marked up).
          description: 'Premium HWS 315L (supply + install)',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 2105.6, // 1645 × 1.28
          source: 'material:mat-dux-proflo-315',
        },
        {
          // The DUP — raw price, generic source, DIFFERENT description.
          description: 'Storage hot water unit 315 litre',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 1645, // raw — price-only anchors to mat-dux-proflo-315
          source: 'material',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      const dup = r.failures.find((f) => f.expected.includes('D-1 dedup'))
      expect(dup).toBeDefined()
      // The later (raw, generic-desc) line is index 2.
      expect(dup?.lineIndex).toBe(2)
    }
  })
})

describe('R5: within-tier dedup — DIFFERENT markup bands', () => {
  it('flags the same row charged at raw AND at +5pp drift band', () => {
    // Same row, no UUID on either line, descriptions differ, prices differ:
    // raw $1645 vs ×1.33 (28+5pp) = $2187.85. Both prices map ONLY to
    // mat-dux-proflo-315, so price-only anchors them together.
    const r = validateQuoteGrounding(
      goodTier([
        ...baseLabour,
        {
          description: 'Hot water system — base cost',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 1645, // raw band
          source: 'material',
        },
        {
          description: 'Hot water system — supplied & fitted',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 2187.85, // 1645 × 1.33 (+5pp drift band)
          source: 'material',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.failures.some((f) => f.expected.includes('D-1 dedup'))).toBe(true)
    }
  })
})

describe('R5: still passes the legitimate cases', () => {
  it('does NOT flag two genuinely different products in the same tier', () => {
    const r = validateQuoteGrounding(
      goodTier([
        ...baseLabour,
        {
          description: 'Dux Proflo 315L electric storage HWS',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 2105.6, // 1645 × 1.28
          source: 'material:mat-dux-proflo-315',
        },
        {
          description: 'Rheem 5-star 260L gas storage HWS',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 2361.6, // 1845 × 1.28
          source: 'material:mat-rheem-260',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(true)
  })

  it('does NOT flag when one product is rolled into a single quantity=2 line', () => {
    const r = validateQuoteGrounding(
      goodTier([
        ...baseLabour,
        {
          description: 'Dux Proflo 315L electric storage HWS',
          quantity: 2,
          unit: 'each',
          unit_price_ex_gst: 2105.6,
          source: 'material:mat-dux-proflo-315',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(true)
  })

  it('does NOT price-only-anchor when two distinct rows share the same price (ambiguous → no flag)', () => {
    // Two distinct rows priced IDENTICALLY at $500. A line at $500 maps to
    // BOTH ids → ambiguous → price-only resolver returns null → no dedup
    // flag. The line still grounds via the loose price+category path.
    const twinPriced = buildCandidatePrices(
      [
        { id: 'mat-tap-a', name: 'Methven kitchen mixer', price: 500, category: 'tap' },
        { id: 'mat-tap-b', name: 'Phoenix kitchen mixer', price: 500, category: 'tap' },
      ],
      [],
      pricingBook,
    )
    const r = validateQuoteGrounding(
      goodTier([
        ...baseLabour,
        {
          description: 'Kitchen mixer tap A',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 500, // matches BOTH rows → ambiguous, no anchor
          source: 'material',
        },
        {
          description: 'Kitchen mixer tap B',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 500,
          source: 'material',
        },
      ]),
      pricingBook,
      twinPriced,
    )
    // No D-1 dedup failure — the two lines could be two different taps.
    if (!r.valid) {
      expect(r.failures.some((f) => f.expected.includes('D-1 dedup'))).toBe(false)
    }
  })

  it('does NOT flag a labour line that shares a price with a material row (R5 false-positive fix)', () => {
    // A $110/hr labour line and a catalogue material row priced at $110 in
    // the same tier. Pre-fix the price-only anchor could map the labour line
    // (unit 'hr', source 'labour') onto the same-priced material row, so D-1
    // flagged the genuine labour line as a duplicate → needless inspection.
    // resolveLineAnchor now short-circuits non-catalogue lines (unit 'hr' or a
    // labour/callout/after-hours source) to null BEFORE the price-only
    // fallback, so the labour line never anchors to a catalogue row.
    const cheapBook: PricingBookForValidation = {
      hourly_rate: 110,
      apprentice_rate: 80,
      call_out_minimum: 160,
      default_markup_pct: 0, // raw price only — material row stays at $110
      min_labour_hours: 2,
    }
    const collidingCandidates = buildCandidatePrices(
      // A material row whose RAW price equals the $110/hr labour rate.
      [{ id: 'mat-clamp', name: 'Heavy-duty cable clamp kit', price: 110, category: 'general' }],
      [],
      cheapBook,
    )
    const r = validateQuoteGrounding(
      goodTier([
        {
          description: 'Electrician labour',
          quantity: 3,
          unit: 'hr',
          unit_price_ex_gst: 110, // same dollar amount as the material row
          source: 'labour',
        },
        {
          description: 'Heavy-duty cable clamp kit',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 110,
          source: 'material:mat-clamp',
        },
      ]),
      cheapBook,
      collidingCandidates,
    )
    // The labour line must NOT be reported as a duplicate of the material row.
    if (!r.valid) {
      expect(r.failures.some((f) => f.expected.includes('D-1 dedup'))).toBe(false)
    }
    // And the whole quote should ground cleanly — both lines are legitimate.
    expect(r.valid).toBe(true)
  })

  it('does NOT flag an after-hours-source line that shares a price with a material row', () => {
    // An after-hours call-out line (source 'after_hours_callout', unit 'each')
    // priced at a value that coincides with a catalogue material row. The
    // non-catalogue source short-circuits to null → no anchor → no dup flag.
    const book: PricingBookForValidation = {
      hourly_rate: 100,
      apprentice_rate: 70,
      call_out_minimum: 150,
      default_markup_pct: 0,
      min_labour_hours: 3,
      after_hours_multiplier: 2,
    }
    const cands = buildCandidatePrices(
      [{ id: 'mat-misc', name: 'Misc consumables pack', price: 300, category: 'sundry' }],
      [],
      book,
    )
    const r = validateQuoteGrounding(
      goodTier([
        {
          description: 'After-hours call-out',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 300, // 150 × 2 — same $ as the $300 material row
          source: 'after_hours_callout',
        },
        {
          description: 'After-hours labour',
          quantity: 3,
          unit: 'hr',
          unit_price_ex_gst: 200, // 100 × 2
          source: 'after_hours',
        },
        {
          description: 'Misc consumables pack',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 300,
          source: 'material:mat-misc',
        },
      ]),
      book,
      cands,
    )
    if (!r.valid) {
      expect(r.failures.some((f) => f.expected.includes('D-1 dedup'))).toBe(false)
    }
    expect(r.valid).toBe(true)
  })

  it('still catches the original raw-vs-UUID shape (D-1 regression)', () => {
    const r = validateQuoteGrounding(
      goodTier([
        ...baseLabour,
        {
          description: 'Dux Proflo 315L electric storage HWS',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 1645,
          source: 'material',
        },
        {
          description: 'Dux Proflo 315L electric storage HWS (supplied)',
          quantity: 1,
          unit: 'each',
          unit_price_ex_gst: 2105.6,
          source: 'material:mat-dux-proflo-315',
        },
      ]),
      pricingBook,
      candidates,
    )
    expect(r.valid).toBe(false)
  })
})
