// Trade → report-adapter registry for the unified PDF quote viewer.
// See ./types.ts and the design doc for the shell+adapter rationale.

import type { QuoteReportAdapter } from './types'

// Trades whose quote is a Good/Better/Best line-item structure with a
// grounding-validated editor + AI chat-edit (Phase A).
const LINE_ITEM_TRADES = new Set(['electrical', 'plumbing'])

// Known bespoke trades that have their own PDF route but no in-shell editor
// yet — they get View (via download) + Download now; edit/AI per trade later.
const BESPOKE_PDF_ROUTE: Record<string, (token: string) => string> = {
  roofing: (t) => `/api/q/roof/${t}/pdf`,
  solar: (t) => `/api/q/solar/${t}/pdf`,
  painting: (t) => `/api/q/paint/${t}/pdf`,
  commercial_painting: (t) => `/api/q/paint/${t}/pdf`,
}

/** Resolve the viewer adapter for a quote's trade. Always returns an adapter:
 *  unknown/empty trades fall back to a safe view-only default so the viewer and
 *  the dashboard "View PDF" button work for every quote. */
export function getReportAdapter(trade: string | null | undefined): QuoteReportAdapter {
  const t = (trade ?? '').toLowerCase().trim()

  if (LINE_ITEM_TRADES.has(t)) {
    return {
      trade: t,
      bodyMode: 'pdf-inline',
      pdfPath: (token) => `/api/q/${token}/pdf`,
      capabilities: { manualEdit: true, aiEdit: true },
      editorKind: 'line-items',
    }
  }

  const bespoke = BESPOKE_PDF_ROUTE[t]
  return {
    trade: t || 'unknown',
    bodyMode: 'download-only',
    // Bespoke trades use their dedicated route; an unknown trade falls back to
    // the electrical/plumbing route (download still resolves for those quotes).
    pdfPath: bespoke ?? ((token) => `/api/q/${token}/pdf`),
    capabilities: { manualEdit: false, aiEdit: false },
    editorKind: null,
  }
}
