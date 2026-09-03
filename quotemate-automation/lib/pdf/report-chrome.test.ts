// Spec quote-pdf-logo-fix — verifies the SHARED chrome that every trade PDF
// funnels through renders the tenant logo when branding.logoSrc is set, and
// falls back to the business-name wordmark when it is null/omitted.
// electrical/plumbing (buildQuoteReportHtml), painting, roofing and solar all
// call renderReportDocument, so this covers the logo behaviour for all trades.

import { describe, it, expect } from 'vitest'
import { renderReportDocument, type TenantBranding, type ReportDocument } from './report-chrome'

const doc: ReportDocument = {
  docTitle: 'Test quote',
  dateLabel: '25 June 2026',
  bodyHtml: '<p>body</p>',
}

describe('renderReportDocument — tenant logo (shared chrome)', () => {
  it('renders the logo <img> when branding.logoSrc is set', () => {
    const branding: TenantBranding = {
      businessName: 'Atomic Electrical',
      logoSrc: 'data:image/png;base64,AAAA',
    }
    const html = renderReportDocument(branding, doc)
    expect(html).toContain('class="logo"')
    expect(html).toContain('src="data:image/png;base64,AAAA"')
    // The text wordmark must not be emitted when a logo is present.
    expect(html).not.toContain('class="wordmark"')
  })

  it('falls back to the business-name wordmark when logoSrc is null (no throw)', () => {
    const branding: TenantBranding = { businessName: 'Atomic Electrical', logoSrc: null }
    let html = ''
    expect(() => {
      html = renderReportDocument(branding, doc)
    }).not.toThrow()
    expect(html).toContain('class="wordmark"')
    expect(html).toContain('Atomic Electrical')
    expect(html).not.toContain('class="logo"')
  })

  it('falls back to the wordmark when logoSrc is omitted entirely', () => {
    const html = renderReportDocument({ businessName: 'Oakcrest Electrical' }, doc)
    expect(html).toContain('class="wordmark"')
    expect(html).not.toContain('class="logo"')
  })

  it('leads the wordmark with the initials monogram when there is no logo', () => {
    const html = renderReportDocument({ businessName: 'Atomic Electrical', logoSrc: null }, doc)
    expect(html).toContain('<span class="monogram">AE</span>')
    // The name must still print — this header has no separate business-name line.
    expect(html).toContain('Atomic Electrical')
  })

  it('omits the monogram when a real logo is present', () => {
    const html = renderReportDocument(
      { businessName: 'Atomic Electrical', logoSrc: 'data:image/png;base64,AAAA' },
      doc,
    )
    expect(html).not.toContain('<span class="monogram">')
  })
})

// Spec ev-charger-estimate-template R2 — two optional slots, each defaulting to
// today's output so every existing caller renders byte-identically.
describe('renderReportDocument — titleText and introMetaHtml', () => {
  const evDoc = {
    docTitle: 'Quote',
    dateLabel: '13 Aug 2026',
    customerName: 'Jane',
    bodyHtml: '<p>body</p>',
  }

  it('prints "Quotation" and the flat sub-line when neither slot is used', () => {
    const html = renderReportDocument({ businessName: 'Atomic Electrical' }, evDoc)
    expect(html).toContain('<div class="quote-title">Quotation</div>')
    expect(html).toContain('<div class="quote-sub">')
    expect(html).toContain('13 Aug 2026')
  })

  it('is byte-identical whether the slots are omitted or explicitly null', () => {
    const branding = { businessName: 'Atomic Electrical' }
    expect(
      renderReportDocument(branding, { ...evDoc, titleText: null, introMetaHtml: null }),
    ).toBe(renderReportDocument(branding, evDoc))
  })

  it('uses titleText for the visible title', () => {
    const html = renderReportDocument(
      { businessName: 'Electrical3' },
      { ...evDoc, titleText: 'ESTIMATE' },
    )
    expect(html).toContain('<div class="quote-title">ESTIMATE</div>')
    expect(html).not.toContain('>Quotation<')
  })

  it('escapes titleText', () => {
    const html = renderReportDocument(
      { businessName: 'E3' },
      { ...evDoc, titleText: '<b>x</b>' },
    )
    expect(html).not.toContain('<div class="quote-title"><b>x</b></div>')
    expect(html).toContain('&lt;b&gt;')
  })

  it('replaces the sub-line with introMetaHtml when supplied', () => {
    const html = renderReportDocument(
      { businessName: 'Electrical3' },
      { ...evDoc, introMetaHtml: '<div class="ev-meta">Prepared For:</div>' },
    )
    expect(html).toContain('<div class="ev-meta">Prepared For:</div>')
    expect(html).not.toContain('<div class="quote-sub">')
  })
})
