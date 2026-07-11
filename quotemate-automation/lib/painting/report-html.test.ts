// Spec specs/quote-visual-parity.md R2 — the painting quote PDF carries the
// same property imagery the customer/tradie pages show: the Street View
// frontage and (when already cached) the AI repaint preview, plus the live
// customer-quote link.

import { describe, it, expect } from 'vitest'
import { buildPaintingQuoteReportHtml, type PaintingReportInput } from './report-html'
import type { PaintingEstimate } from './types'

function fixtureEstimate(): PaintingEstimate {
  return {
    measurement: {
      floor_area_m2: 149,
      floor_area_source: 'footprint',
      storeys: 1,
      confidence: 'medium',
      surfaces: [],
      notes: [
        'Estimated from building footprint (149 m²) × 1 storey. Confirm storeys and internal area.',
        'Walls ≈ floor area × 2.8 (2.4 m ceilings, openings deducted).',
      ],
    },
    price: {
      routing: { decision: 'auto', reason: null },
      confidence: 'medium',
      total_area_m2: 210,
      manual_override: false,
      loadings_applied: [],
      call_out_minimum_applied: false,
      tiers: [
        { tier: 'good', label: 'Fresh coat', inc_gst: 4200, inc_gst_low: 3900, inc_gst_high: 4600, scope: 'Two coats, prepared surfaces.' },
        { tier: 'better', label: 'Full prep + premium', inc_gst: 5200, inc_gst_low: 4800, inc_gst_high: 5700, scope: 'Full prep, premium paint.' },
        { tier: 'best', label: 'Premium system', inc_gst: 6400, inc_gst_low: 6000, inc_gst_high: 7000, scope: 'Three-coat premium system.' },
      ],
      breakdown: {
        // Engine-consistent: line_ex_gst = quantity × rate × surfaceMult
        // (coats 1 × prep 1.05 × colour 1.1 = 1.155). The surface costs sum
        // EXACTLY to better_ex_gst (3742 + 416 = 4158).
        surfaces: [
          { scope: 'walls', quantity: 180, unit: 'm2', rate_per_unit: 18, line_ex_gst: 3742 },
          { scope: 'trim', quantity: 40, unit: 'lm', rate_per_unit: 9, line_ex_gst: 416 },
        ],
        coats_multiplier: 1,
        prep_multiplier: 1.05,
        colour_change_multiplier: 1.1,
        double_storey_multiplier: 1,
        better_ex_gst: 4158,
        good_refresh_fraction: 0.72,
        premium_uplift_pct: 0.28,
        gst_factor: 1.1,
        call_out_minimum_ex_gst: 450,
      },
    },
  } as unknown as PaintingEstimate
}

const base: PaintingReportInput = {
  businessName: 'Brush Bros',
  address: '28 Greens Rd, Coorparoo QLD 4151',
  estimate: fixtureEstimate(),
}

