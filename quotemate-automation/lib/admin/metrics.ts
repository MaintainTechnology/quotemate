// Company performance / usage analytics — PURE aggregation. No DB, no HTTP.
//
// The /admin/metrics route fetches raw rows (volumes are tiny — hundreds of
// rows) and hands them here; every number the dashboard shows is derived by
// these functions, so they are unit-tested directly against fixtures.
//
// Design notes:
//   • Week math is in Australia/Sydney local time (the business's timezone),
//     computed via Intl.DateTimeFormat — no tz library. Weeks start Monday.
//   • `now` is always injected so tests are deterministic.
//   • Rows with a NULL tenant_id are legacy pre-launch test traffic; they are
//     excluded from every attributed metric and surfaced as `unattributedRows`.
//   • Seed/pilot tenants (owner_email @quotemate.dev, or Pilot/Test/Demo
//     business names) are hidden unless `includeTest` is set.

// ─── Input row shapes (only the columns the metrics need) ──────────────

export type TenantRow = {
  id: string
  business_name: string | null
  owner_email: string | null
  trade: string | null
  trades: string[] | null
  status: string | null
  subscription_plan: string | null
  created_at: string | null
}

export type QuoteRow = {
  id: string
  tenant_id: string | null
  intake_id: string | null
  created_at: string | null
  sent_at: string | null
  accepted_at: string | null
  paid_at: string | null
  status: string | null
  /** quotes.quote_kind (mig 194). Absent on pre-chain callers → 'initial'. */
  quote_kind?: string | null
}

export type IntakeRow = {
  id: string
  tenant_id: string | null
  created_at: string | null
  call_id: string | null
  customer_id: string | null
  job_type: string | null
}

export type CallRow = {
  id: string
  tenant_id: string | null
  created_at: string | null
}

export type CustomerRow = {
  id: string
  tenant_id: string | null
  created_at: string | null
}

export type SmsConversationRow = {
  id: string
  tenant_id: string | null
  intake_id: string | null
  created_at: string | null
  conversation_type: string | null
}

export type MetricsInput = {
  tenants: TenantRow[]
  quotes: QuoteRow[]
  intakes: IntakeRow[]
  calls: CallRow[]
  customers: CustomerRow[]
  smsConversations: SmsConversationRow[]
}

export type MetricsOptions = {
  now: Date
  /** Number of weeks in the trend charts (caller clamps to a sane range). */
  weeks: number
  /** When false (default), seed/pilot tenants are excluded from every metric. */
  includeTest: boolean
}

// ─── Output shapes ─────────────────────────────────────────────────────

export type ScorecardMetrics = {
  activeTradies: number
  activeTradiesTarget: number
  newSignups: number
  requestsThisWeek: number
  requestsLastWeek: number
  requestsWoWDelta: number
  avgTurnaroundHours: number | null
  acceptanceRatePct: number | null
  sentCount: number
  acceptedCount: number
  repeatUsagePct: number | null
}

export type ActivityTotals = {
  totalQuotes: number
  totalIntakes: number
  uniqueConsumers: number
  totalCalls: number
  totalSmsConversations: number
  totalTradies: number
}

export type WeeklyPoint = {
  weekStart: string
  label: string
  quotes: number
  intakes: number
  signups: number
}

export type SplitSlice = {
  key: string
  label: string
  count: number
}

export type TenantStatus = 'new' | 'active' | 'dormant'

export type TenantUsageRow = {
  id: string
  businessName: string
  trades: string[]
  createdAt: string | null
  quotesTotal: number
  quotes7d: number
  uniqueConsumers: number
  lastActiveAt: string | null
  status: TenantStatus
}

export type PlatformMetrics = {
  generatedAt: string
  weeks: number
  includeTest: boolean
  realTenantCount: number
  testTenantCount: number
  unattributedRows: number
  scorecard: ScorecardMetrics
  activity: ActivityTotals
  trends: WeeklyPoint[]
  channelSplit: SplitSlice[]
  tradeSplit: SplitSlice[]
  tenants: TenantUsageRow[]
}

// ─── Constants ─────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const AU_TZ = 'Australia/Sydney'
const ACTIVE_TRADIES_TARGET = 10
/** A tradie counts as "active" if their last activity is within this window. */
const ACTIVE_WINDOW_DAYS = 14
/** A never-active tenant that joined within this window counts as "new". */
const NEW_WINDOW_DAYS = 7
const TEST_EMAIL_DOMAINS = ['quotemate.dev', 'example.com', 'example.org']
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

