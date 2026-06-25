// Unit tests for the roofing quote PDF HTML (migration 105).

import { describe, it, expect } from 'vitest'
import { buildRoofQuoteReportHtml } from './report-html'
import type { MultiRoofQuote } from './types'
import type { RoofDisplayRow } from './selection'

const tiers = [
  { tier: 'good', label: 'Patch / repair', ex_gst: 2000, inc_gst: 2200, scope: 'Patch the damaged sections.' },
  { tier: 'better', label: 'Re-roof', ex_gst: 18000, inc_gst: 19800, scope: 'Full re-roof in Colorbond.' },
  { tier: 'best', label: 'Upgrade', ex_gst: 24000, inc_gst: 26400, scope: 'Upgrade to premium Colorbond.' },
] as MultiRoofQuote['combined']['tiers']

const baseQuote = {
  structures: [
    {
      buildingId: 'bld-1',
      role: 'primary',
      label: 'Main dwelling',
      metrics: { sloped_area_m2: 210 },
      inputs: {},
      price: { tiers, routing: { decision: 'tradie_review', reason: 'standard job' } },
    },
    {
      buildingId: 'bld-2',
      role: 'secondary',
      label: 'Shed',
      metrics: { sloped_area_m2: 35 },
      inputs: {},
      price: { tiers, routing: { decision: 'inspection_required', reason: 'asbestos suspected' } },
    },
  ],
  combined: { area_m2: 245, tiers },
  routing: { decision: 'tradie_review', reason: 'standard job' },
  inspection_structures: ['Shed'],
} as unknown as MultiRoofQuote

describe('buildRoofQuoteReportHtml', () => {
  const html = buildRoofQuoteReportHtml({
    businessName: 'Apex Roofing',
    address: '12 Sample St, Brisbane QLD 4000',
    quote: baseQuote,
    quoteViewUrl: 'https://example.com/q/roof/tok',
  })

  it('renders combined tiers inc GST with the address and area', () => {
    expect(html).toContain('Apex Roofing')
    expect(html).toContain('12 Sample St, Brisbane QLD 4000')
    expect(html).toContain('~245 m²')
    expect(html).toContain('$19,800')
    expect(html).toContain('Patch / repair')
  })

  it('lists every structure and flags inspection-only ones', () => {
    expect(html).toContain('Main dwelling')
    expect(html).toContain('Shed')
    expect(html).toContain('needs on-site look')
    expect(html).toContain('https://example.com/q/roof/tok')
  })

  it('renders the inspection layout when the whole job routes to inspection', () => {
    const inspection = buildRoofQuoteReportHtml({
      businessName: 'Apex Roofing',
      address: '12 Sample St',
      quote: {
        ...baseQuote,
        routing: { decision: 'inspection_required', reason: 'Steep pitch needs a look.' },
      } as MultiRoofQuote,
    })
    expect(inspection).toContain('Inspection required')
    expect(inspection).toContain('Steep pitch needs a look.')
  })

  it('lists an EXCLUDED structure without pricing it when displayRows are provided', () => {
    // The tradie kept only the main dwelling; the shed is excluded — it must
    // still appear, marked "not included", and never carry a price.
    const displayRows = [
      { index1Based: 1, structure: baseQuote.structures[0], state: 'priced', included: true },
      { index1Based: 2, structure: baseQuote.structures[1], state: 'excluded', included: false },
    ] as unknown as RoofDisplayRow[]
    const html = buildRoofQuoteReportHtml({
      businessName: 'Apex Roofing',
      address: '12 Sample St',
      quote: baseQuote,
      displayRows,
    })
    expect(html).toContain('Shed')
    expect(html).toContain('not included in this quote')
  })

  // ── Per-structure aerial images (spec roofing-pdf-multi-structure-images) ──

  it('renders the outline hero + one captioned aerial per included structure (2 structures)', () => {
    const html = buildRoofQuoteReportHtml({
      businessName: 'Apex Roofing',
      address: '12 Sample St',
      quote: baseQuote,
      outlineImageSrc: 'data:image/svg+xml;base64,OUTLINE',
      structureImages: [
        { label: 'Main dwelling', src: 'data:image/jpeg;base64,AAA' },
        { label: 'Shed', src: 'data:image/jpeg;base64,BBB' },
      ],
    })
    expect(html).toContain('Roof outline traced from your measured roof areas.')
    expect(html).toContain('Main dwelling — aerial reference, measured from satellite imagery.')
    expect(html).toContain('Shed — aerial reference, measured from satellite imagery.')
    // Two per-structure aerial <img> data URIs are embedded.
    expect(html).toContain('data:image/jpeg;base64,AAA')
    expect(html).toContain('data:image/jpeg;base64,BBB')
  })

  it('keeps the unchanged outline-hero + aerial-thumb pair for a single structure', () => {
    const html = buildRoofQuoteReportHtml({
      businessName: 'Apex Roofing',
      address: '12 Sample St',
      quote: baseQuote,
      outlineImageSrc: 'data:image/svg+xml;base64,OUTLINE',
      mapImageSrc: 'data:image/jpeg;base64,AERIAL',
      structureImages: [{ label: 'Main dwelling', src: 'data:image/jpeg;base64,AAA' }],
    })
    // The figure-pair thumb caption is used; no per-structure aerial caption.
    expect(html).toContain('Aerial reference — measured from satellite imagery.')
    expect(html).not.toContain('— aerial reference, measured from satellite imagery.')
    expect(html).toContain('class="figure figure-pair"')
  })

  it('does not render an aerial figcaption for a structure that was excluded', () => {
    // Only the included structures are passed as aerials; the excluded Shed is
    // absent, so its label never appears as an aerial caption.
    const html = buildRoofQuoteReportHtml({
      businessName: 'Apex Roofing',
      address: '12 Sample St',
      quote: baseQuote,
      outlineImageSrc: 'data:image/svg+xml;base64,OUTLINE',
      structureImages: [
        { label: 'Main dwelling', src: 'data:image/jpeg;base64,AAA' },
        { label: 'Garage', src: 'data:image/jpeg;base64,CCC' },
      ],
    })
    expect(html).toContain('Main dwelling — aerial reference, measured from satellite imagery.')
    expect(html).toContain('Garage — aerial reference, measured from satellite imagery.')
    expect(html).not.toContain('Shed — aerial reference, measured from satellite imagery.')
  })
})

