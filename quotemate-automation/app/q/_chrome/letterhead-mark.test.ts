// The quote letterhead is WHITE-LABEL: a customer of "Bob's Plumbing" must
// never be shown the QuoteMax mark as Bob's brand. Before this test the
// no-logo branch rendered <QuoteMaxMark/>, leaking our brand onto every
// logo-less tenant's quote (lib/pdf/report-chrome.ts already forbids the same
// thing for the PDF). Locked here because it regressed silently once.
//
// createElement rather than JSX so the file stays .test.ts and matches the
// node-only vitest include glob; Letterhead is pure, so react-dom/server
// renders it without the Next runtime.

import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Letterhead } from './parts'

const render = (props: Parameters<typeof Letterhead>[0]) =>
  renderToStaticMarkup(createElement(Letterhead, props))

describe('Letterhead brand mark', () => {
  it('renders the uploaded logo when the tenant has one', () => {
    const html = render({ name: "Bob's Plumbing", logoUrl: 'https://cdn.example.com/logo.png' })
    expect(html).toContain('https://cdn.example.com/logo.png')
    expect(html).not.toContain('>BP<')
  })

  it('falls back to the tenant initials — never the QuoteMax mark — with no logo', () => {
    const html = render({ name: "Bob's Plumbing", logoUrl: null })
    expect(html).toContain('>BP<')
    // The QuoteMax mark's <svg>; the tradie's own name is fine, our brand is not.
    expect(html).not.toContain('<svg')
  })

  it('renders no mark at all when the name yields no initials', () => {
    const html = render({ name: '', logoUrl: null })
    expect(html).not.toContain('<svg')
  })
})
