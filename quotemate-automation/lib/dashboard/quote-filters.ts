// Pure filter / search predicates for the dashboard Quotes tab.
//
// Kept out of app/dashboard/page.tsx (a 'use client' module vitest can't
// import directly) so the trade / date-range / text-search logic is
// unit-testable in isolation. QuotesTab wires these to its filter UI state;
// the existing status filter + sort live in page.tsx unchanged.

/** The subset of a dashboard Quote the filters actually read. The page's
 *  full `Quote` type is a structural superset, so it passes through. */
export type FilterableQuote = {
  created_at: string | null
  trade: string | null
  status: string | null
  customer_full_name: string | null
  customer_first_name: string | null
  suburb: string | null
  job_type: string | null
  scope_of_works: string | null
  share_token: string | null
}

/** Split a raw search-box value into lower-cased terms. Terms are ANDed by
 *  quoteMatchesSearch, so "downlight paddington" narrows rather than widens. */
export function parseSearchTerms(raw: string): string[] {
  return raw.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

/** True when EVERY search term appears somewhere in the quote's human-facing
 *  text — customer name, suburb, job type, trade, scope, share code (the
 *  quote's "code"), or status. An empty term list matches everything. */
export function quoteMatchesSearch(q: FilterableQuote, terms: string[]): boolean {
  if (terms.length === 0) return true
  const haystack = [
    q.customer_full_name,
    q.customer_first_name,
    q.suburb,
    q.job_type,
    q.trade,
    q.scope_of_works,
    q.share_token,
    q.status,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return terms.every((t) => haystack.includes(t))
}

/** Inclusive [from, to] calendar-date test on an ISO timestamp. Either
 *  bound may be '' to leave that side open; both empty = no date filter
 *  (always true). A null/empty timestamp is excluded once any bound is set.
 *  Shared by the quote AND trade-job date filters (lib/dashboard/quote-queue). */
export function dateInRange(
  iso: string | null,
  from: string,
  to: string,
): boolean {
  if (!from && !to) return true
  const day = (iso ?? '').slice(0, 10)
  if (!day) return false
  if (from && day < from) return false
  if (to && day > to) return false
  return true
}

/** Inclusive [from, to] date-range test against the quote's created_at,
 *  compared on the calendar date (YYYY-MM-DD). */
export function quoteInDateRange(
  q: FilterableQuote,
  from: string,
  to: string,
): boolean {
  return dateInRange(q.created_at, from, to)
}

/** Match a quote's trade against a selected slug. 'all' matches every quote;
 *  otherwise an exact (case-insensitive) trade match. */
export function quoteMatchesTrade(q: FilterableQuote, tradeSel: string): boolean {
  if (tradeSel === 'all') return true
  return (q.trade ?? '').toLowerCase() === tradeSel
}

/** Distinct, sorted trade slugs present in a quote list — drives the
 *  trade-filter chips so only trades the tradie actually has quotes for
 *  appear. Null / empty trades are ignored. */
export function tradeOptionsFromQuotes(quotes: FilterableQuote[]): string[] {
  const set = new Set<string>()
  for (const q of quotes) {
    const t = (q.trade ?? '').toLowerCase()
    if (t) set.add(t)
  }
  return Array.from(set).sort()
}

const TRADE_LABELS: Record<string, string> = {
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  roofing: 'Roofing',
  signage: 'Signage',
  painting: 'Painting',
  commercial_painting: 'Commercial paint',
  aircon: 'Air-con',
  solar: 'Solar',
}

/** Human label for a trade slug. Known trades get a curated label; any other
 *  slug (e.g. a registry/loader trade) falls back to title-case with
 *  underscores turned into spaces. */
export function quoteTradeLabel(slug: string): string {
  if (TRADE_LABELS[slug]) return TRADE_LABELS[slug]
  if (!slug) return slug
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/_/g, ' ')
}
