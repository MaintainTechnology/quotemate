// Unit tests for the customer quote PDF HTML (migration 105) — tier
// rendering, inc-GST rounding parity with the SMS template, escaping.

import { describe, it, expect } from 'vitest'
import { buildQuoteReportHtml, incGst, type QuoteReportTier } from './report-html'
import { resolveVisibleTiers, type QuoteTierMode } from './tier-visibility'

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

// Spec quote-pdf-logo-fix — the electrical/plumbing builder must surface the
// tenant logo (it flows branding → renderReportDocument) and fall back to the
// business-name wordmark when no logo is configured, without throwing.
describe('buildQuoteReportHtml — tenant logo (electrical/plumbing)', () => {
  it('renders the tenant logo when branding.logoSrc is set', () => {
    const html = buildQuoteReportHtml({
      businessName: 'Atomic Electrical',
      branding: { businessName: 'Atomic Electrical', logoSrc: 'data:image/png;base64,BBBB' },
      jobType: 'downlights',
      good: tier('Budget', 498),
      better: null,
      best: null,
    })
    expect(html).toContain('class="logo"')
    expect(html).toContain('data:image/png;base64,BBBB')
    expect(html).not.toContain('class="wordmark"')
  })

  it('falls back to the business-name wordmark when no logo is set', () => {
    const html = buildQuoteReportHtml({
      businessName: 'Oakcrest Electrical',
      jobType: 'downlights',
      good: tier('Budget', 498),
      better: null,
      best: null,
    })
    expect(html).toContain('class="wordmark"')
    expect(html).toContain('Oakcrest Electrical')
    expect(html).not.toContain('class="logo"')
  })
})

// Mig 146 — the eyebrow / intro / heading wording follows the number of VISIBLE
// tiers (the PDF service has already filtered good/better/best to the tenant's
// Pricing-settings tier mode). One tier reads as a single quote with NO
// "Good / Better / Best"; two or more keeps the tiered framing.
describe('buildQuoteReportHtml — tier-count-aware wording (mig 146)', () => {
  it('a single visible tier drops all "Good / Better / Best" wording', () => {
    const html = buildQuoteReportHtml({
      businessName: 'Oakcrest Electrical',
      jobType: 'downlights',
      good: tier('Standard LED', 558),
      better: null,
      best: null,
    })
    // Headline still shows the one priced tier...
    expect(html).toContain('GOOD')
    // ...but none of the multi-tier framing.
    expect(html).not.toContain('Good / Better / Best')
    expect(html).toContain('<h2>Your quote</h2>')
    expect(html).not.toContain('<h2>Your options</h2>')
  })

  it('two or more visible tiers keep the Good / Better / Best framing', () => {
    const html = buildQuoteReportHtml({
      businessName: 'Oakcrest Electrical',
      jobType: 'downlights',
      good: tier('Standard LED', 558),
      better: tier('Tri-colour LED', 720),
      best: null,
      selectedTier: 'better',
    })
    expect(html).toContain('Good / Better / Best')
    expect(html).toContain('<h2>Your options</h2>')
    expect(html).not.toContain('<h2>Your quote</h2>')
  })
})

// Mig 146 — the PDF must render EXACTLY the tiers the tenant's mode resolves to.
// This mirrors how lib/quote/pdf.ts filters good/better/best by
// resolveVisibleTiers before calling the builder, across every tier mode.
describe('buildQuoteReportHtml — renders exactly resolveVisibleTiers(...) (mig 146)', () => {
  const priced = {
    good: tier('Standard', 600),
    better: tier('Mid', 800),
    best: tier('Premium', 1100),
  }
  const present = { good: true, better: true, best: true }
  const cases: Array<{
    mode: QuoteTierMode
    selected: 'good' | 'better' | 'best'
    show: string[]
    hide: string[]
  }> = [
    { mode: 'single', selected: 'better', show: ['BETTER'], hide: ['GOOD', 'BEST'] },
    { mode: 'good', selected: 'better', show: ['GOOD'], hide: ['BETTER', 'BEST'] },
    { mode: 'best', selected: 'better', show: ['BEST'], hide: ['GOOD', 'BETTER'] },
    { mode: 'good_better_best', selected: 'better', show: ['GOOD', 'BETTER', 'BEST'], hide: [] },
  ]
  for (const c of cases) {
    it(`mode '${c.mode}' renders exactly ${JSON.stringify(c.show)}`, () => {
      const keys = resolveVisibleTiers({ mode: c.mode, present, selectedTier: c.selected })
      const set = new Set(keys)
      const html = buildQuoteReportHtml({
        businessName: 'T',
        jobType: 'downlights',
        good: set.has('good') ? priced.good : null,
        better: set.has('better') ? priced.better : null,
        best: set.has('best') ? priced.best : null,
        selectedTier: keys.length > 1 ? c.selected : null,
      })
      for (const marker of c.show) expect(html).toContain(marker)
      for (const marker of c.hide) expect(html).not.toContain(marker)
    })
  }
})
