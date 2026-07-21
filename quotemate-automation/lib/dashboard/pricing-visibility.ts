// PURE — which pricing cards a trade hub's PRICING tab surfaces.
//
// Some trades price from a dedicated rate-card editor rather than an hourly
// labour book: roofing/painting price per-m² (RoofRates/PaintRates editors),
// signage/aircon price through their tool panels. For those trades the
// pricing_book row still exists (it holds the tier-mode + rate-card overlay),
// but its hourly_rate column is INERT — the estimators never read it. Surfacing
// that row as a "$/hr" PricingBookCard misled newly-created accounts into
// looking hourly-priced while seed accounts (roofing overlay on a non-roofing
// primary row, so no roofing book) correctly showed only the rate-card editor.
//
// Single source of truth so the dashboard and its tests agree.

/** Trade-hub slugs whose PRICING tab never shows the hourly labour book.
 *  Matches tenants.trades[] entries (lib/admin/trades.ts KNOWN_TRADES). */
export const NO_BOOK_HUB_TRADES: readonly string[] = [
  'roofing',
  'painting',
  'signage',
  'aircon',
]

/**
 * PURE — should the hourly-labour PricingBookCard render for this hub filter?
 *
 * `tradeFilter` is the trade-hub slug (roofing/electrical/…) in hub mode, or
 * null/undefined on the General pricing tab (no filter → show every book).
 * Rate-card trades (NO_BOOK_HUB_TRADES) always return false. Case-insensitive,
 * because tenants.trades[] can carry mixed casing.
 */
export function showsHourlyPricingBook(
  tradeFilter: string | null | undefined,
): boolean {
  if (!tradeFilter) return true
  return !NO_BOOK_HUB_TRADES.includes(tradeFilter.toLowerCase())
}
