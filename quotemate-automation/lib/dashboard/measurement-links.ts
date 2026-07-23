// Promoted-measurement → Measurement Results link.
//
// A roofing measurement promoted to a quote (/api/roofing/save-as-quote) is
// dropped from /api/tenant/trade-jobs so the job doesn't render twice — the
// `quotes` row wins. But `quotes` carries no pointer back to
// roofing_measurements, so the promoted row lost its /m/[measure_token]
// link and the tradie could no longer open the Measurement Results page for
// a job they'd already sold.
//
// The reverse key already exists and is populated:
//   roofing_measurements.quote_share_token = quotes.share_token   (mig 168)
//
// Pure and DOM-free, same as the rest of lib/dashboard.

/** PURE — index promoted roofing measurements by the share token of the
 *  quote they became, so a quotes-backed queue row can link back to its
 *  Measurement Results page. Rows missing either token are skipped: an
 *  unpromoted measurement still has its own trade-jobs row, and a
 *  token-less one has no page to link to. */
export function measurementHrefByShareToken(
  rows: ReadonlyArray<{
    quote_share_token: string | null
    measure_token: string | null
  }>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    if (!r.quote_share_token || !r.measure_token) continue
    out[r.quote_share_token] = `/m/${r.measure_token}`
  }
  return out
}
