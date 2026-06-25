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
})