describe('buildPaintingQuoteReportHtml — property imagery (spec quote-visual-parity R2)', () => {
  it('renders the Street View and AI repaint figures when both srcs are provided', () => {
    const html = buildPaintingQuoteReportHtml({
      ...base,
      streetViewSrc: 'data:image/jpeg;base64,STREET',
      afterImageSrc: 'data:image/jpeg;base64,AFTER',
    })
    expect(html).toContain('data:image/jpeg;base64,STREET')
    expect(html).toContain('data:image/jpeg;base64,AFTER')
    expect(html).toContain('Front of the property · Google Street View')
    expect(html).toContain('Fresh repaint · AI preview')
    // Before/after organisation: the AI repaint pairs with the property
    // photo under its own heading (mirrors the /q/paint page layout).
    expect(html).toContain('See it in a new colour')
    expect(html).toContain('Today · Google Street View')
  })

  it('renders only the Street View figure when the AI image is not cached', () => {
    const html = buildPaintingQuoteReportHtml({
      ...base,
      streetViewSrc: 'data:image/jpeg;base64,STREET',
      afterImageSrc: null,
    })
    expect(html).toContain('data:image/jpeg;base64,STREET')
    expect(html).not.toContain('Fresh repaint · AI preview')
  })

  it('renders no figure markup when both srcs are absent (today’s output)', () => {
    const html = buildPaintingQuoteReportHtml(base)
    expect(html).not.toContain('Google Street View')
    expect(html).not.toContain('AI preview')
    // Existing content still present.
    expect(html).toContain('How your price was built')
    expect(html).toContain('Interior walls')
  })

  it('carries the live customer-quote link in the closing line when passed', () => {
    const html = buildPaintingQuoteReportHtml({
      ...base,
      quoteViewUrl: 'https://www.quotemax.com.au/q/paint/tok123',
    })
    expect(html).toContain('https://www.quotemax.com.au/q/paint/tok123')
  })

  it('renders the aerial figure when an aerialSrc is provided', () => {
    const html = buildPaintingQuoteReportHtml({
      ...base,
      streetViewSrc: 'data:image/jpeg;base64,STREET',
      aerialSrc: 'data:image/png;base64,AERIAL',
    })
    expect(html).toContain('data:image/png;base64,AERIAL')
    expect(html).toContain('Aerial view · Google Maps')
  })
})

describe('buildPaintingQuoteReportHtml — customer materials & time', () => {
  const withTakeoff = (): PaintingReportInput => ({
    ...base,
    estimate: {
      ...fixtureEstimate(),
      takeoff: {
        tiers: (['good', 'better', 'best'] as const).map((tier) => ({
          tier,
          products: [
            {
              product: 'wall_paint',
              litres: 47.5,
              litres_low: 42.5,
              litres_high: 52.5,
              packs: [
                { size_l: 15, count: 3 },
                { size_l: 4, count: 1 },
              ],
              cost_ex_gst: 686,
              note: 'internal',
            },
          ],
          sundries_ex_gst: 70.88,
          materials_ex_gst: 956.88,
          labour_hours: 143.8,
          labour_ex_gst: 12223,
          crew_size: 2,
          days_on_site: 10,
          margin_ex_gst: -1099.88,
          margin_pct: -0.091,
          sundries_note: 'internal',
          labour_note: 'internal $85/hr',
          margin_note: 'internal margin',
        })),
      },
    } as unknown as PaintingEstimate,
  })

  it('shows per-tier quantities and time on site — never internal costs or margin', () => {
    const html = buildPaintingQuoteReportHtml(withTakeoff())
    expect(html).toContain('Materials &amp; time on site')
    expect(html).toContain('Wall paint — 47.5 L (3×15 L + 1×4 L)')
    expect(html).toContain('≈10 days on site · 2 painters (143.8 h)')
    // The tradie-only internals must never reach the customer PDF (CSS
    // `margin:` properties are fine — assert on the data, not the word).
    expect(html).not.toContain('internal margin')
    expect(html).not.toContain('Margin (ex GST)')
    expect(html).not.toContain('$85/hr')
    expect(html).not.toContain('12,223')
    expect(html).not.toContain('956.88')
  })

  it('omits the section entirely for estimates without a take-off', () => {
    const html = buildPaintingQuoteReportHtml(base)
    expect(html).not.toContain('Materials &amp; time on site')
  })
})

