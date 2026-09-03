// GET /api/tenant/calendar — the tradie's bookings for the dashboard
// Calendar tab. Returns two lists:
//   • events      — quotes with a scheduled_at (self-serve request, reserved,
//                   confirmed, or paid+booked) in the past/future window.
//   • toSchedule  — PAID quotes with NO scheduled_at yet. The $99 site
//                   inspection is deliberately pay-first with no slot
//                   (lib/quote/booking.ts), and a deposit paid against an old
//                   SMS link can also land with no time chosen. These carry a
//                   real, money-in-hand commitment the tradie still has to
//                   arrange, so they must be visible even though the agenda
//                   query (which keys off scheduled_at) can't place them on a
//                   day.
// Read-only and tenant-scoped. See specs/dashboard-calendar-tab.md.
//
// Auth: Authorization: Bearer <supabase access token> → tenant resolved by
// owner_user_id (shared tenantFromBearer helper). Service role is used for
// the data read; isolation is the tenant_id filter.

import { tenantFromBearer, billingAdmin } from '@/lib/billing/auth'
import { tzForState } from '@/lib/quote/availability'

export const dynamic = 'force-dynamic'

// Bound the read so a long-lived tenant never returns an unbounded history.
const MAX_EVENTS = 500
// Past window widened 30 → 90 so recently-completed / recently-booked jobs
// stay visible in the agenda's "Past" group instead of silently vanishing
// (30 days hid nearly every real booking on active tenants).
const DEFAULT_PAST_DAYS = 90
const DEFAULT_FUTURE_DAYS = 120
// Paid-but-unscheduled items have no scheduled_at to age out on, so bound
// them by how recently they were paid — generous enough that an inspection
// left unscheduled for weeks keeps nagging, but not unbounded.
const TO_SCHEDULE_LOOKBACK_DAYS = 180
// Unscheduled inspection-routed quotes ("$99 site visit" leads the customer
// hasn't booked yet) are bounded by how recently the quote was drafted so the
// calendar surfaces live demand without dredging up stale leads.
const AWAITING_LOOKBACK_DAYS = 120
const MAX_AWAITING = 100

type CalendarEvent = {
  quoteId: string
  shareToken: string | null
  scheduledAt: string | null
  bookingState: string | null
  status: string | null
  paid: boolean
  paidTier: string | null
  paidAt: string | null
  needsInspection: boolean
  customerName: string | null
  customerPhone: string | null
  jobType: string | null
  address: string | null
  suburb: string | null
  source: string | null
  /** Open link for rows that don't live on quotes (roof/paint visits open
   *  /q/<trade>/<token>, not /q/<share_token>). Absent on quotes rows. */
  href?: string | null
}

type QuoteRow = {
  id: string
  share_token: string | null
  scheduled_at: string | null
  booking_state: string | null
  status: string | null
  paid_at: string | null
  paid_tier: string | null
  needs_inspection: boolean | null
  intake_id: string | null
}

type IntakeRow = {
  caller: { name?: string; phone?: string } | null
  job_type: string | null
  address: string | null
  suburb: string | null
  scope: { source?: string } | null
}

const QUOTE_COLS =
  'id, share_token, scheduled_at, booking_state, status, paid_at, paid_tier, needs_inspection, intake_id'

// Roofing/painting visits live in their OWN tables (migrations 165 + 167), not
// quotes — without these reads a booked or paid $99 site visit on those
// surfaces is invisible to the tradie's calendar.
const TRADE_VISIT_TABLES = [
  { table: 'roofing_measurements', jobType: 'roofing', hrefBase: '/q/roof/' },
  { table: 'painting_measurements', jobType: 'painting', hrefBase: '/q/paint/' },
] as const

const TRADE_VISIT_COLS =
  'id, public_token, scheduled_at, paid_at, paid_tier, customer_name, customer_phone, address'

type TradeVisitRow = {
  id: string
  public_token: string | null
  scheduled_at: string | null
  paid_at: string | null
  paid_tier: string | null
  customer_name: string | null
  customer_phone: string | null
  address: string | null
}

function tradeVisitEvent(
  row: TradeVisitRow,
  meta: (typeof TRADE_VISIT_TABLES)[number],
): CalendarEvent {
  return {
    quoteId: row.id,
    shareToken: null,
    href: row.public_token ? `${meta.hrefBase}${row.public_token}` : null,
    scheduledAt: row.scheduled_at ?? null,
    bookingState: null,
    status: null,
    paid: !!row.paid_at,
    paidTier: row.paid_tier ?? null,
    paidAt: row.paid_at ?? null,
    // The $99 site-visit rows render as "visit"; a painting row paid on a
    // real tier (good/better/best deposit, mig 156) is a won job, not a visit.
    needsInspection: !row.paid_tier || row.paid_tier === 'inspection',
    customerName: row.customer_name?.trim() || null,
    customerPhone: row.customer_phone?.trim() || null,
    jobType: meta.jobType,
    address: row.address ?? null,
    suburb: null,
    source: null,
  }
}

