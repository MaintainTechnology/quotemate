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

// The job-level solar detach & reinstate allowance must reach the PRINTED
// tier prices (applySolarToTiers — the same code path as the customer quote
// page), so the PDF can never read lower than the page.
describe('buildRoofQuoteReportHtml — solar detach & reinstate', () => {
  const solar = {
    detection: { has_solar: true, has_skylight: false, array_count: 2, skylight_count: 0, summary_note: '' },
    allowance: {
      applies: true, arrays: 2, ex_gst: 2400, inc_gst: 2640,
      detail: '', electrician_note: 'A licensed electrician reconnects the panels.', low_confidence: false,
    },
  }
  const solarQuote = { ...baseQuote, solar } as unknown as MultiRoofQuote

  it('adds the allowance to the replacement tier prices, never Patch', () => {
    const html = buildRoofQuoteReportHtml({
      businessName: 'Apex Roofing',
      address: '12 Sample St',
      quote: solarQuote,
    })
    expect(html).toContain('$2,200') // Patch untouched
    expect(html).toContain('$22,440') // 19,800 + 2,640
    expect(html).toContain('$29,040') // 26,400 + 2,640
    // The per-structure table still shows the raw per-structure better price
    // ($19,800) by design, but the headline Best price must be solar-inclusive.
    expect(html).not.toContain('$26,400')
    expect(html).toMatch(/solar panels \(\+\$2,640 including GST\)/)
  })
  it('renders unchanged when no allowance applies', () => {
    const html = buildRoofQuoteReportHtml({
      businessName: 'Apex Roofing',
      address: '12 Sample St',
      quote: baseQuote,
    })
    expect(html).toContain('$19,800')
    expect(html).toContain('$26,400')
    expect(html).not.toMatch(/solar panels/i)
  })
})

// Spec specs/quote-visual-parity.md R6e — the roofing PDF carries the AI
// work-strategy layout map (aerial + colour-coded zone overlay + legend)
// once the tradie has generated it. Null renders today's PDF unchanged.
describe('buildRoofQuoteReportHtml — layout overlay (spec quote-visual-parity R6)', () => {
  const layoutOverlay = {
    header: 'Please see the roof layout map below to provide clarity on your quote!',
    aerialSrc: 'data:image/jpeg;base64,AERIAL',
    overlaySrc: 'data:image/svg+xml;base64,OVERLAY',
    legend: [
      { color: 'teal' as const, label: 'Install NEW Colorbond sheeting to replace existing.' },
      { color: 'red' as const, label: 'Ground-up scaffolding to the work-area perimeter for WHS.' },
    ],
  }

  it('renders the header, both images, and every legend entry when supplied', () => {
    const html = buildRoofQuoteReportHtml({
      businessName: 'Apex Roofing',
      address: '12 Sample St',
      quote: baseQuote,
      layoutOverlay,
    })
    expect(html).toContain('Please see the roof layout map below')
    expect(html).toContain('data:image/jpeg;base64,AERIAL')
    expect(html).toContain('data:image/svg+xml;base64,OVERLAY')
    expect(html).toContain('Install NEW Colorbond sheeting to replace existing.')
    expect(html).toContain('Ground-up scaffolding to the work-area perimeter for WHS.')
  })

  it('omits the section entirely when layoutOverlay is null/absent', () => {
    const html = buildRoofQuoteReportHtml({
      businessName: 'Apex Roofing',
      address: '12 Sample St',
      quote: baseQuote,
    })
    expect(html).not.toContain('roof layout map')
    expect(html).not.toContain('Estimated materials')
  })

  it('renders the estimated-materials table with basis and use when supplied', () => {
    const html = buildRoofQuoteReportHtml({
      businessName: 'Apex Roofing',
      address: '12 Sample St',
      quote: baseQuote,
      layoutOverlay: {
        ...layoutOverlay,
        materials: {
          items: [
            {
              item: 'Colorbond sheets',
              qty: 71,
              unit: 'sheets',
              basis: '268 m² measured sloped roof ÷ 4.19 m² per sheet + 10% cutting waste',
              use: 'New roof sheeting across the measured roof surface.',
            },
            {
              item: 'Edge protection',
              qty: 69,
              unit: 'lm',
              basis: '69 lm building perimeter from the measured footprint outline',
              use: 'Guardrail around the work-area perimeter (WHS).',
            },
          ],
          note: null,
        },
      },
    })
    expect(html).toContain('Estimated materials')
    expect(html).toContain('Colorbond sheets')
    expect(html).toContain('71 sheets')
    expect(html).toContain('268 m² measured sloped roof')
    expect(html).toContain('Guardrail around the work-area perimeter')
    expect(html).toMatch(/measured .*geometry/i)
  })

  it('renders the layout map without materials when materials is absent', () => {
    const html = buildRoofQuoteReportHtml({
      businessName: 'Apex Roofing',
      address: '12 Sample St',
      quote: baseQuote,
      layoutOverlay,
    })
    expect(html).toContain('Please see the roof layout map below')
    expect(html).not.toContain('Estimated materials')
  })
})

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
