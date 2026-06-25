// Unit tests for the report-adapter registry — the extensibility seam for the
// unified PDF quote viewer. Verifies per-trade resolution, capability gating,
// and PDF routes, plus a safe default for unknown trades.

import { describe, it, expect } from 'vitest'
import { getReportAdapter } from './registry'

describe('getReportAdapter', () => {
  it('electrical/plumbing are fully editable with inline PDF view', () => {
    for (const trade of ['electrical', 'plumbing']) {
      const a = getReportAdapter(trade)
      expect(a.bodyMode).toBe('pdf-inline')
      expect(a.capabilities).toEqual({ manualEdit: true, aiEdit: true })
      expect(a.editorKind).toBe('line-items')
      expect(a.pdfPath('tok123')).toBe('/api/q/tok123/pdf')
    }
  })

  it('is case/whitespace insensitive', () => {
    const a = getReportAdapter('  Electrical ')
    expect(a.capabilities.manualEdit).toBe(true)
  })

  it('bespoke trades get view+download only, routed to their own PDF endpoint', () => {
    expect(getReportAdapter('roofing').pdfPath('t')).toBe('/api/q/roof/t/pdf')
    expect(getReportAdapter('solar').pdfPath('t')).toBe('/api/q/solar/t/pdf')
    expect(getReportAdapter('painting').pdfPath('t')).toBe('/api/q/paint/t/pdf')
    for (const trade of ['roofing', 'solar', 'painting', 'commercial_painting']) {
      const a = getReportAdapter(trade)
      expect(a.bodyMode).toBe('download-only')
      expect(a.capabilities).toEqual({ manualEdit: false, aiEdit: false })
      expect(a.editorKind).toBeNull()
    }
  })

  it('falls back to a safe view-only default for unknown/empty trades', () => {
    for (const trade of [null, undefined, '', 'space-elevator']) {
      const a = getReportAdapter(trade)
      expect(a.bodyMode).toBe('download-only')
      expect(a.capabilities).toEqual({ manualEdit: false, aiEdit: false })
      expect(typeof a.pdfPath('t')).toBe('string')
    }
  })
})
