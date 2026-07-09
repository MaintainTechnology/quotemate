// Overview recent-activity helpers — spec: specs/dashboard-overview-quotes-sync.md
//
// The Overview's "Recent quotes" feed merges two sources: the quotes table
// (SMS/voice pipeline quotes, via /api/tenant/me) and the measure-tool trade
// jobs that live OUTSIDE the quotes table (roofing_measurements /
// solar_estimates / painting_measurements / paint_runs, via
// /api/tenant/trade-jobs). These pure helpers own the merge, the trade-job
// row presentation, the attention-rail fallback, the widget fetch-state
// vocabulary (a failed fetch must never read as "empty"), and the
// refresh-on-return throttle — all unit-tested without the React runtime.

/** Mirrors /api/tenant/trade-jobs' TradeJobSummary. `trade` is kept loose
 *  (string) so a trade added to that route (e.g. aircon, migration 144)
 *  flows through the Overview merge without a type-lockstep change here —
 *  the render helpers below fall back gracefully for unknown trades. The
 *  saved-jobs render-decision helpers (savedJobsMode / savedJobTradeKey /
 *  TradeKey) live in app/dashboard/_components/saved-jobs-mode.ts. */
export type TradeJobSummary = {
  id: string
  trade: string
  address: string | null
  headline: string | null
  status: 'confirmed' | 'inspection' | 'draft'
  href: string | null
  createdAt: string | null
}

const TRADE_JOB_LABEL: Record<string, string> = {
  roofing: 'Roofing',
  solar: 'Solar',
  painting: 'Painting',
  'commercial-painting': 'Commercial paint',
  // Matches quoteTradeLabel's spelling (lib/dashboard/quote-filters.ts).
  aircon: 'Air-con',
}

export type ActivityRow<Q> =
  | { kind: 'quote'; quote: Q }
  | { kind: 'job'; job: TradeJobSummary }

const epoch = (iso: string | null | undefined): number => {
  if (!iso) return -Infinity
  const t = Date.parse(iso)
  return Number.isNaN(t) ? -Infinity : t
}

/** Merge pipeline quotes and measure-tool jobs into one newest-first feed,
 *  sliced to `limit` rows. Null/invalid timestamps sink to the bottom. */
export function mergeRecentActivity<Q extends { created_at?: string | null }>(
  quotes: Q[],
  jobs: TradeJobSummary[],
  limit = 5,
): ActivityRow<Q>[] {
  const rows: Array<ActivityRow<Q> & { at: number }> = [
    ...quotes.map((quote) => ({ kind: 'quote' as const, quote, at: epoch(quote.created_at) })),
    ...jobs.map((job) => ({ kind: 'job' as const, job, at: epoch(job.createdAt) })),
  ]
  rows.sort((a, b) => b.at - a.at)
  return rows.slice(0, limit).map(({ at: _at, ...row }) => row)
}

/** Status pill for a trade-job row — same vocabulary as overviewQuotePill so
 *  both row kinds read as one table (Accepted / Site visit / Awaiting you). */
export function tradeJobPill(status: TradeJobSummary['status']): {
  label: string
  tone: 'success' | 'warn' | 'dim'
  pulse: boolean
} {
  // Tone drives only the StatusPill dot now (neutral chip body); this maps
  // 1:1 to overviewQuotePill so both row kinds still read as one table.
  if (status === 'confirmed')
    return { label: 'Accepted', tone: 'success', pulse: false }
  if (status === 'inspection')
    return { label: 'Site visit', tone: 'dim', pulse: false }
  return { label: 'Awaiting you', tone: 'warn', pulse: true }
}

/** Everything a Recent-quotes table row needs to render a trade job. */
export function jobRowView(job: TradeJobSummary): {
  label: string
  value: string | null
  pill: { label: string; tone: 'success' | 'warn' | 'dim'; pulse: boolean }
  href: string | null
  tradeLabel: string
} {
  return {
    label: job.address ?? job.headline ?? 'Saved job',
    value: job.headline,
    pill: tradeJobPill(job.status),
    href: job.href,
    // Unknown trade (added to the route later) → readable fallback, not
    // undefined in the UI.
    tradeLabel:
      TRADE_JOB_LABEL[job.trade] ??
      job.trade.charAt(0).toUpperCase() + job.trade.slice(1),
  }
}

// Mirrors the in-review vocabulary the attention rail already used inline
// (page.tsx attnQuote): these quote statuses mean "waiting on the tradie".
const IN_REVIEW_STATUSES = new Set(['drafted', 'awaiting_review', 'review', 'draft'])

/** The single most-urgent item for the "Needs your attention" rail: the first
 *  in-review quotes-table row (quotes arrive newest-first from the API), else
 *  the newest draft measure-tool job, else null (all clear). */
export function attentionCandidate<Q extends { status?: string | null }>(
  quotes: Q[],
  jobs: TradeJobSummary[],
): { kind: 'quote'; quote: Q } | { kind: 'job'; job: TradeJobSummary } | null {
  const quote = quotes.find((q) =>
    IN_REVIEW_STATUSES.has((q.status ?? '').toLowerCase()),
  )
  if (quote) return { kind: 'quote', quote }
  const draftJobs = jobs
    .filter((j) => j.status === 'draft')
    .sort((a, b) => epoch(b.createdAt) - epoch(a.createdAt))
  return draftJobs.length > 0 ? { kind: 'job', job: draftJobs[0] } : null
}

export type WidgetState = 'loading' | 'error' | 'empty' | 'list'

/** Fetch-state vocabulary for the Overview's lazy widgets (chats, trade
 *  jobs). A failed fetch is an explicit 'error' — never 'empty', so the UI
 *  can offer a retry instead of claiming "No conversations yet". */
export function widgetState(loading: boolean, error: boolean, count: number): WidgetState {
  if (loading) return 'loading'
  if (error) return 'error'
  return count > 0 ? 'list' : 'empty'
}

/** Refresh-on-return throttle: refetch /api/tenant/me at most once per 15s.
 *  `lastFetchedMs` null/0 means never fetched → always allowed. */
export function shouldRefresh(
  lastFetchedMs: number | null,
  nowMs: number,
  minIntervalMs = 15_000,
): boolean {
  if (!lastFetchedMs) return true
  return nowMs - lastFetchedMs >= minIntervalMs
}
