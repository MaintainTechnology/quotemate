// Which document a quote renders — spec ev-charger-estimate-template R17.
//
// R1's whole promise is that the EV estimate reaches EV charger quotes and
// NOTHING else: every other job type and trade must keep the generic report,
// byte for byte. The predicate is unit-tested next door; this pins the actual
// render seam, which is the thing that would silently swap a customer's
// document if the gate were ever loosened.
//
// lib/quote/pdf.ts creates a Supabase client at module scope, so the env vars
// have to exist before the import — the pattern lib/estimate/run.grounding.test.ts
// uses. Nothing here touches the network: renderQuoteDocumentHtml is pure.

import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
})

import { renderQuoteDocumentHtml } from './pdf'
import type { QuoteReportInput } from './report-html'
import type { EvChargerEstimateInput } from './report-html-ev-charger'

const ISSUED = new Date('2026-08-13T02:00:00.000Z')

const TIER = {
  label: 'Standard install',
  subtotal_ex_gst: 976.3,
  line_items: [
    {
      description: '40A 3-Pole RCBO 6kA',
      quantity: 1,
      unit: 'each',
      unit_price_ex_gst: 195,
      total_ex_gst: 195,
    },
    {
      description: 'Mount and terminate client-supplied EV charger',
      quantity: 1.5,
      unit: 'hr',
      unit_price_ex_gst: 100,
      total_ex_gst: 150,
    },
  ],
}

const genericInput: QuoteReportInput = {
  businessName: 'Electrical3',
  customerName: 'Carlos Silva Junior',
  jobType: 'ev_charger',
  scopeOfWorks: 'Installation of the Standard 3-Phase EV charger.',
  good: TIER,
  better: null,
  best: null,
  generatedAt: ISSUED,
}

const evInput: EvChargerEstimateInput = {
  businessName: 'Electrical3',
  estimateRef: 'EST-0534',
  customerName: 'Carlos Silva Junior',
  scopeOfWorks: 'Installation of the Standard 3-Phase EV charger.',
  good: TIER,
  better: null,
  best: null,
  generatedAt: ISSUED,
}

/** Markers unique to each document. */
const EV_ONLY = ['ESTIMATE', 'Prepared For:', 'Terms &amp; Conditions', '<th>Description</th>']
const GENERIC_ONLY = ['Quotation', 'Unit (ex GST)']

describe('renderQuoteDocumentHtml — document selection (R1/R17)', () => {
  it('renders the EV estimate when the EV input is supplied', () => {
    const html = renderQuoteDocumentHtml(genericInput, null, evInput)
    for (const m of EV_ONLY) expect(html, m).toContain(m)
    for (const m of GENERIC_ONLY) expect(html, m).not.toContain(m)
  })

  it('renders the generic report when there is no EV input', () => {
    const html = renderQuoteDocumentHtml(genericInput, null, null)
    for (const m of GENERIC_ONLY) expect(html, m).toContain(m)
    expect(html).not.toContain('Prepared For:')
    expect(html).not.toContain('<div class="quote-title">ESTIMATE</div>')
  })

  it('leaves the generic output byte-identical to omitting the argument entirely', () => {
    expect(renderQuoteDocumentHtml(genericInput, null, null)).toBe(
      renderQuoteDocumentHtml(genericInput, null),
    )
  })

  it('falls back to the generic report rather than throwing when the EV build fails', () => {
    // R16 — a template bug must degrade to the generic report, never to a
    // failed send: the quote SMS is dispatched around this call.
    const poisoned = {
      ...evInput,
      get good(): never {
        throw new Error('boom')
      },
    } as unknown as EvChargerEstimateInput
    const html = renderQuoteDocumentHtml(genericInput, null, poisoned)
    expect(html).toContain('Quotation')
    expect(html).not.toContain('<div class="quote-title">ESTIMATE</div>')
  })

  it('lets a tradie-authored report_doc win over the EV template', () => {
    // FULL_QUOTE_DOC='true' is set in the fleet env. A tradie who authored a
    // document in the editor has overridden the template on purpose.
    vi.stubEnv('FULL_QUOTE_DOC', 'true')
    try {
      const doc = {
        version: 1,
        blocks: [{ type: 'heading', content: [{ text: 'Tradie authored' }] }],
      }
      const html = renderQuoteDocumentHtml(genericInput, doc, evInput)
      expect(html).toContain('Tradie authored')
      expect(html).not.toContain('<div class="quote-title">ESTIMATE</div>')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
