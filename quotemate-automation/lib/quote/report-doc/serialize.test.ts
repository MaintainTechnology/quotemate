import { describe, expect, it } from 'vitest'
import { serializeReportDoc } from './serialize'
import type { ReportDoc } from './types'

const tiers = {
  good: { label: 'Essentials', subtotal_ex_gst: 1000, line_items: [] },
  better: { label: 'Recommended', subtotal_ex_gst: 2000, line_items: [] },
  best: null,
  selectedTier: 'better' as const,
}

const doc: ReportDoc = {
  version: 1,
  blocks: [
    { type: 'title', content: [{ text: 'Commercial Repaint' }] },
    { type: 'heading', content: [{ text: 'Scope of works' }] },
    { type: 'paragraph', content: [{ text: 'Two coats to walls', marks: ['bold'] }] },
    { type: 'pricing' },
    { type: 'bulletList', items: [[{ text: 'Valid 30 days' }]] },
  ],
}

describe('serializeReportDoc', () => {
  it('renders title, heading, paragraph, bullets in document order', () => {
    const html = serializeReportDoc(doc, tiers)
    expect(html.indexOf('Commercial Repaint')).toBeGreaterThanOrEqual(0)
    expect(html.indexOf('Scope of works')).toBeGreaterThan(html.indexOf('Commercial Repaint'))
    expect(html).toContain('<li>Valid 30 days</li>')
  })

  it('applies allow-listed marks (bold → <strong>)', () => {
    expect(serializeReportDoc(doc, tiers)).toContain('<strong>Two coats to walls</strong>')
  })

  it('renders the pricing block from tiers (RECOMMENDED on the selected tier)', () => {
    const html = serializeReportDoc(doc, tiers)
    expect(html).toContain('BETTER · RECOMMENDED')
    expect(html).toContain('Essentials')
  })

  it('escapes HTML in text nodes (XSS / Gotenberg SSRF guard)', () => {
    const evil: ReportDoc = {
      version: 1,
      blocks: [{ type: 'paragraph', content: [{ text: '<img src=x onerror=alert(1)>' }] }],
    }
    const html = serializeReportDoc(evil, tiers)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('ignores unknown marks (only the allow-list is emitted)', () => {
    const d: ReportDoc = {
      version: 1,
      // deliberately cast: a forged/persisted doc could carry an off-list mark
      blocks: [{ type: 'paragraph', content: [{ text: 'hi', marks: ['evil' as never] }] }],
    }
    const html = serializeReportDoc(d, tiers)
    expect(html).toContain('hi')
    expect(html).not.toContain('evil')
  })

  it('is deterministic', () => {
    expect(serializeReportDoc(doc, tiers)).toBe(serializeReportDoc(doc, tiers))
  })
})
