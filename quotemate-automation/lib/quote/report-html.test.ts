// Unit tests for the customer quote PDF HTML (migration 105) — tier
// rendering, inc-GST rounding parity with the SMS template, escaping.

import { describe, it, expect } from 'vitest'
import { buildQuoteReportHtml, incGst, type QuoteReportTier } from './report-html'

const tier = (label: string, exGst: number): QuoteReportTier => ({
  label,
  subtotal_ex_gst: exGst,
  line_items: [
    { description: 'LED downlight 9W', quantity: 6, unit: 'each', unit_price_ex_gst: 28, total_ex_gst: 168 },
    { description: 'Install labour', quantity: 3, unit: 'hr', unit_price_ex_gst: 110, total_ex_gst: 330 },
  ],
})

describe('incGst', () => {
  it('matches the SMS template rounding (Math.round(ex * 1.1))', () => {
    expect(incGst(498)).toBe(548)
    expect(incGst('100')).toBe(110)
    expect(incGst('not-a-number')).toBe(0)
  })
})

describe('buildQuoteReportHtml', () => {
  const html = buildQuoteReportHtml({
    businessName: 'Pilot Sparky',
    customerName: 'Sam Smith',
    jobType: 'downlights',
    scopeOfWorks: 'Replace 6 existing downlights with new LEDs.',
    assumptions: ['Accessible ceiling space', 'Existing wiring serviceable'],
    estimatedTimeframe: 'half a day',
    good: tier('Budget LEDs', 498),
    better: tier('Mid-range LEDs', 598),
    best: tier('Premium LEDs <Clipsal>', 698),
    selectedTier: 'better',
    quoteViewUrl: 'https://example.com/q/tok123',
  })

  it('renders every tier with inc-GST headline prices', () => {
    expect(html).toContain('GOOD')
    expect(html).toContain('BETTER · RECOMMENDED')
    expect(html).toContain('BEST')
    expect(html).toContain('$548')
    expect(html).toContain('$658')
    expect(html).toContain('$768')
  })

  it('renders line items, scope, assumptions, and the view link', () => {
    expect(html).toContain('LED downlight 9W')
    expect(html).toContain('Replace 6 existing downlights')
    expect(html).toContain('Accessible ceiling space')
    expect(html).toContain('https://example.com/q/tok123')
    expect(html).toContain('Sam Smith')
    expect(html).toContain('Pilot Sparky')
  })

  it('escapes HTML in user-influenced strings', () => {
    expect(html).toContain('Premium LEDs &lt;Clipsal&gt;')
    expect(html).not.toContain('<Clipsal>')
  })

  it('drops missing tiers instead of rendering empty sections', () => {
    const single = buildQuoteReportHtml({
      businessName: 'Pilot Plumber',
      jobType: 'hot_water',
      good: tier('Replace like-for-like', 1400),
      better: null,
      best: null,
    })
    expect(single).toContain('GOOD')
    expect(single).not.toContain('BETTER')
    expect(single).not.toContain('BEST')
    expect(single).toContain('hot water')
  })
})
