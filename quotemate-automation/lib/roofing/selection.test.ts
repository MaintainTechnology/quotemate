// Unit tests for the persisted roofing structure selection (migration 140).
// Covers the spec edge cases: out-of-range indices ignored, an intersection
// that would empty the set keeps the wider set (never shows nothing), the
// selection never WIDENS past what the tradie included, the denormalised
// summary reflects only the included structures, and a NULL/empty selection
// resolves to the ROOF-ONLY default (main dwelling) — not all structures.

import { describe, it, expect } from 'vitest'
import {
  allStructureIndices,
  sanitizeIndices,
  resolveEffectiveIndices,
  denormFromSelection,
  structureCount,
  primaryStructureIndices,
  defaultStructureIndices,
  combinedTotalsForIndices,
  partitionRoofQuote,
} from './selection'
import { narrowQuoteToStructures } from '@/lib/sms/roofing-compose'
import type { MultiRoofQuote, RoofStructurePrice, RoofStructureRole } from './types'

function tier(name: 'good' | 'better' | 'best', ex: number) {
  return { tier: name, label: name, ex_gst: ex, inc_gst: Math.round(ex * 1.1 * 100) / 100, scope: name }
}

function struct(role: RoofStructureRole, area: number, base: number): RoofStructurePrice {
  return {
    buildingId: `b-${area}`,
    role,
    label: role === 'primary' ? 'Main dwelling' : 'Shed',
    metrics: {
      footprint_m2: area,
      sloped_area_m2: area,
      storeys: 1,
      form: 'hip',
      hips: 2,
      valleys: 1,
      ridge_lm: 10,
      polygon_geojson: null,
      capture_date: null,
    },
    inputs: { material: 'colorbond_trimdek', pitch: 'standard', intent: 'full_reroof' },
    price: {
      area_m2: area,
      effective_rate_per_m2: base / area,
      tiers: [tier('good', base * 0.5), tier('better', base), tier('best', base * 1.5)],
      loadings_applied: [],
      routing: { decision: 'tradie_review', reason: 'ok' },
    },
  }
}

const quote: MultiRoofQuote = {
  structures: [struct('primary', 100, 1000), struct('secondary', 40, 400), struct('secondary', 20, 200)],
  combined: { area_m2: 160, tiers: [tier('good', 800), tier('better', 1600), tier('best', 2400)] },
  routing: { decision: 'tradie_review', reason: 'ok' },
  inspection_structures: [],
}

describe('allStructureIndices', () => {
  it('is 1-based and length n', () => {
    expect(allStructureIndices(3)).toEqual([1, 2, 3])
    expect(allStructureIndices(0)).toEqual([])
  })
})

describe('sanitizeIndices', () => {
  it('drops out-of-range, non-integer and duplicate indices; sorts ascending', () => {
    expect(sanitizeIndices([3, 1, 1, 0, 4, 2.5, -1], 3)).toEqual([1, 3])
  })
  it('treats null/undefined as empty', () => {
    expect(sanitizeIndices(null, 3)).toEqual([])
    expect(sanitizeIndices(undefined, 3)).toEqual([])
  })
})

describe('structureCount', () => {
  it('counts structures off the quote, 0 when absent', () => {
    expect(structureCount(quote)).toBe(3)
    expect(structureCount(null)).toBe(0)
  })
})

describe('resolveEffectiveIndices', () => {
  it('null/empty included → roof-only default (main dwelling only)', () => {
    expect(resolveEffectiveIndices({ included: null }, quote)).toEqual([1])
    expect(resolveEffectiveIndices({ included: [] }, quote)).toEqual([1])
    // an out-of-range-only selection sanitizes to empty → same default
    expect(resolveEffectiveIndices({ included: [99] }, quote)).toEqual([1])
  })
  it('uses the persisted selection as the base', () => {
    expect(resolveEffectiveIndices({ included: [1, 3] }, quote)).toEqual([1, 3])
  })
  it('a ?s= param narrows but never widens past the selection', () => {
    // selection is [1,3]; param asks for 2 (excluded) + 3 → only 3 survives
    expect(resolveEffectiveIndices({ included: [1, 3], paramIndices: [2, 3] }, quote)).toEqual([3])
    // param asks for 2 only (not in selection) → intersection empty → keep base
    expect(resolveEffectiveIndices({ included: [1, 3], paramIndices: [2] }, quote)).toEqual([1, 3])
  })
  it('a customer single-pick narrows the customer view', () => {
    expect(resolveEffectiveIndices({ included: [1, 2, 3], confirmedStructure: 2 }, quote)).toEqual([2])
  })
  it('a confirmed pick outside the selection is ignored (keeps the wider set)', () => {
    expect(resolveEffectiveIndices({ included: [1, 3], confirmedStructure: 2 }, quote)).toEqual([1, 3])
  })
  it('empty/absent quote → []', () => {
    expect(resolveEffectiveIndices({ included: null }, { ...quote, structures: [] })).toEqual([])
    expect(resolveEffectiveIndices({ included: [1, 2] }, null)).toEqual([])
  })
})

describe('denormFromSelection', () => {
  it('sums only the included structures', () => {
    const d = denormFromSelection(quote, [1, 3]) // 100 + 20 = 120 m²; better 1000 + 200 = 1200 ex → inc
    expect(d.structure_count).toBe(2)
    expect(d.combined_area_m2).toBe(120)
    expect(d.combined_better_inc_gst).toBe(Math.round(1200 * 1.1 * 100) / 100)
  })
  it('empty/null selection falls back to the roof-only default (main dwelling)', () => {
    const d = denormFromSelection(quote, null)
    expect(d.structure_count).toBe(1)
    expect(d.combined_area_m2).toBe(100)
  })
})

