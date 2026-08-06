// ════════════════════════════════════════════════════════════════════
// Painting — which customer quote layout renders, and which arm the
// price/next-steps sections take (spec painting-held-view-parity R1/R2,
// amending painting-funnel-parity R1).
//
// The five-numbered-section view (Overview / Job details / Your tradie /
// Your price / Next steps) is the current-generation customer format
// roofing and electrical/plumbing already use. EVERY state now gets it —
// including a HELD quote (priced, not released, not inspection-routed),
// which is what the SMS quote link lands on for review-required painting.
// The old carve-out kept held rows on the long-scroll branch, and that
// branch has no TrustVideo, so the customer never saw the tradie video
// until the painter pressed Send. ?full=1 keeps roofing's long-scroll
// escape hatch for every state.
//
// The publish gate is untouched: paintHeldForReview is the ONE predicate
// the page uses to swap sections 04/05 to the holding message and to
// suppress every payable action, so a held row still shows no price, no
// deposit link and no accept CTA.
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
  // Held rows included since spec painting-held-view-parity — the row state
  // now chooses the CONTENT of sections 04/05 (paintHeldForReview), not the
  // layout. The state fields stay on the signature because that contract is
  // state-keyed and every state is asserted in quote-view.test.ts.
  return 'five'
}

/**
 * PURE — is this row HELD for tradie review: priced, not yet released, not
 * paid, and not inspection-routed?
 *
 * The five-section view keys three things off this and nothing else:
 *   • 04 Your price   → the publish-gate holding message, not TierCards
 *   • 05 Next steps   → "your painter is finalising this", no booking/pay CTA
 *   • the AcceptBlock → suppressed (a held row is not payable —
 *     resolvePaintMintTier 302s it straight back to the quote page)
 *
 * It is the exact complement of `paintQuotePayable` below — the page derives
 * BOTH from here rather than restating the expression, so the holding copy and
 * a payment CTA structurally cannot render together. (Review 2026-08-06: the
 * page previously restated the payable gate inline and the test mirrored it by
 * hand, so an edit to one could silently drift from the other.)
 */
export function paintHeldForReview(input: {
  released: boolean
  paid: boolean
  inspection: boolean
}): boolean {
  return !paintQuotePayable(input)
}

/**
 * PURE — may this row show prices and offer payment? Released (the tradie has
 * pressed Send), already paid, or inspection-routed. The page's AcceptBlock,
 * sticky bar and tier cards all gate on this.
 */
export function paintQuotePayable(input: {
  released: boolean
  paid: boolean
  inspection: boolean
}): boolean {
  return input.released || input.paid || input.inspection
}
