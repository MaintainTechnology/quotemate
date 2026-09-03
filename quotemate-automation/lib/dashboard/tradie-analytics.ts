// Tradie-facing Overview analytics — PURE aggregation for ONE tenant. No DB,
// no HTTP. The /api/tenant/analytics route fetches this tenant's rows and hands
// them here; every number the Overview "Your activity" section shows is derived
// here and unit-tested directly.
//
// Reuses the shared, DST-safe weekly bucketing + channel split from the company
// dashboard (lib/admin/metrics) rather than re-deriving them. Everything else
// (distinct texters/callers, the lead funnel, speed-to-quote, top job types,
// and the "needs your attention" actionables) is tradie-specific.

import {
  computeChannelSplit,
  computeWeeklyTrends,
  type SplitSlice,
  type WeeklyPoint,
} from '@/lib/admin/metrics'
import { asQuoteKind } from '@/lib/quote/mint-tier'

// ─── Input row shapes (single tenant; only the columns we need) ────────

export type TradieQuoteRow = {
  id: string
  tenant_id: string | null
  intake_id: string | null
  created_at: string | null
  sent_at: string | null
  accepted_at: string | null
  paid_at: string | null
  status: string | null
  total_inc_gst: number | string | null
  needs_inspection: boolean | null
  /** Mig 194 — 'final'/'balance' rows are further payments on a job this list
   *  already counts once. Absent on every pre-194 row ⇒ 'initial'. */
  quote_kind?: string | null
  /** Mig 194 — which root a child belongs to, so the acceptance a chained job
   *  earns can be attributed back to the row the funnel actually counts. */
  parent_quote_id?: string | null
  /** 'inspection' (the $99), 'deposit', 'credit' (the $99 covered it) or
   *  'balance'. A 'deposit'/'credit' on a final child IS the job's acceptance. */
  paid_tier?: string | null
}

export type TradieIntakeRow = {
  id: string
  tenant_id: string | null
  created_at: string | null
  call_id: string | null
  customer_id: string | null
  job_type: string | null
}

export type TradieCallRow = {
  id: string
  tenant_id: string | null
  created_at: string | null
  caller_number: string | null
}

export type TradieSmsRow = {
  id: string
  tenant_id: string | null
  intake_id: string | null
  created_at: string | null
  conversation_type: string | null
  from_number: string | null
  status: string | null
}

export type TradieCustomerRow = {
  id: string
  tenant_id: string | null
  created_at: string | null
}

export type TradieAnalyticsInput = {
  quotes: TradieQuoteRow[]
  intakes: TradieIntakeRow[]
  calls: TradieCallRow[]
  sms: TradieSmsRow[]
  customers: TradieCustomerRow[]
}

export type TradieAnalyticsOptions = {
  now: Date
  weeks: number
  /** Optional inclusive window as ISO instants [from, to] scoping the headline
   *  / funnel / speed / splits / needs-attention aggregates. The client resolves
   *  these on its own clock (lib/dashboard/period.ts) so scoping matches the
   *  tradie's local calendar. Absent (both undefined) = all-time, the historical
   *  behaviour. The weekly-trend chart deliberately ignores this and stays a
   *  rolling `weeks`-long trend. */
  from?: string
  to?: string
}

// ─── Output shape ──────────────────────────────────────────────────────

export type FunnelStage = { label: string; count: number }
export type LabelledCount = { label: string; count: number }

export type TradieAnalytics = {
  generatedAt: string
  weeks: number
  headline: {
    peopleTexting: number
    peopleCalling: number
    totalChats: number
    totalCalls: number
    totalRequests: number
    totalQuotes: number
    processedQuotes: number
    uniqueCustomers: number
  }
  needsAttention: {
    awaitingReview: number
    coldChats: number
    inspectionsToBook: number
  }
  speedToQuoteMinutes: number | null
  funnel: FunnelStage[]
  weeklyTrend: WeeklyPoint[]
  channelSplit: SplitSlice[]
  topJobTypes: LabelledCount[]
}

