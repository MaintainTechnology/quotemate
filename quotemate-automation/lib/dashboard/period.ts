// Reporting-period model for the dashboard Overview. Pure + framework-free so
// the client (KPI scoping in page.tsx / OverviewAnalytics) and the server
// (/api/tenant/analytics) derive the SAME window from one source of truth.
//
// A period resolves to an absolute [start, end] instant pair. `start` is local
// midnight at the period's first day — the tradie's wall clock — and `end` is
// the local end of today. Quotes are then matched by comparing their created_at
// as an ABSOLUTE instant (Date.parse), NOT a date-string slice. That avoids the
// UTC-vs-local calendar-day skew a slice would introduce: a quote created
// Monday 8am in AEST (UTC+10) — whose UTC date is still Sunday — correctly
// counts in "This week" for the tradie, not the prior week.
//
// The client computes the window on its own (the tradie's) clock and passes the
// resolved instants to the server, so both sides agree exactly regardless of
// where the server runs. 'all' resolves to null: no bounds, i.e. every quote.

export type Period = 'all' | 'year' | 'month' | 'week'

/** Ordered options for the picker menu. */
export const PERIODS: { key: Period; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'year', label: 'This year' },
  { key: 'month', label: 'This month' },
  { key: 'week', label: 'This week' },
]

const LABELS: Record<Period, string> = {
  all: 'All time',
  year: 'This year',
  month: 'This month',
  week: 'This week',
}

export type PeriodWindow = { start: Date; end: Date }

/** Narrow an untrusted string (a query param, stored value) to a Period,
 *  falling back to 'all' for anything unrecognised. */
export function asPeriod(v: string | null | undefined): Period {
  return v === 'year' || v === 'month' || v === 'week' ? v : 'all'
}

export function periodLabel(p: Period): string {
  return LABELS[p] ?? 'All time'
}

/** Absolute [start, end] window for a period, or null for 'all' (unbounded).
 *  `start` is local midnight of the period's first day; `end` is the local end
 *  of today (so everything up to and including now counts, and minor client/
 *  server clock skew can't drop a just-created quote). Weeks start on Monday
 *  (AU convention); month/week starts that land in a prior month are handled by
 *  Date's own overflow normalisation. */
export function periodRange(period: Period, now: Date): PeriodWindow | null {
  if (period === 'all') return null
  let start: Date
  if (period === 'year') {
    start = new Date(now.getFullYear(), 0, 1)
  } else if (period === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1)
  } else {
    // week — walk back to the most recent Monday
    const dow = now.getDay() // 0 = Sun … 6 = Sat
    const daysFromMonday = (dow + 6) % 7
    start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - daysFromMonday,
    )
  }
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  )
  return { start, end }
}

/** True when an ISO timestamp falls within an absolute window (inclusive).
 *  A null window = always true (all-time). A missing / unparseable timestamp is
 *  excluded once a window is set. Matches the server's own check in
 *  tradie-analytics so client KPIs and server analytics scope identically. */
export function inPeriod(
  createdAt: string | null,
  window: PeriodWindow | null,
): boolean {
  if (!window) return true
  if (!createdAt) return false
  const t = Date.parse(createdAt)
  if (Number.isNaN(t)) return false
  return t >= window.start.getTime() && t <= window.end.getTime()
}
