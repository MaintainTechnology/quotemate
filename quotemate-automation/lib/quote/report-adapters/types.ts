// Per-trade adapter for the unified PDF quote viewer (shell + adapter design,
// docs/superpowers/specs/2026-06-25-pdf-quote-viewer-edit-design.md).
//
// The viewer shell (app/dashboard/quote/[token]) is trade-agnostic: it asks the
// adapter how to show the report body, where the PDF lives, and what the
// toolbar may enable. Adding a trade = add one adapter to the registry; the
// shell, the dashboard "View PDF" button, and the toolbar never change.
//
// Phase A wires electrical + plumbing fully (inline PDF view + manual edit + AI
// edit, reusing the existing line-item editor and chat-edit endpoint). Every
// other trade resolves to a view-only adapter so it still gets View + Download
// immediately, with edit/AI lighting up per trade as each adapter is built.

/** How the viewer renders the report body for a trade. */
export type ReportBodyMode =
  /** Embed the real PDF inline (iframe ?disposition=inline). */
  | 'pdf-inline'
  /** No inline preview yet — show a card + a Download button. */
  | 'download-only'

/** Which in-shell editor the toolbar mounts. All editable trades use the
 *  Good/Better/Best line-item editor today. */
export type EditorKind = 'line-items' | null

/** How edits to this trade's prices are validated on save.
 *  - 'catalogue': prices must derive from the tenant's priced catalogue +
 *    pricing book (electrical/plumbing) — the grounding validator gates it.
 *  - 'tradie-authored': the trade has no fixed catalogue (solar/roof/paint),
 *    so the tradie/AI set the prices directly and the diff-review + Save is the
 *    backstop. No catalogue grounding is applied. */
export type GroundingMode = 'catalogue' | 'tradie-authored'

export interface ReportToolbarCapabilities {
  /** Manual structured edit is available for this trade. */
  manualEdit: boolean
  /** AI chat-edit is available for this trade. */
  aiEdit: boolean
}

export interface QuoteReportAdapter {
  /** Normalised trade key, e.g. "electrical", "roofing". */
  trade: string
  bodyMode: ReportBodyMode
  /** Build this trade's PDF route from a quote share token. Append
   *  `?disposition=inline` for embedding; bare for download. */
  pdfPath: (shareToken: string) => string
  capabilities: ReportToolbarCapabilities
  editorKind: EditorKind
  groundingMode: GroundingMode
}
