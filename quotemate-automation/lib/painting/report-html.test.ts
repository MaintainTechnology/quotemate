// Spec specs/quote-visual-parity.md R2 — the painting quote PDF carries the
// same property imagery the customer/tradie pages show: the Street View
// frontage and (when already cached) the AI repaint preview, plus the live
// customer-quote link.

import { describe, it, expect } from 'vitest'
import { buildPaintingQuoteReportHtml, type PaintingReportInput } from './report-html'
import type { PaintingEstimate } from './types'

function fixtureEstimate(): PaintingEstimate {
  return {
    price: {
      routing: { decision: 'auto', reason: null },
      confidence: 'medium',
      total_area_m2: 210,
      manual_override: false,
      loadings_applied: [],
      tiers: [
        { tier: 'good', label: 'Fresh coat', inc_gst: 4200, inc_gst_low: 3900, inc_gst_high: 4600, scope: 'Two coats, prepared surfaces.' },
        { tier: 'better', label: 'Full prep + premium', inc_gst: 5200, inc_gst_low: 4800, inc_gst_high: 5700, scope: 'Full prep, premium paint.' },
        { tier: 'best', label: 'Premium system', inc_gst: 6400, inc_gst_low: 6000, inc_gst_high: 7000, scope: 'Three-coat premium system.' },
      ],
      breakdown: {
        surfaces: [
          { scope: 'walls', quantity: 180, unit: 'm2', rate_per_unit: 18, line_ex_gst: 3240 },
          { scope: 'trim', quantity: 40, unit: 'lm', rate_per_unit: 9, line_ex_gst: 360 },
        ],
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
    expect(html).toContain('Surfaces measured')
    expect(html).toContain('Interior walls')
  })

  it('carries the live customer-quote link in the closing line when passed', () => {
    const html = buildPaintingQuoteReportHtml({
      ...base,
      quoteViewUrl: 'https://www.quotemax.com.au/q/paint/tok123',
    })
    expect(html).toContain('https://www.quotemax.com.au/q/paint/tok123')
  })
})
