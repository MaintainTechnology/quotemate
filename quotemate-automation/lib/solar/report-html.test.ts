import { describe, it, expect } from 'vitest'
import { buildSolarQuoteReportHtml } from './report-html'
import { buildSolarPremiumQuote } from './premium-quote'
import { DEFAULT_SOLAR_CONFIG } from './config'
import { STRING_OVERLAY_CAPTION } from './string-overlay'
import {
  SOLAR_PROJECTION_COPY,
  SOLAR_LAYOUT_COPY,
} from './compliance-copy'
import { makeFixtureEstimate } from './__fixtures__/estimate'

const BASE = {
  businessName: 'Pilot Sparky',
  address: '12 Test St, Camden NSW 2570',
  quoteViewUrl: 'https://example.test/q/solar/tok',
}

describe('buildSolarQuoteReportHtml — legacy (no premium)', () => {
  const html = buildSolarQuoteReportHtml({
    ...BASE,
    estimate: makeFixtureEstimate(),
  })

  it('renders tiers with the gross → STC → net subtraction', () => {
    expect(html).toContain('Less STC rebate (69 certificates @ $38)')
    expect(html).toContain('$9,216') // better net inc GST, rounded
  })

  it('contains no premium sections when premium is absent', () => {
    expect(html).not.toContain('Proposed panel layout')
    expect(html).not.toContain('20-year financial summary')
    expect(html).not.toContain('Environmental analysis')
  })
})

describe('buildSolarQuoteReportHtml — premium (spec §4.4)', () => {
  const estimate = makeFixtureEstimate()
  const premium = buildSolarPremiumQuote({
    estimate,
    config: DEFAULT_SOLAR_CONFIG,
    theme: 'light',
  })
  const html = buildSolarQuoteReportHtml({
    ...BASE,
    estimate,
    premium,
    staticMapUrl: 'https://example.test/api/solar/q/tok/static-map',
  })

  it('renders every premium section heading in spec order', () => {
    const order = [
      'Proposed panel layout',
      'Panel strings &amp; component markings',
      'Sun &amp; shade analysis',
      'Monthly production',
      'Assumed values',
      'Utility costs',
      '20-year financial summary',
      'Cumulative savings (25-year projection)',
      'Monthly bill comparison',
      'Environmental analysis',
      'Your options',
      'Assumptions',
    ]
    let last = -1
    for (const heading of order) {
      const idx = html.indexOf(heading)
      expect(idx, `missing or out-of-order: ${heading}`).toBeGreaterThan(last)
      last = idx
    }
  })

  it('embeds the deterministic overlay SVGs over the satellite image', () => {
    expect(html).toContain('https://example.test/api/solar/q/tok/static-map')
    // Layout rects + string polylines from the pure builders.
    expect(html).toContain('<rect x=')
    expect(html).toContain('<polyline points=')
  })

  it('carries the mandatory captions and projection disclaimer', () => {
    expect(html).toContain(STRING_OVERLAY_CAPTION)
    expect(html).toContain(SOLAR_LAYOUT_COPY)
    expect(html).toContain(SOLAR_PROJECTION_COPY)
  })

  it('shows the financial stat cards with AU formatting', () => {
    expect(html).toContain('Net present value')
    expect(html).toContain('Total ROI (20 yr)')
    expect(html).toContain('IRR')
  })

  it('assumed values include the config version', () => {
    expect(html).toContain('solar-config-2026-06-08')
  })

  it('degrades cleanly for a manual-path premium (no geometry)', () => {
    const manual = makeFixtureEstimate()
    manual.coverage_source = 'manual'
    manual.roof = {
      ...manual.roof,
      source: 'manual',
      panels: [],
      panel_size_m: null,
      carbon_offset_factor_kg_per_mwh: null,
    }
    const manualPremium = buildSolarPremiumQuote({
      estimate: manual,
      config: DEFAULT_SOLAR_CONFIG,
      theme: 'light',
    })
    const manualHtml = buildSolarQuoteReportHtml({
      ...BASE,
      estimate: manual,
      premium: manualPremium,
    })
    expect(manualHtml).not.toContain('Proposed panel layout')
    expect(manualHtml).not.toContain('Environmental analysis')
    // Financial + production sections still render.
    expect(manualHtml).toContain('20-year financial summary')
    expect(manualHtml).toContain('Monthly production')
  })
})
