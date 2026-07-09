// Unified Quotes-tab queue helpers — pipeline quotes (quotes table via
// /api/tenant/me) and measure-tool trade jobs (/api/tenant/trade-jobs)
// merged into ONE master–detail queue, so a job saved from a trade tool
// appears in the same list, counts and filters as an SMS/voice quote
// (pilot feedback: jobs made in the Tools tabs never reached the quote
// queue, so the tabs looked out of sync).
//
// Pure and DOM-free so the merge/filter logic unit-tests without React,
// same pattern as ./quote-filters and ./recent-activity.

import { quoteTradeLabel } from './quote-filters'

/** Mirrors /api/tenant/trade-jobs' TradeJobSummary, including the tradie
 *  detail/edit link the Overview merge type omits. */
export type QueueJob = {
  id: string
  trade: string
  address: string | null
  headline: string | null
  status: 'confirmed' | 'inspection' | 'draft'
  href: string | null
  tradieHref: string | null
  createdAt: string | null
}

export type QueueStatusFilter = 'all' | 'review' | 'sent' | 'paid' | 'inspect'
export type QueueSort = 'newest' | 'oldest' | 'value_desc' | 'value_asc'

/** Stable queue identity for a job row. Quote rows keep the quote's uuid;
 *  job ids come from five different tables, so the trade namespaces them. */
export const jobQueueKey = (j: Pick<QueueJob, 'trade' | 'id'>): string =>
  `job:${j.trade}:${j.id}`

/** A job's trade in the quotes-table slug vocabulary (underscored), so one
 *  set of trade chips filters both row kinds ('commercial-painting' →
 *  'commercial_painting'). */
export const jobTradeSlug = (j: Pick<QueueJob, 'trade'>): string =>
  j.trade.toLowerCase().replace(/-/g, '_')

/** Status-rail bucket for a measure-tool job. draft = awaiting the tradie
 *  (the same reading the Overview attention rail uses); inspection maps to
 *  the Inspection chip. A confirmed job matches only 'all' — it is neither
 *  sent-to-customer nor deposit-paid, and pretending otherwise would lie on
 *  the money filters (some quote statuses, e.g. accepted-without-deposit,
 *  already behave the same way). */
export function jobMatchesFilter(j: QueueJob, f: QueueStatusFilter): boolean {
  if (f === 'all') return true
  if (f === 'review') return j.status === 'draft'
  if (f === 'inspect') return j.status === 'inspection'
  return false
}

/** Same AND-terms contract as quoteMatchesSearch, over the job's
 *  human-facing text: address, headline, trade (slug + label) and status. */
export function jobMatchesSearch(j: QueueJob, terms: string[]): boolean {
  if (terms.length === 0) return true
  const haystack = [
    j.address,
    j.headline,
    j.trade,
    quoteTradeLabel(jobTradeSlug(j)),
    j.status,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return terms.every((t) => haystack.includes(t))
}

/** Distinct sorted trade slugs across BOTH row kinds — drives the trade
 *  chips so a trade with only measure-tool jobs (no pipeline quotes yet)
 *  still gets a chip. */
export function queueTradeOptions(
  quoteTrades: string[],
  jobs: Array<Pick<QueueJob, 'trade'>>,
): string[] {
  const set = new Set(quoteTrades)
  for (const j of jobs) set.add(jobTradeSlug(j))
  return Array.from(set).sort()
}

/** One row of the merged queue. `at`/`value` are precomputed by the caller
 *  so the comparator stays kind-agnostic; jobs are unpriced (value null)
 *  and sink on the value sorts exactly like inspection-routed quotes. */
export type QueueEntry<Q> =
  | { kind: 'quote'; key: string; at: string | null; value: number | null; quote: Q }
  | { kind: 'job'; key: string; at: string | null; value: null; job: QueueJob }

export function compareQueueEntries<Q>(
  a: QueueEntry<Q>,
  b: QueueEntry<Q>,
  sort: QueueSort,
): number {
  if (sort === 'oldest') return (a.at ?? '').localeCompare(b.at ?? '')
  if (sort === 'value_desc' || sort === 'value_asc') {
    if (a.value === null && b.value === null) return 0
    if (a.value === null) return 1
    if (b.value === null) return -1
    return sort === 'value_desc' ? b.value - a.value : a.value - b.value
  }
  // newest
  return (b.at ?? '').localeCompare(a.at ?? '')
}