describe('defaultStructureIndices (read-time fallback)', () => {
  it('is the roof-only default — the main dwelling only', () => {
    expect(defaultStructureIndices(quote)).toEqual([1])
  })
  it('empty / null quote → []', () => {
    expect(defaultStructureIndices({ ...quote, structures: [] })).toEqual([])
    expect(defaultStructureIndices(null)).toEqual([])
  })
})

// ── roofing-quote-total-parity spec ─────────────────────────────────────

/** A secondary structure routed to inspection (priced shape kept for tests). */
function inspectionStruct(area: number, base: number): RoofStructurePrice {
  const s = struct('secondary', area, base)
  return { ...s, price: { ...s.price, routing: { decision: 'inspection_required', reason: 'asbestos' } } }
}

describe('primaryStructureIndices (roof-only default)', () => {
  it('is just the primary structure, 1-based', () => {
    expect(primaryStructureIndices(quote)).toEqual([1])
  })
  it('falls back to the first structure when no explicit primary', () => {
    const noPrimary: MultiRoofQuote = {
      ...quote,
      structures: [struct('secondary', 10, 100), struct('secondary', 20, 200)],
    }
    expect(primaryStructureIndices(noPrimary)).toEqual([1])
  })
  it('empty / null quote → []', () => {
    expect(primaryStructureIndices({ ...quote, structures: [] })).toEqual([])
    expect(primaryStructureIndices(null)).toEqual([])
  })
})

describe('combinedTotalsForIndices (the one canonical total)', () => {
  it('sums only the included structures', () => {
    const t = combinedTotalsForIndices(quote, [1, 3]) // better ex 1000 + 200 = 1200
    expect(t.count).toBe(2)
    expect(t.exGst[1]).toBe(1200)
    expect(t.incGst[1]).toBe(Math.round(1200 * 1.1 * 100) / 100)
  })
  it('empty / invalid selection totals zero', () => {
    expect(combinedTotalsForIndices(quote, [])).toEqual({
      count: 0,
      area: 0,
      exGst: [0, 0, 0],
      incGst: [0, 0, 0],
    })
  })
  it('lists an inspection-routed structure as included but never prices it in', () => {
    const q: MultiRoofQuote = {
      ...quote,
      structures: [struct('primary', 100, 1000), inspectionStruct(40, 400)],
    }
    const t = combinedTotalsForIndices(q, [1, 2])
    expect(t.count).toBe(2) // both included
    expect(t.exGst[1]).toBe(1000) // only the primary is priced into the total
  })
})

describe('partitionRoofQuote', () => {
  it('tags every structure priced / inspection / excluded and narrows the total', () => {
    const q: MultiRoofQuote = {
      ...quote,
      structures: [struct('primary', 100, 1000), inspectionStruct(40, 400), struct('secondary', 20, 200)],
    }
    const part = partitionRoofQuote(q, [1, 2]) // include primary + inspection shed, exclude #3
    expect(part.rows.map((r) => r.state)).toEqual(['priced', 'inspection', 'excluded'])
    // headline total = primary only (inspection not priced, #3 excluded)
    expect(part.narrowed.combined.tiers[1].ex_gst).toBe(1000)
    // excluded structure #3 is not in the narrowed (priced) set
    expect(part.narrowed.structures.length).toBe(2)
  })
  it('an empty selection falls back to the roof-only default (rows + total agree)', () => {
    const part = partitionRoofQuote(quote, [])
    // default = main dwelling only → #1 priced, secondaries excluded
    expect(part.rows.map((r) => r.state)).toEqual(['priced', 'excluded', 'excluded'])
    expect(part.narrowed.structures.length).toBe(1)
    expect(part.narrowed.combined.tiers[1].ex_gst).toBe(1000)
  })
})

describe('secondary marginal contribution (combined(included) − combined(primary-only))', () => {
  // The exact derivation MeasurementReview uses for the secondaries' $ line —
  // always through the canonical helper, never a free-form re-sum.
  function secondaryDeltaExBetter(included: number[], q: MultiRoofQuote = quote): number {
    const primary = primaryStructureIndices(q)
    const all = combinedTotalsForIndices(q, included)
    const base = combinedTotalsForIndices(q, included.filter((i) => primary.includes(i)))
    return all.exGst[1] - base.exGst[1]
  }
  it('equals the summed secondary tiers when all secondaries are quotable', () => {
    // better ex: primary 1000 + 400 + 200 = 1600; base (primary only) 1000 → +600
    expect(secondaryDeltaExBetter([1, 2, 3])).toBe(600)
  })
  it('is 0 when no secondaries are included', () => {
    expect(secondaryDeltaExBetter([1])).toBe(0)
  })
  it('is 0 when the only included secondary is inspection-routed', () => {
    const q: MultiRoofQuote = {
      ...quote,
      structures: [struct('primary', 100, 1000), inspectionStruct(40, 400)],
    }
    // inspection shed is included but never priced into the headline → +0
    expect(secondaryDeltaExBetter([1, 2], q)).toBe(0)
  })
})

describe('cross-surface parity (PDF == customer page == dashboard preview)', () => {
  it('the canonical total equals the narrowed customer/PDF total for the same selection', () => {
    const idx = [1, 3] // exclude structure #2
    const dashboard = combinedTotalsForIndices(quote, idx)
    const customerPdf = narrowQuoteToStructures(quote, idx).combined
    expect(dashboard.incGst).toEqual([
      customerPdf.tiers[0].inc_gst,
      customerPdf.tiers[1].inc_gst,
      customerPdf.tiers[2].inc_gst,
    ])
    expect(dashboard.exGst).toEqual([
      customerPdf.tiers[0].ex_gst,
      customerPdf.tiers[1].ex_gst,
      customerPdf.tiers[2].ex_gst,
    ])
  })
})
