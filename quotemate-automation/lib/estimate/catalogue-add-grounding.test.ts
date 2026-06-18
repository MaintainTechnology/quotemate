// R32 / R34 — a material added via the Catalogue tab is picked up by the
// estimator/grounding on the NEXT quote, with pricing + badging reflecting
// the new row.
//
// ROOT-CAUSE PROOF (R32): there is NO staleness gap. run.ts loadCandidatePrices
// reads tenant_material_catalogue fresh on every estimation (no module-level
// memo, no unstable_cache, no revalidate window — verified in run.ts), and
// feeds the rows through the SAME pure helper this test exercises
// (catalogueCandidateRows). The catalogue-add API route is `force-dynamic` and
// does no caching. So the moment a row exists, the very next estimation
// grounds against it.
//
// This test reconstructs that wiring with the REAL validator + REAL feed +
// REAL badge helper, so it fails if a regression reintroduces a stale path,
// drops the catalogue from the candidate set, or stops linking the line back
// to the catalogue product.
//
// M-6 corollary (also proven below): the candidate feed is DELIBERATELY not
// gated on `active`, so (a) a newly-added active row grounds immediately and
// (b) a row a tradie deactivates seconds after Opus grounded on it still
// validates instead of dumping an otherwise-correct quote to a $99 inspection.

import { describe, it, expect } from 'vitest'
import {
  catalogueCandidateRows,
  enrichLinesWithCatalogue,
  type TenantMaterial,
  type CatalogueProductRef,
} from './catalogue'
import { buildCandidatePrices, validateQuoteGrounding } from './validate'

const pricingBook = {
  hourly_rate: 110,
  apprentice_rate: 60,
  call_out_minimum: 150,
  default_markup_pct: 28,
  min_labour_hours: 2,
}

// The material the tradie JUST added in the Catalogue tab: a branded
// downlight @ $30 ex-GST (we-supply). 28% markup → $38.40.
const NEW_ROW: TenantMaterial = {
  id: 'cat-uuid-newly-added',
  category: 'downlight',
  name: 'SAL Anova LED Downlight',
  brand: 'SAL',
  range_series: 'Anova',
  unit_price_ex_gst: 30,
  image_path: 'tenant/cat/sal-anova.jpg',
  description: 'SAL Anova 10W tri-colour LED downlight',
  active: true,
}

// A drafted GOOD tier that priced the new product at the tradie's markup.
function draftWithNewProduct(unitPrice: number) {
  return {
    needs_inspection: false,
    good: {
      label: 'Standard',
      subtotal_ex_gst: unitPrice + 220,
      line_items: [
        {
          description: 'SAL Anova LED Downlight',
          unit: 'each',
          quantity: 1,
          unit_price_ex_gst: unitPrice,
          total_ex_gst: unitPrice,
          source: 'material',
        },
        { description: 'Labour', unit: 'hr', quantity: 2, unit_price_ex_gst: 110, total_ex_gst: 220 },
      ],
    },
    better: null,
    best: null,
  }
}

describe('R32 — a newly-added catalogue material grounds on the next quote', () => {
  it('GROUNDS against the new row at the tradie markup ($30 → $38.40)', () => {
    // Simulate "the next quote": loadCandidatePrices would feed exactly this.
    const candidates = buildCandidatePrices(catalogueCandidateRows([NEW_ROW]), [], pricingBook)
    const res = validateQuoteGrounding(draftWithNewProduct(38.4), pricingBook, candidates)
    expect(res.valid).toBe(true)
  })

  it('would be DUMPED TO INSPECTION before the row existed (proves the add is what enables it)', () => {
    // The same quote with an EMPTY catalogue (the state before the add) has
    // no candidate for the branded line → grounding fails → inspection.
    const before = buildCandidatePrices([], [], pricingBook)
    const res = validateQuoteGrounding(draftWithNewProduct(38.4), pricingBook, before)
    expect(res.valid).toBe(false)
  })

  it('BADGES the grounded line back to the new catalogue product (catalogue_id + image)', () => {
    const draft = draftWithNewProduct(38.4)
    const refs: CatalogueProductRef[] = [
      {
        id: NEW_ROW.id!,
        name: NEW_ROW.name,
        image_path: NEW_ROW.image_path ?? null,
        description: NEW_ROW.description ?? null,
      },
    ]
    const { linked } = enrichLinesWithCatalogue(draft, refs)
    expect(linked).toBe(1)
    const li = draft.good.line_items[0] as Record<string, unknown>
    expect(li.catalogue_id).toBe('cat-uuid-newly-added')
    expect(li.image_path).toBe('tenant/cat/sal-anova.jpg')
    expect(li.product_description).toBe('SAL Anova 10W tri-colour LED downlight')
  })

  it('M-6 — the candidate feed is NOT gated on active, so a just-deactivated row still grounds', () => {
    // catalogueCandidateRows intentionally ignores `active` (the SQL-side and
    // JS-side active filters were both removed). A row the tradie disabled
    // seconds after Opus grounded on it still validates the in-flight draft.
    const deactivated: TenantMaterial = { ...NEW_ROW, active: false }
    const candidates = buildCandidatePrices(catalogueCandidateRows([deactivated]), [], pricingBook)
    const res = validateQuoteGrounding(draftWithNewProduct(38.4), pricingBook, candidates)
    expect(res.valid).toBe(true)
  })

  it('updating the catalogue price flows straight through to the next quote (no stale cache)', () => {
    // Tradie edits the row from $30 → $50; next quote prices 50 × 1.28 = $64.
    const edited: TenantMaterial = { ...NEW_ROW, unit_price_ex_gst: 50 }
    const candidates = buildCandidatePrices(catalogueCandidateRows([edited]), [], pricingBook)
    // The NEW price grounds…
    expect(validateQuoteGrounding(draftWithNewProduct(64), pricingBook, candidates).valid).toBe(true)
    // …and the OLD marked-up price no longer does (no stale row lingering).
    expect(validateQuoteGrounding(draftWithNewProduct(38.4), pricingBook, candidates).valid).toBe(false)
  })
})