function clampIso(value: string | null, fallbackMs: number): string {
  if (value) {
    const t = Date.parse(value)
    if (Number.isFinite(t)) return new Date(t).toISOString()
  }
  return new Date(fallbackMs).toISOString()
}

function toEvent(q: QuoteRow, intake: IntakeRow | null): CalendarEvent {
  return {
    quoteId: q.id,
    shareToken: q.share_token ?? null,
    scheduledAt: q.scheduled_at ?? null,
    bookingState: q.booking_state ?? null,
    status: q.status ?? null,
    paid: !!q.paid_at,
    paidTier: q.paid_tier ?? null,
    paidAt: q.paid_at ?? null,
    needsInspection: !!q.needs_inspection,
    customerName: intake?.caller?.name?.trim() || null,
    customerPhone: intake?.caller?.phone?.trim() || null,
    jobType: intake?.job_type ?? null,
    address: intake?.address ?? null,
    suburb: intake?.suburb ?? null,
    source: intake?.scope?.source ?? null,
  }
}

export async function GET(req: Request) {
  const auth = await tenantFromBearer(req)
  if (!auth) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!auth.tenant) {
    return Response.json({ error: 'no_tenant' }, { status: 404 })
  }

  const url = new URL(req.url)
  const now = Date.now()
  const from = clampIso(url.searchParams.get('from'), now - DEFAULT_PAST_DAYS * 86_400_000)
  const to = clampIso(url.searchParams.get('to'), now + DEFAULT_FUTURE_DAYS * 86_400_000)

  const sb = billingAdmin()

  // Scheduled bookings — a chosen time in the [from, to] window.
  const { data: scheduled, error } = await sb
    .from('quotes')
    .select(QUOTE_COLS)
    .eq('tenant_id', auth.tenant.id)
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', from)
    .lte('scheduled_at', to)
    .order('scheduled_at', { ascending: true })
    .limit(MAX_EVENTS)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Paid-but-unscheduled — a paid $99 inspection (pay-first, no slot) or a
  // deposit paid with no time chosen. Bounded by paid_at recency.
  const paidSince = new Date(now - TO_SCHEDULE_LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data: unscheduled, error: unschedErr } = await sb
    .from('quotes')
    .select(QUOTE_COLS)
    .eq('tenant_id', auth.tenant.id)
    .is('scheduled_at', null)
    .not('paid_at', 'is', null)
    // Root rows only (spec post-visit-money-sequence R12). A post-site-visit
    // deposit or balance is paid-and-unscheduled by definition — the visit
    // already happened — so without this every child payment would nag the
    // tradie to schedule a visit that is behind them.
    .eq('quote_kind', 'initial')
    .gte('paid_at', paidSince)
    .order('paid_at', { ascending: false })
    .limit(MAX_EVENTS)

  if (unschedErr) {
    return Response.json({ error: unschedErr.message }, { status: 500 })
  }

  // Awaiting customer booking — inspection-routed quotes ("$99 site visit")
  // with no slot AND no payment yet. These are the live demand the tradie can
  // chase: a customer was sent a site-visit quote but hasn't booked it. Kept
  // separate from `toSchedule` (money already in hand) and bounded by recency.
  const awaitingSince = new Date(now - AWAITING_LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data: awaiting, error: awaitingErr } = await sb
    .from('quotes')
    .select(QUOTE_COLS)
    .eq('tenant_id', auth.tenant.id)
    .is('scheduled_at', null)
    .is('paid_at', null)
    .eq('needs_inspection', true)
    .gte('created_at', awaitingSince)
    .order('created_at', { ascending: false })
    .limit(MAX_AWAITING)

  if (awaitingErr) {
    return Response.json({ error: awaitingErr.message }, { status: 500 })
  }

  // Count of drafted quotes still waiting on the tradie's review (no slot,
  // routed to tradie_review). Surfaced as a nudge to the Quotes tab, not
  // rendered as calendar rows. head:true → count only, no rows over the wire.
  const { count: reviewCount } = await sb
    .from('quotes')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', auth.tenant.id)
    .is('scheduled_at', null)
    .eq('routing_decision', 'tradie_review')
    .eq('status', 'draft')

  // Join intakes for the customer-facing details (caller name/phone live in
  // the caller jsonb; job_type/address/suburb are columns; scope.source marks
  // self-serve web bookings). One lookup covers all three lists.
  const scheduledRows = (scheduled ?? []) as QuoteRow[]
  const unscheduledRows = (unscheduled ?? []) as QuoteRow[]
  const awaitingRows = (awaiting ?? []) as QuoteRow[]
  const intakeIds = Array.from(
    new Set(
      [...scheduledRows, ...unscheduledRows, ...awaitingRows]
        .map((q) => q.intake_id)
        .filter((id): id is string => !!id),
    ),
  )
  const intakeMap: Record<string, IntakeRow> = {}
  if (intakeIds.length > 0) {
    const { data: intakes } = await sb
      .from('intakes')
      .select('id, caller, job_type, address, suburb, scope')
      .in('id', intakeIds)
    for (const i of intakes ?? []) {
      intakeMap[i.id as string] = {
        caller: (i.caller as IntakeRow['caller']) ?? null,
        job_type: (i.job_type as string | null) ?? null,
        address: (i.address as string | null) ?? null,
        suburb: (i.suburb as string | null) ?? null,
        scope: (i.scope as IntakeRow['scope']) ?? null,
      }
    }
  }

  const events: CalendarEvent[] = scheduledRows
    .filter((q) => typeof q.scheduled_at === 'string')
    .map((q) => toEvent(q, q.intake_id ? intakeMap[q.intake_id] ?? null : null))

  const toSchedule: CalendarEvent[] = unscheduledRows.map((q) =>
    toEvent(q, q.intake_id ? intakeMap[q.intake_id] ?? null : null),
  )

  const awaitingBooking: CalendarEvent[] = awaitingRows.map((q) =>
    toEvent(q, q.intake_id ? intakeMap[q.intake_id] ?? null : null),
  )

  // Trade visits (roofing/painting measurement tables). The four reads are
  // independent — run them concurrently. Best-effort per query (pattern:
  // trade-jobs route): a failing read — e.g. a deploy before migration
  // 165/167 — skips that table rather than 500-ing the calendar.
  const tenantId = auth.tenant.id
  type TradeRead = {
    meta: (typeof TRADE_VISIT_TABLES)[number]
    dest: CalendarEvent[]
    query: PromiseLike<{ data: unknown; error: unknown }>
  }
  const tradeReads: TradeRead[] = TRADE_VISIT_TABLES.flatMap((meta) => [
    {
      meta,
      dest: events,
      query: sb
        .from(meta.table)
        .select(TRADE_VISIT_COLS)
        .eq('tenant_id', tenantId)
        .not('scheduled_at', 'is', null)
        .gte('scheduled_at', from)
        .lte('scheduled_at', to)
        .order('scheduled_at', { ascending: true })
        // supabase-js's chained generics blow TS's instantiation depth when
        // contextually typed inside this array — collapse to the thenable shape.
        .limit(MAX_EVENTS) as unknown as TradeRead['query'],
    },
    {
      meta,
      dest: toSchedule,
      query: sb
        .from(meta.table)
        .select(TRADE_VISIT_COLS)
        .eq('tenant_id', tenantId)
        .is('scheduled_at', null)
        .not('paid_at', 'is', null)
        .gte('paid_at', paidSince)
        .order('paid_at', { ascending: false })
        .limit(MAX_EVENTS) as unknown as TradeRead['query'],
    },
  ])
  const tradeResults = await Promise.all(tradeReads.map((r) => r.query))
  tradeReads.forEach((r, i) => {
    const { data, error } = tradeResults[i]
    if (error || !data) return
    for (const row of data as TradeVisitRow[]) r.dest.push(tradeVisitEvent(row, r.meta))
  })
  // Re-sort the merged lists so trade rows interleave with quotes rows.
  events.sort((a, b) => Date.parse(a.scheduledAt ?? '') - Date.parse(b.scheduledAt ?? ''))
  toSchedule.sort((a, b) => Date.parse(b.paidAt ?? '') - Date.parse(a.paidAt ?? ''))

  // tenantId powers the dashboard "New booking" button, which opens this
  // tenant's public self-serve booking page (/book/<tenantId>). tenantTz is
  // the tenant's state timezone so the Calendar tab groups days in the same
  // zone the slots were generated in.
  return Response.json({
    events,
    toSchedule,
    awaitingBooking,
    reviewCount: reviewCount ?? 0,
    tenantId: auth.tenant.id,
    tenantTz: tzForState(auth.tenant.state),
  })
}
