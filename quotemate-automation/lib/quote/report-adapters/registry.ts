// Trade → report-adapter registry for the unified PDF quote viewer.
// See ./types.ts and the design doc for the shell+adapter rationale.

import type { GroundingMode, QuoteReportAdapter } from './types'

// Trades with a priced catalogue the grounding validator checks edits against.
// AI/manual edits to these must derive from pricing_book + shared_* catalogues.
const CATALOGUE_TRADES = new Set(['electrical', 'plumbing'])

// Trades that store Good/Better/Best line items but have NO fixed catalogue —
// their prices come from the trade's own estimator and are the tradie's to set.
// Edits here are tradie-authored: no catalogue grounding, the diff-review + Save
// is the backstop. (These all render via TradeTiers off quotes.good/better/best.)
const TRADIE_AUTHORED_TRADES = new Set(['solar', 'roofing', 'painting', 'commercial_painting'])

function norm(trade: string | null | undefined): string {
  return (trade ?? '').toLowerCase().trim()
}

/** How edits to a trade's prices are validated on save (single source of truth
 *  shared by the edit + chat-edit endpoints). Unknown trades default to
 *  tradie-authored (no catalogue to ground against). */
export function tradeGroundingMode(trade: string | null | undefined): GroundingMode {
  return CATALOGUE_TRADES.has(norm(trade)) ? 'catalogue' : 'tradie-authored'
}

/** Resolve the viewer adapter for a quote's trade. Always returns an adapter.
 *
 *  IMPORTANT: the dashboard viewer operates on the `quotes` row's
 *  `share_token`, and `/api/q/[token]/pdf` serves the PDF for ANY quotes row by
 *  that token (the same route the dashboard "Download PDF" button uses for every
 *  trade). So all trades share that route here. The dedicated per-flow routes
 *  (/api/q/solar|roof|paint/[token]/pdf) key off a DIFFERENT token and must NOT
 *  be used in this quotes-row context — doing so 404s. */
export function getReportAdapter(trade: string | null | undefined): QuoteReportAdapter {
  const t = norm(trade)
  const catalogue = CATALOGUE_TRADES.has(t)
  const editable = catalogue || TRADIE_AUTHORED_TRADES.has(t)
  return {
    trade: t || 'unknown',
    bodyMode: 'pdf-inline',
    pdfPath: (token) => `/api/q/${token}/pdf`,
    capabilities: { manualEdit: editable, aiEdit: editable },
    editorKind: editable ? 'line-items' : null,
    groundingMode: catalogue ? 'catalogue' : 'tradie-authored',
  }
}