describe('buildPaintingQuoteReportHtml — how the price was built (customer-safe)', () => {
  it('renders per-surface COSTS that sum to the subtotal, plus tier %, GST', () => {
    const html = buildPaintingQuoteReportHtml(base)
    expect(html).toContain('How your price was built')
    // Cost per surface (3742 + 416 = 4158 = subtotal). Area column, not Rate.
    expect(html).toContain('Interior walls')
    expect(html).toContain('$3,742')
    expect(html).toContain('$416')
    expect(html).toContain('Subtotal (ex GST)')
    expect(html).toContain('$4,158')
    expect(html).toContain('Area</th>')
    // Derivation tail (tiers reconcile: no floor here).
    expect(html).toContain('Fresh coat = Full prep + premium × 72%')
    expect(html).toContain('Premium system = Full prep + premium × 128%')
    expect(html).toContain('GST')
    expect(html).toContain('+ 10%')
    // NO false "quantity × base-rate → line" equation and NO separate
    // multiplier step (line_ex_gst already includes the multipliers).
    expect(html).not.toContain('$18/m²')
    expect(html).not.toContain('Rate</th>')
    expect(html).not.toContain('Coats · preparation · colour')
    expect(html).not.toContain('× 1 · 1.05 · 1.1')
  })

  it('suppresses the tier-% rows and shows the call-out row when the floor applied', () => {
    const est = fixtureEstimate() as unknown as { price: { call_out_minimum_applied: boolean } }
    est.price.call_out_minimum_applied = true
    const html = buildPaintingQuoteReportHtml({ ...base, estimate: est as unknown as PaintingEstimate })
    expect(html).toContain('Call-out minimum applied')
    expect(html).toContain('$450')
    // Tier-% rows would no longer reconcile once the floor overrode them.
    expect(html).not.toContain('= Full prep + premium ×')
  })

  it('suppresses the whole derivation after a manual tier edit', () => {
    const est = fixtureEstimate() as unknown as { price: { manual_override: boolean } }
    est.price.manual_override = true
    const html = buildPaintingQuoteReportHtml({ ...base, estimate: est as unknown as PaintingEstimate })
    expect(html).not.toContain('How your price was built')
    expect(html).not.toContain('$4,158')
  })

  it('still shows "How we measured" after a manual tier edit (page↔PDF parity)', () => {
    const est = fixtureEstimate() as unknown as { price: { manual_override: boolean } }
    est.price.manual_override = true
    const html = buildPaintingQuoteReportHtml({ ...base, estimate: est as unknown as PaintingEstimate })
    // Measurement provenance is independent of the price build and survives an
    // edit — the /q/paint page renders it standalone too.
    expect(html).toContain('How we measured')
    expect(html).toContain('Estimated from building footprint (149 m²) × 1 storey.')
  })
})

describe('buildPaintingQuoteReportHtml — tenant tier mode (mig 142)', () => {
  it('shows only the Better tier and no relation rows when visibleTierKeys is [better]', () => {
    const html = buildPaintingQuoteReportHtml({ ...base, visibleTierKeys: ['better'] })
    expect(html).toContain('Your option (inc GST)')
    expect(html).toContain('Full prep + premium') // Better label
    // The hidden tiers, their prices and their relation rows never appear.
    expect(html).not.toContain('Fresh coat') // Good label
    expect(html).not.toContain('Premium system') // Best label
    expect(html).not.toContain('= Full prep + premium ×')
    // Still shows the subtotal + GST for the visible (Better) tier.
    expect(html).toContain('Subtotal (ex GST)')
    expect(html).toContain('$4,158')
  })

  it('shows all three tiers and both relation rows when all are visible', () => {
    const html = buildPaintingQuoteReportHtml({ ...base, visibleTierKeys: ['good', 'better', 'best'] })
    expect(html).toContain('Your options (inc GST)')
    expect(html).toContain('Fresh coat')
    expect(html).toContain('Premium system')
    expect(html).toContain('Fresh coat = Full prep + premium × 72%')
  })

  it('defaults to all present tiers when visibleTierKeys is omitted', () => {
    const html = buildPaintingQuoteReportHtml(base)
    expect(html).toContain('Your options (inc GST)')
    expect(html).toContain('Fresh coat')
    expect(html).toContain('Premium system')
  })

  it('renders customer-safe measurement notes — tradie instructions stripped', () => {
    const html = buildPaintingQuoteReportHtml(base)
    expect(html).toContain('How we measured')
    expect(html).toContain('Estimated from building footprint (149 m²) × 1 storey.')
    expect(html).toContain('Walls ≈ floor area × 2.8 (2.4 m ceilings, openings deducted).')
    expect(html).not.toContain('Confirm storeys and internal area')
    expect(html).toContain('A painter confirms all measurements on site before works commence.')
  })
})