// Mig 148 — the customer roofing PDF honours the tenant's tier mode (dashboard
// Pricing settings). ensureRoofQuotePdf passes visibleTierKeys resolved from the
// mode; a single-price roofer gets one option and the "Good / Better / Best"
// header is dropped. Passing all three keeps the tiered framing.
describe('buildRoofQuoteReportHtml — tier mode (mig 148)', () => {
  it('a single visible tier drops the Good / Better / Best header + multi-tier intro', () => {
    const html = buildRoofQuoteReportHtml({
      businessName: 'Apex Roofing',
      address: '12 Sample St',
      quote: baseQuote,
      visibleTierKeys: ['better'],
    })
    // The exact header Jon flagged is gone, and the single-tier intro is used.
    expect(html).not.toContain('Good / Better / Best')
    expect(html).not.toContain('optional upgrades')
    // Only the chosen tier's option line renders; the other two are dropped.
    expect(html).toContain('= $19,800 including GST') // Re-roof (better)
    expect(html).not.toContain('= $2,200 including GST') // Patch/repair (good)
    expect(html).not.toContain('= $26,400 including GST') // Upgrade (best)
  })

  it('two or more visible tiers keep the Good / Better / Best framing', () => {
    const html = buildRoofQuoteReportHtml({
      businessName: 'Apex Roofing',
      address: '12 Sample St',
      quote: baseQuote,
      visibleTierKeys: ['good', 'better', 'best'],
    })
    expect(html).toContain('Good / Better / Best')
    expect(html).toContain('= $2,200 including GST')
    expect(html).toContain('= $19,800 including GST')
    expect(html).toContain('= $26,400 including GST')
  })

  it('omitting visibleTierKeys renders all tiers (back-compat)', () => {
    const html = buildRoofQuoteReportHtml({
      businessName: 'Apex Roofing',
      address: '12 Sample St',
      quote: baseQuote,
    })
    expect(html).toContain('Good / Better / Best')
    expect(html).toContain('= $2,200 including GST')
    expect(html).toContain('= $26,400 including GST')
  })
})
