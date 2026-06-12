import { describe, expect, it } from 'vitest'
import { DEFAULT_SOLAR_CONFIG } from '@/lib/solar/config'
import { buildPylonModelled } from './modelled'
import { buildPylonProposalHtml } from './proposal-html'
import { buildPylonQuoteTable, normalizePylonDesign } from './proposal'
import { PYLON_DESIGN_FIXTURE } from './__fixtures__/design'

const design = normalizePylonDesign(PYLON_DESIGN_FIXTURE)
const table = buildPylonQuoteTable(design)
const modelled = buildPylonModelled({
  design,
  state: 'VIC',
  config: DEFAULT_SOLAR_CONFIG,
  theme: 'light',
})

function build(overrides: Partial<Parameters<typeof buildPylonProposalHtml>[0]> = {}) {
  return buildPylonProposalHtml({
    businessName: 'Solar Safari Pty Ltd',
    title: design.title,
    address: '19 Parmesan Avenue, Glen Iris, Victoria, 3147',
    customerName: 'Hubert J. Farnsworth',
    design,
    table,
    modelled,
    snapshotUrl: 'https://app.example.com/api/pylon/q/tok/asset/snapshot',
    sldUrl: 'https://app.example.com/api/pylon/q/tok/asset/sld',
    siteInfoUrl: 'https://app.example.com/api/pylon/q/tok/asset/site-info',
    quoteViewUrl: 'https://app.example.com/q/pylon/tok',
    generatedAt: new Date('2026-06-12T00:00:00Z'),
    ...overrides,
  })
}

describe('buildPylonProposalHtml', () => {
  const html = build()

  it('is a complete standalone document', () => {
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('lang="en-AU"')
    expect(html).toContain('Solar Safari Pty Ltd')
    expect(html).toContain('Hubert J. Farnsworth')
  })

  it('renders the Pylon section order', () => {
    const order = [
      'Proposed panel layout',
      'Panel strings &amp; component markings',
      'System details',
      'Monthly production (modelled by QuoteMate)',
      'Utility costs',
      '20-year financial summary (modelled)',
      'Environmental analysis (modelled)',
      'Your quote',
      'Assumed values',
    ]
    let last = -1
    for (const heading of order) {
      const idx = html.indexOf(heading)
      expect(idx, heading).toBeGreaterThan(last)
      last = idx
    }
  })

  it('renders the verbatim quote table with rebate + summary figures', () => {
    expect(html).toContain('STCs')
    expect(html).toContain('$11,205.00')
    expect(html).toContain('\u2212$3,605.00')
    expect(html).toContain('$7,600.00')
    expect(html).toContain('$760.00') // deposit
    expect(html).toContain('verbatim')
  })

  it('embeds the cached asset URLs, never Pylon-hosted ones', () => {
    expect(html).toContain('/api/pylon/q/tok/asset/snapshot')
    expect(html).toContain('/api/pylon/q/tok/asset/sld')
    expect(html).not.toContain('getpylon.com/proposals')
    expect(html).not.toContain('static.getpylon.com/images')
  })

  it('lists components with datasheet identity when enriched', () => {
    expect(html).toContain('REC Solar TwinPeak 2 Series')
    expect(html).toContain('Sungrow Power Sun Access SH5K')
    expect(html).toContain('Sonnen Eco 8.10')
  })

  it('degrades: no assets, no modelled — quote table still renders', () => {
    const bare = build({ snapshotUrl: null, sldUrl: null, siteInfoUrl: null, modelled: null })
    expect(bare).not.toContain('Proposed panel layout')
    expect(bare).not.toContain('20-year financial summary')
    expect(bare).toContain('Your quote')
    expect(bare).toContain('$7,600.00')
  })

  it('escapes HTML in third-party strings', () => {
    const evil = build({ businessName: '<script>alert(1)</script>' })
    expect(evil).not.toContain('<script>alert(1)</script>')
    expect(evil).toContain('&lt;script&gt;')
  })
})
