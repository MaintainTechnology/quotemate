// Unit tests for the report-adapter registry — the extensibility seam for the
// unified PDF quote viewer. Verifies per-trade resolution, capability gating,
// grounding mode, and that every trade serves its PDF through the quotes-row
// route the dashboard viewer operates on.

import { describe, it, expect } from 'vitest'
import { getReportAdapter, tradeGroundingMode } from './registry'

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
