// Roofing measurement → quote promotion: which document a job serves.
//
// /api/roofing/save-as-quote turns a saved measurement into a real `quotes` row
// and stamps roofing_measurements.quote_share_token. From that moment the QUOTE
// is the single source of truth for the job: save-as-quote deliberately writes
// the real computed tiers into quotes.good/better/best, and those are what the
// tradie edits (TradieEditor → /api/quote/[id]/edit) and what /q/[token] renders.
// The pre-promotion roofing document renders from roofing_measurements.quote
// instead, so it CANNOT reflect any later edit.
//
// The customer page has always redirected a promoted measurement to /q/[token];
// the PDF route did not, so the SMS'd /api/q/roof/[token]/pdf link kept serving a
// second, divergent document for the same job (RC-6). Both surfaces now share
// this ONE rule so they can't drift apart again. PURE — no I/O.

/**
 * True when a roofing measurement should defer to its promoted quote rather than
 * serve its own native document.
 *
 * @param row  the measurement's promotion + payment state
 * @param full the `?full=1` escape hatch — the dashboard's "Saved roofing job →
 *             View" opens the RICH measurement view (satellite + structures +
 *             layout map, priced from the live selection) on purpose.
 */
export function servesPromotedQuote(
  row: { quote_share_token: string | null; paid_at: string | null },
  full: boolean,
): boolean {
  if (full) return false
  // A measurement that already took its own site-visit payment stays put — that
  // document is the payment's receipt + booking surface.
  return !!row.quote_share_token && !row.paid_at
}
