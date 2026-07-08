// Pure render-decision helpers for the Quotes tab "Saved jobs" section
// (spec quotes-tab-sync Task 2/4). Kept free of client-component imports so
// they unit-test without a DOM: SavedJobsSection.tsx re-exports them for the
// dashboard, and the tests import this module directly.

/** Trades whose measure-tool jobs live outside the quotes table and are
 *  served by /api/tenant/trade-jobs. */
export type TradeKey = 'roofing' | 'solar' | 'painting' | 'commercial-painting' | 'aircon'

/** Map a dashboard trade-hub slug (underscore form, e.g. 'commercial_painting')
 *  to a Saved-jobs TradeKey (hyphen form). Returns null for trades with no
 *  saved-jobs table (electrical, plumbing, signage) — those hubs get no
 *  saved-jobs section. */
export function savedJobTradeKey(hubSlug: string): TradeKey | null {
  switch (hubSlug.toLowerCase()) {
    case 'roofing':
      return 'roofing'
    case 'solar':
      return 'solar'
    case 'painting':
      return 'painting'
    case 'commercial_painting':
    case 'commercial-painting':
      return 'commercial-painting'
    case 'aircon':
      return 'aircon'
    default:
      return null
  }
}

/** Which SavedJobsSection variant a QuotesTab mount renders: the cross-trade
 *  workspace (no tradeFilter) shows every trade's saved jobs ('all'), a mapped
 *  trade hub shows only its own (TradeKey), and a trade with no saved-jobs
 *  table shows nothing (null). */
export function savedJobsMode(tradeFilter?: string): TradeKey | 'all' | null {
  if (!tradeFilter) return 'all'
  return savedJobTradeKey(tradeFilter)
}
