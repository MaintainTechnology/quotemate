// Pure scope-decision helpers for the measure-tool jobs merged into the
// Quotes-tab queue (originally spec quotes-tab-sync Task 2/4, for the since-
// removed standalone "Saved jobs" section). Kept free of client-component
// imports so they unit-test without a DOM.

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

/** Which measure-tool jobs a QuotesTab mount merges into its queue: the
 *  cross-trade workspace (no tradeFilter) takes every trade ('all'), a mapped
 *  trade hub only its own (TradeKey), and a trade with no measure-tool
 *  table none at all (null — the trade-jobs fetch is skipped). */
export function savedJobsMode(tradeFilter?: string): TradeKey | 'all' | null {
  if (!tradeFilter) return 'all'
  return savedJobTradeKey(tradeFilter)
}
