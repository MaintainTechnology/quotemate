// Tradie manual line items (specs/tradie-manual-line-items.md).
//
// A line the tradie explicitly adds as a custom/manual line carries
// source: 'tradie_manual' and is grounded by the human, not the catalogue.
// validateQuoteGrounding must (a) accept such a line at ANY price, and (b)
// never treat it as a within-tier or cross-tier duplicate of a catalogue row
// on a coincidental price match — while a NON-manual catalogue line at an
// off-catalogue price still fails exactly as before.

import { describe, expect, it } from 'vitest'
import {
  validateQuoteGrounding,
  buildCandidatePrices,
  isManualLine,
  type PricingBookForValidation,
} from './validate'

const pricingBook: PricingBookForValidation = {
  hourly_rate: 110,
  apprentice_rate: 60,
  call_out_minimum: 150,
  default_markup_pct: 28,
  min_labour_hours: 2,
}

// A real catalogue row priced at $25 raw → $32 at 28% markup. The `id` lets
// buildCandidatePrices index it so the anchor/dedup passes can resolve a
// catalogue line to it (needed by the duplicate-collision tests below).
const candidates = buildCandidatePrices(
  [{ id: 'gpo-1', name: 'Standard double GPO', price: 25, category: 'gpo' }],
  [],
  pricingBook,
)

// A grounded labour line so every tier clears the min-labour floor; the tests
// add the manual / catalogue line under test on top of it.
const labour = {
  description: 'Install works',
  quantity: 2,
  unit: 'hr',
  unit_price_ex_gst: 110,
}

describe('isManualLine', () => {
  it('matches the tradie_manual sentinel case-insensitively', () => {
    expect(isManualLine({ source: 'tradie_manual' })).toBe(true)
    expect(isManualLine({ source: '  TRADIE_MANUAL  ' })).toBe(true)
    expect(isManualLine({ source: 'material:abc123' })).toBe(false)
    expect(isManualLine({ source: 'tradie_edit' })).toBe(false)
    expect(isManualLine({})).toBe(false)
  })
})

describe('manual line grounding exemption', () => {
  it('accepts a manual line at an arbitrary off-catalogue price (incl. $0)', () => {
    const draft = {
      good: {
        line_items: [
          labour,
          {
            description: 'Remove existing hot water system',
            quantity: 1,
            unit: 'item',
            unit_price_ex_gst: 0,
            source: 'tradie_manual',
          },
          {
            description: 'Supply & install 2x skylights',
            quantity: 1,
            unit: 'item',
            unit_price_ex_gst: 1850,
            source: 'tradie_manual',
          },
        ],
      },
      better: null,
      best: null,
    }
    const r = validateQuoteGrounding(draft, pricingBook, candidates)
    expect(r.valid).toBe(true)
  })

  it('does not flag a manual line as a within-tier duplicate of a catalogue row at the same price', () => {
    const draft = {
      good: {
        line_items: [
          labour,
          // Genuine catalogue GPO at its marked-up price ($32), anchored by id.
          {
            description: 'Standard double GPO',
            quantity: 1,
            unit: 'each',
            unit_price_ex_gst: 32,
            source: 'material:gpo-1',
          },
          // Manual line that COINCIDENTALLY costs $32 — must not anchor to the
          // GPO row and must not be flagged as a duplicate.
          {
            description: 'Custom bracket fabrication',
            quantity: 1,
            unit: 'item',
            unit_price_ex_gst: 32,
            source: 'tradie_manual',
          },
        ],
      },
      better: null,
      best: null,
    }
    const r = validateQuoteGrounding(draft, pricingBook, candidates)
    expect(r.valid).toBe(true)
  })

  it('does not flag manual lines across tiers as a cross-tier duplicate on a price collision', () => {
    // Same price ($32 = the catalogue GPO), differing quantities across tiers,
    // no scope framing — pre-fix this would anchor both to the GPO row and
    // raise an R6 cross-tier duplicate. Manual lines must never anchor.
    const draft = {
      good: {
        line_items: [
          labour,
          {
            description: 'Custom bracket',
            quantity: 1,
            unit: 'item',
            unit_price_ex_gst: 32,
            source: 'tradie_manual',
          },
        ],
      },
      better: {
        line_items: [
          labour,
          {
            description: 'Custom bracket',
            quantity: 3,
            unit: 'item',
            unit_price_ex_gst: 32,
            source: 'tradie_manual',
          },
        ],
      },
      best: null,
    }
    const r = validateQuoteGrounding(draft, pricingBook, candidates)
    expect(r.valid).toBe(true)
  })

  it('still fails a NON-manual line at an off-catalogue price', () => {
    const draft = {
      good: {
        line_items: [
          labour,
          // Same description/price a manual line would carry, but NOT tagged
          // manual → must still fail grounding (no catalogue derivation).
          {
            description: 'Supply & install 2x skylights',
            quantity: 1,
            unit: 'each',
            unit_price_ex_gst: 1850,
          },
        ],
      },
      better: null,
      best: null,
    }
    const r = validateQuoteGrounding(draft, pricingBook, candidates)
    expect(r.valid).toBe(false)
  })
})
