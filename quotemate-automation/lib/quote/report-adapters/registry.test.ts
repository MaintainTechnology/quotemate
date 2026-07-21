// Unit tests for the report-adapter registry — the extensibility seam for the
// unified PDF quote viewer. Verifies per-trade resolution, capability gating,
// grounding mode, and that every trade serves its PDF through the quotes-row
// route the dashboard viewer operates on.

import { describe, it, expect } from 'vitest'
import { getReportAdapter, tradeGroundingMode, tradeRendersOwnQuotePdf } from './registry'

describe('getReportAdapter', () => {
  it('electrical/plumbing: editable, inline PDF, catalogue-grounded', () => {
    for (const trade of ['electrical', 'plumbing']) {
      const a = getReportAdapter(trade)
      expect(a.bodyMode).toBe('pdf-inline')
      expect(a.capabilities).toEqual({ manualEdit: true, aiEdit: true })
      expect(a.editorKind).toBe('line-items')
      expect(a.groundingMode).toBe('catalogue')
      expect(a.pdfPath('tok123')).toBe('/api/q/tok123/pdf')
    }
  })

  it('solar/roof/paint: editable, inline PDF, tradie-authored (no catalogue)', () => {
    for (const trade of ['solar', 'roofing', 'painting', 'commercial_painting']) {
      const a = getReportAdapter(trade)
      expect(a.bodyMode).toBe('pdf-inline')
      expect(a.capabilities).toEqual({ manualEdit: true, aiEdit: true })
      expect(a.editorKind).toBe('line-items')
      expect(a.groundingMode).toBe('tradie-authored')
      // Always the quotes-row route the dashboard viewer uses — NOT the
      // dedicated per-flow route (different token space → would 404 here).
      expect(a.pdfPath('tok')).toBe('/api/q/tok/pdf')
    }
  })

  it('no live trade opts into the block-doc workspace — keeps the styled full-quote iframe', () => {
    // The dashboard viewer only swaps the styled HTML iframe for the TipTap
    // living-document workspace when editorKind === 'block-doc'. That render is
    // unfinished (no workspace styling; hollow report_doc for dedicated-builder
    // trades), so no adapter may return it yet or roofing/etc. lose their report.
    for (const trade of ['electrical', 'plumbing', 'solar', 'roofing', 'painting', 'commercial_painting']) {
      expect(getReportAdapter(trade).editorKind).not.toBe('block-doc')
    }
  })

  it('is case/whitespace insensitive', () => {
    expect(getReportAdapter('  Solar ').capabilities.manualEdit).toBe(true)
    expect(getReportAdapter('  Electrical ').groundingMode).toBe('catalogue')
  })

  it('unknown/empty trades fall back to safe view-only', () => {
    for (const trade of [null, undefined, '', 'space-elevator']) {
      const a = getReportAdapter(trade)
      expect(a.bodyMode).toBe('pdf-inline')
      expect(a.capabilities).toEqual({ manualEdit: false, aiEdit: false })
      expect(a.editorKind).toBeNull()
      expect(a.pdfPath('t')).toBe('/api/q/t/pdf')
    }
  })
})

describe('tradeRendersOwnQuotePdf (RC-1 — do NOT clobber a self-authored PDF)', () => {
  it('is true for commercial_painting (it renders + stores its own tender PDF)', () => {
    // save-quote uploads the tender to quotes/<id>.pdf. ensureQuotePdf must serve
    // that verbatim, never regenerate the generic G/B/B template over it.
    expect(tradeRendersOwnQuotePdf('commercial_painting')).toBe(true)
    expect(tradeRendersOwnQuotePdf('  Commercial_Painting ')).toBe(true)
  })

  it('is false for the trades that DO render through the generic G/B/B pipeline', () => {
    for (const trade of ['electrical', 'plumbing', 'solar', 'roofing', 'painting', null, undefined, '', 'unknown']) {
      expect(tradeRendersOwnQuotePdf(trade)).toBe(false)
    }
  })
})

describe('tradeGroundingMode', () => {
  it('catalogue for electrical/plumbing, tradie-authored otherwise', () => {
    expect(tradeGroundingMode('electrical')).toBe('catalogue')
    expect(tradeGroundingMode('plumbing')).toBe('catalogue')
    expect(tradeGroundingMode('solar')).toBe('tradie-authored')
    expect(tradeGroundingMode('roofing')).toBe('tradie-authored')
    expect(tradeGroundingMode(null)).toBe('tradie-authored')
    expect(tradeGroundingMode('anything-else')).toBe('tradie-authored')
  })
})