// ─── Helpers ───────────────────────────────────────────────────────────

/** SMS conversation types that represent a real customer (not the tradie's
 *  own onboarding registration thread). */
function isCustomerChat(s: TradieSmsRow): boolean {
  return s.conversation_type !== 'tradie_registration'
}

function toNum(v: number | string | null): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function parseTime(s: string | null): number | null {
  if (!s) return null
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? null : t
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

/** 'hot_water' → 'Hot water'; 'power_points' → 'Power points'. */
export function humanizeJobType(raw: string): string {
  const s = raw.replace(/[_-]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : raw
}

function distinct<T>(values: (T | null | undefined)[]): number {
  const set = new Set<T>()
  for (const v of values) if (v != null && v !== '') set.add(v)
  return set.size
}

/** Inclusive absolute-instant window test on a created_at timestamp. Bounds are
 *  epoch-ms, or null for an open side; no bounds = always true. Mirrors inPeriod
 *  (lib/dashboard/period.ts) so the server scoping matches the client's KPI
 *  scoping exactly — comparing instants, not date slices, so there is no
 *  UTC-vs-local calendar-day skew at window edges. */
function inInstantWindow(
  createdAt: string | null,
  fromMs: number | null,
  toMs: number | null,
): boolean {
  if (fromMs == null && toMs == null) return true
  if (!createdAt) return false
  const t = Date.parse(createdAt)
  if (Number.isNaN(t)) return false
  if (fromMs != null && t < fromMs) return false
  if (toMs != null && t > toMs) return false
  return true
}

// ─── Core ──────────────────────────────────────────────────────────────

export function buildTradieAnalytics(
  input: TradieAnalyticsInput,
  opts: TradieAnalyticsOptions,
): TradieAnalytics {
  const { now, weeks, from, to } = opts
  // Window the aggregation inputs. All-time (no from/to) leaves every row in,
  // so the historical output is byte-identical. The weekly-trend chart below
  // deliberately reads the UNwindowed input arrays for its rolling context.
  const fromMs =
    from != null && !Number.isNaN(Date.parse(from)) ? Date.parse(from) : null
  const toMs =
    to != null && !Number.isNaN(Date.parse(to)) ? Date.parse(to) : null
  const inWin = (c: string | null) => inInstantWindow(c, fromMs, toMs)
  // Root-only (spec post-visit-money-sequence R12). A chained job is three
  // rows — initial $99 → 'final' deposit → 'balance' — and one job. Counting
  // the children would treble Quotes, and their paid_at would treble the
  // funnel's Accepted stage off a single conversion.
  const rootQuotes = input.quotes.filter((q) => asQuoteKind(q.quote_kind) === 'initial')
  const quotes = rootQuotes.filter((q) => inWin(q.created_at))
  const intakes = input.intakes.filter((i) => inWin(i.created_at))
  const calls = input.calls.filter((c) => inWin(c.created_at))
  const customers = input.customers.filter((c) => inWin(c.created_at))
  const customerChats = input.sms
    .filter(isCustomerChat)
    .filter((s) => inWin(s.created_at))

  // Headline volume counters ----------------------------------------------
  const peopleTexting = distinct(customerChats.map((s) => s.from_number))
  const peopleCalling = distinct(calls.map((c) => c.caller_number))
  const uniqueConsumersFromIntakes = distinct(intakes.map((i) => i.customer_id))
  const uniqueCustomers =
    uniqueConsumersFromIntakes > 0
      ? uniqueConsumersFromIntakes
      : customers.length

  const processedQuotes = quotes.filter(
    (q) => !q.needs_inspection && toNum(q.total_inc_gst) != null,
  ).length

  // Lead funnel: request → quote → reached customer → accepted. "Sent" counts
  // any quote that reached the customer (sent_at) OR was accepted/paid — under
  // auto-send (Path B) accepted_at/paid_at get stamped without sent_at, so
  // folding them in keeps the funnel monotonic (Accepted can't exceed Sent).
  // R12 note — deliberately NO deposit-child attribution term here, unlike the
  // admin scorecard. "Issue final quote" requires the root's paid_at (the $99),
  // so by the time a final child can exist its root already satisfies the
  // `paid_at != null` clause below. Adding the term would be dead code AND
  // would break the Accepted ≤ Sent invariant this funnel relies on, since
  // reachedCount has no matching clause.
  const acceptedCount = quotes.filter(
    (q) => q.accepted_at != null || q.paid_at != null,
  ).length
  const reachedCount = quotes.filter(
    (q) => q.sent_at != null || q.accepted_at != null || q.paid_at != null,
  ).length
  const funnel: FunnelStage[] = [
    { label: 'Requests', count: intakes.length },
    { label: 'Quotes', count: quotes.length },
    { label: 'Sent', count: reachedCount },
    { label: 'Accepted', count: acceptedCount },
  ]

  // Needs-your-attention actionables --------------------------------------
  // Mirror the dashboard's canonical review filter (page.tsx quoteMatchesFilter):
  // production quotes carry status 'draft' (and a null status defaults to it),
  // so 'draft' MUST be in the set or this undercounts to ~0 on real data.
  const awaitingReview = quotes.filter((q) =>
    ['draft', 'drafted', 'awaiting_review', 'review'].includes(
      (q.status ?? 'draft').toLowerCase(),
    ),
  ).length
  const coldChats = customerChats.filter(
    (s) => (s.status ?? '').toLowerCase() === 'abandoned',
  ).length
  const inspectionsToBook = quotes.filter((q) => q.needs_inspection === true).length

  // Speed to quote: median minutes from request to drafted quote ----------
  // Map over ALL intakes (not just windowed) so a windowed quote can still
  // pair with its request even if that request lands just outside the window.
  const intakeCreatedById = new Map(
    input.intakes.map((i) => [i.id, i.created_at]),
  )
  const minutes: number[] = []
  for (const q of quotes) {
    if (!q.intake_id) continue
    const qt = parseTime(q.created_at)
    const it = parseTime(intakeCreatedById.get(q.intake_id) ?? null)
    if (qt == null || it == null) continue
    const mins = (qt - it) / 60_000
    if (mins >= 0 && mins <= 43_200) minutes.push(mins) // clamp 0..30d
  }
  const med = median(minutes)
  const speedToQuoteMinutes = med == null ? null : Math.round(med)

  // Top job types ---------------------------------------------------------
  const jobCounts = new Map<string, number>()
  for (const i of intakes) {
    const jt = (i.job_type ?? '').trim()
    if (!jt) continue
    jobCounts.set(jt, (jobCounts.get(jt) ?? 0) + 1)
  }
  const topJobTypes: LabelledCount[] = [...jobCounts.entries()]
    .map(([key, count]) => ({ label: humanizeJobType(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 5)

  return {
    generatedAt: now.toISOString(),
    weeks,
    headline: {
      peopleTexting,
      peopleCalling,
      totalChats: customerChats.length,
      totalCalls: calls.length,
      totalRequests: intakes.length,
      totalQuotes: quotes.length,
      processedQuotes,
      uniqueCustomers,
    },
    needsAttention: { awaitingReview, coldChats, inspectionsToBook },
    speedToQuoteMinutes,
    funnel,
    // Reuse the shared, DST-safe weekly bucketing (tenants:[] → signups unused).
    // Always the full rolling `weeks` window — a period filter scopes the
    // headline numbers, not this trend line's context.
    weeklyTrend: computeWeeklyTrends(
      { quotes: rootQuotes, intakes: input.intakes, tenants: [] },
      weeks,
      now,
    ),
    channelSplit: computeChannelSplit(intakes, customerChats),
    topJobTypes,
  }
}