// ─── Small helpers ─────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** True if a tenant looks like a seed/pilot/test account.
 *  Detection is by seed-email domain + Pilot/Test/Demo business name ONLY.
 *  It deliberately does NOT key off `status`: a genuine new tradie sits at
 *  status 'onboarding' until activation, and hiding non-active tenants would
 *  zero out the "New sign-ups this week" metric — the opposite of intent. */
export function isTestTenant(t: TenantRow): boolean {
  const email = (t.owner_email ?? '').toLowerCase()
  const domain = email.includes('@') ? email.split('@')[1] : ''
  if (TEST_EMAIL_DOMAINS.includes(domain)) return true
  const name = (t.business_name ?? '').trim()
  return /^(pilot|test|demo)\b/i.test(name)
}

/** The Sydney-local calendar date of `date` as {y, m, d} (m is 1-12). */
function sydneyParts(date: Date): { y: number; m: number; d: number } {
  // en-CA formats as YYYY-MM-DD, which is trivial to split.
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: AU_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  const [y, m, d] = s.split('-').map((p) => Number(p))
  return { y, m, d }
}

/** The Monday (in Sydney local time) of the week containing `date`, as a
 *  'YYYY-MM-DD' key. Bucketing happens in Sydney-calendar space so DST never
 *  splits a week. */
export function sydneyWeekStart(date: Date): string {
  const { y, m, d } = sydneyParts(date)
  const anchor = new Date(Date.UTC(y, m - 1, d))
  const dow = anchor.getUTCDay() // 0=Sun … 6=Sat
  const sinceMonday = (dow + 6) % 7
  anchor.setUTCDate(anchor.getUTCDate() - sinceMonday)
  return anchor.toISOString().slice(0, 10)
}

