// ════════════════════════════════════════════════════════════════════
// Painting — which customer quote layout renders (spec painting-funnel-
// parity R1).
//
// The five-numbered-section view (Overview / Job details / Your tradie /
// Your price / Book) is the current-generation customer format roofing and
// electrical/plumbing already use. Painting shows it once there is
// something for the customer to act on: prices released, deposit paid, or
// an inspection-routed job with its payable $99 site visit. A HELD quote
// (priced, not released, not inspection-routed) keeps the long-scroll view
// with the publish-gate holding message — no prices, no accept CTA — and
// ?full=1 keeps roofing's long-scroll escape hatch for every state.
//
// PURE — no I/O. Fully unit-testable.
// ════════════════════════════════════════════════════════════════════

export type PaintQuoteView = 'five' | 'long'

export function paintQuoteViewMode(input: {
  /** painting_measurements.released_at present — prices visible. */
  released: boolean
  /** paid_at present (tier deposit or the $99 site visit). */
  paid: boolean
  /** routing = 'inspection_required' — priced on site, $99 visit payable. */
  inspection: boolean
  /** ?full=1 — force the long-scroll layout. */
  fullParam: boolean
}): PaintQuoteView {
  if (input.fullParam) return 'long'
  return input.released || input.paid || input.inspection ? 'five' : 'long'
}