/** Shift a 'YYYY-MM-DD' week key by a number of days, returning a new key. */
function shiftKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Short display label for a week key, e.g. '3 Jul'. */
function weekLabel(key: string): string {
  const d = new Date(`${key}T00:00:00Z`)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

function weekStartOf(s: string | null): string | null {
  const d = parseDate(s)
  return d ? sydneyWeekStart(d) : null
}

// ─── Core ──────────────────────────────────────────────────────────────

/** Compose the full metrics object from raw rows. Every sub-metric respects
 *  the `includeTest` filter and excludes NULL-tenant (unattributed) rows. */
export function buildMetrics(
  input: MetricsInput,
  opts: MetricsOptions,
): PlatformMetrics {
  const { now, weeks, includeTest } = opts

  const realTenants = input.tenants.filter((t) => !isTestTenant(t))
  const testTenants = input.tenants.filter((t) => isTestTenant(t))
  const shownTenants = includeTest ? input.tenants : realTenants
  const allowed = new Set(shownTenants.map((t) => t.id))
  const tenantById = new Map(input.tenants.map((t) => [t.id, t]))

  // Rows scoped to the tenants we are showing.
  // Root rows only (spec post-visit-money-sequence R12). A chained job is
  // three quotes rows — initial $99 → 'final' deposit → 'balance' — but ONE
  // job: counting the children would treble the quote volume and, because
  // each child carries its own accepted_at/paid_at, inflate the acceptance
  // rate off a single real conversion.
  const quotes = input.quotes.filter(
    (q) =>
      q.tenant_id != null &&
      allowed.has(q.tenant_id) &&
      (q.quote_kind ?? 'initial') === 'initial',
  )
  const intakes = input.intakes.filter((i) => i.tenant_id != null && allowed.has(i.tenant_id))
  const calls = input.calls.filter((c) => c.tenant_id != null && allowed.has(c.tenant_id))
  const customers = input.customers.filter((c) => c.tenant_id != null && allowed.has(c.tenant_id))
  const sms = input.smsConversations.filter((s) => s.tenant_id != null && allowed.has(s.tenant_id))

  const unattributedRows =
    input.quotes.filter((q) => q.tenant_id == null).length +
    input.intakes.filter((i) => i.tenant_id == null).length

  return {
    generatedAt: now.toISOString(),
    weeks,
    includeTest,
    realTenantCount: realTenants.length,
    testTenantCount: testTenants.length,
    unattributedRows,
    scorecard: computeScorecard({ quotes, intakes, tenants: shownTenants }, now),
    activity: computeActivityTotals({ quotes, intakes, calls, customers, sms, tenantCount: shownTenants.length }),
    trends: computeWeeklyTrends({ quotes, intakes, tenants: shownTenants }, weeks, now),
    channelSplit: computeChannelSplit(intakes, sms),
    tradeSplit: computeTradeSplit(quotes, tenantById),
    tenants: computeTenantUsage(shownTenants, quotes, intakes, now),
  }
}

/** Distinct tenant_ids that had an intake or quote created in `weekKey`. */
function activeTenantsInWeek(
  quotes: QuoteRow[],
  intakes: IntakeRow[],
  weekKey: string,
): Set<string> {
  const set = new Set<string>()
  for (const i of intakes) {
    if (i.tenant_id && weekStartOf(i.created_at) === weekKey) set.add(i.tenant_id)
  }
  for (const q of quotes) {
    if (q.tenant_id && weekStartOf(q.created_at) === weekKey) set.add(q.tenant_id)
  }
  return set
}

export function computeScorecard(
  data: { quotes: QuoteRow[]; intakes: IntakeRow[]; tenants: TenantRow[] },
  now: Date,
): ScorecardMetrics {
  const { quotes, intakes, tenants } = data
  const thisWeek = sydneyWeekStart(now)
  const lastWeek = shiftKey(thisWeek, -7)

  const activeThis = activeTenantsInWeek(quotes, intakes, thisWeek)
  const activeLast = activeTenantsInWeek(quotes, intakes, lastWeek)

  const newSignups = tenants.filter((t) => weekStartOf(t.created_at) === thisWeek).length

  const requestsThisWeek = intakes.filter((i) => weekStartOf(i.created_at) === thisWeek).length
  const requestsLastWeek = intakes.filter((i) => weekStartOf(i.created_at) === lastWeek).length

  // Turnaround: quote.created_at − matched intake.created_at, for quotes drafted
  // this week. Drop negatives and absurd outliers (>30d) from stale test data.
  const intakeCreatedById = new Map(intakes.map((i) => [i.id, i.created_at]))
  const turnarounds: number[] = []
  for (const q of quotes) {
    if (weekStartOf(q.created_at) !== thisWeek || !q.intake_id) continue
    const qt = parseDate(q.created_at)
    const it = parseDate(intakeCreatedById.get(q.intake_id) ?? null)
    if (!qt || !it) continue
    const hours = (qt.getTime() - it.getTime()) / 3_600_000
    if (Number.isFinite(hours) && hours >= 0 && hours <= 720) turnarounds.push(hours)
  }
  const avgTurnaroundHours =
    turnarounds.length > 0
      ? round2(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length)
      : null

  // Acceptance is all-time (windowing it at current low volume would just read 0).
  // Accepted must be a SUBSET of sent so the rate can never exceed 100%: Path B
  // can stamp accepted_at without sent_at (a shared-link acceptance after the
  // auto-SMS failed, or a Stripe-paid quote whose sent_at was never written), and
  // counting those in the numerator but not the denominator would inflate it.
  const sentCount = quotes.filter((q) => q.sent_at != null).length
  const acceptedCount = quotes.filter(
    (q) => q.accepted_at != null && q.sent_at != null,
  ).length
  const acceptanceRatePct = sentCount > 0 ? round2((acceptedCount / sentCount) * 100) : null

  // Weekly repeat usage: of tradies active last week, the share also active this week.
  let repeatUsagePct: number | null = null
  if (activeLast.size > 0) {
    let retained = 0
    for (const id of activeLast) if (activeThis.has(id)) retained += 1
    repeatUsagePct = round2((retained / activeLast.size) * 100)
  }

  return {
    activeTradies: activeThis.size,
    activeTradiesTarget: ACTIVE_TRADIES_TARGET,
    newSignups,
    requestsThisWeek,
    requestsLastWeek,
    requestsWoWDelta: requestsThisWeek - requestsLastWeek,
    avgTurnaroundHours,
    acceptanceRatePct,
    sentCount,
    acceptedCount,
    repeatUsagePct,
  }
}

export function computeActivityTotals(data: {
  quotes: QuoteRow[]
  intakes: IntakeRow[]
  calls: CallRow[]
  customers: CustomerRow[]
  sms: SmsConversationRow[]
  tenantCount: number
}): ActivityTotals {
  const consumerIds = new Set<string>()
  for (const i of data.intakes) if (i.customer_id) consumerIds.add(i.customer_id)
  // Fall back to the customers table for tenants whose intakes predate customer linking.
  const uniqueConsumers = consumerIds.size > 0 ? consumerIds.size : data.customers.length
  return {
    totalQuotes: data.quotes.length,
    totalIntakes: data.intakes.length,
    uniqueConsumers,
    totalCalls: data.calls.length,
    totalSmsConversations: data.sms.length,
    totalTradies: data.tenantCount,
  }
}

export function computeWeeklyTrends(
  data: { quotes: QuoteRow[]; intakes: IntakeRow[]; tenants: TenantRow[] },
  weeks: number,
  now: Date,
): WeeklyPoint[] {
  const thisWeek = sydneyWeekStart(now)
  const keys: string[] = []
  for (let i = weeks - 1; i >= 0; i -= 1) keys.push(shiftKey(thisWeek, -7 * i))

  const quoteWeeks = data.quotes.map((q) => weekStartOf(q.created_at))
  const intakeWeeks = data.intakes.map((i) => weekStartOf(i.created_at))
  const signupWeeks = data.tenants.map((t) => weekStartOf(t.created_at))

  return keys.map((key) => ({
    weekStart: key,
    label: weekLabel(key),
    quotes: quoteWeeks.filter((w) => w === key).length,
    intakes: intakeWeeks.filter((w) => w === key).length,
    signups: signupWeeks.filter((w) => w === key).length,
  }))
}

export function computeChannelSplit(
  intakes: IntakeRow[],
  sms: SmsConversationRow[],
): SplitSlice[] {
  const smsIntakeIds = new Set<string>()
  for (const s of sms) if (s.intake_id) smsIntakeIds.add(s.intake_id)

  let voice = 0
  let smsCount = 0
  let portal = 0
  for (const i of intakes) {
    if (i.call_id) voice += 1
    else if (smsIntakeIds.has(i.id)) smsCount += 1
    else portal += 1
  }
  return [
    { key: 'voice', label: 'Voice', count: voice },
    { key: 'sms', label: 'SMS', count: smsCount },
    { key: 'portal', label: 'Portal', count: portal },
  ]
}

export function computeTradeSplit(
  quotes: QuoteRow[],
  tenantById: Map<string, TenantRow>,
): SplitSlice[] {
  const counts = new Map<string, number>()
  for (const q of quotes) {
    const trade = (q.tenant_id ? tenantById.get(q.tenant_id)?.trade : null) ?? 'unknown'
    counts.set(trade, (counts.get(trade) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

export function computeTenantUsage(
  tenants: TenantRow[],
  quotes: QuoteRow[],
  intakes: IntakeRow[],
  now: Date,
): TenantUsageRow[] {
  const nowMs = now.getTime()
  const sevenDaysAgo = nowMs - 7 * DAY_MS

  const rows = tenants.map((t) => {
    const tQuotes = quotes.filter((q) => q.tenant_id === t.id)
    const tIntakes = intakes.filter((i) => i.tenant_id === t.id)

    const quotes7d = tQuotes.filter((q) => {
      const d = parseDate(q.created_at)
      return d != null && d.getTime() >= sevenDaysAgo
    }).length

    const consumers = new Set<string>()
    for (const i of tIntakes) if (i.customer_id) consumers.add(i.customer_id)

    let lastActive = 0
    for (const q of tQuotes) {
      const d = parseDate(q.created_at)
      if (d && d.getTime() > lastActive) lastActive = d.getTime()
    }
    for (const i of tIntakes) {
      const d = parseDate(i.created_at)
      if (d && d.getTime() > lastActive) lastActive = d.getTime()
    }

    const createdMs = parseDate(t.created_at)?.getTime() ?? null
    let status: TenantStatus
    if (lastActive > 0 && nowMs - lastActive <= ACTIVE_WINDOW_DAYS * DAY_MS) {
      status = 'active'
    } else if (
      lastActive === 0 &&
      createdMs != null &&
      nowMs - createdMs <= NEW_WINDOW_DAYS * DAY_MS
    ) {
      status = 'new'
    } else {
      status = 'dormant'
    }

    const trades =
      Array.isArray(t.trades) && t.trades.length > 0
        ? t.trades
        : t.trade
          ? [t.trade]
          : []

    return {
      id: t.id,
      businessName: t.business_name ?? '—',
      trades,
      createdAt: t.created_at,
      quotesTotal: tQuotes.length,
      quotes7d,
      uniqueConsumers: consumers.size,
      lastActiveAt: lastActive > 0 ? new Date(lastActive).toISOString() : null,
      status,
    }
  })

  rows.sort(
    (a, b) => b.quotesTotal - a.quotesTotal || a.businessName.localeCompare(b.businessName),
  )
  return rows
}
