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

export const dynamic = 'force-dynamic'

// Bound the read so a long-lived tenant never returns an unbounded history.
const MAX_EVENTS = 500
const DEFAULT_PAST_DAYS = 30
const DEFAULT_FUTURE_DAYS = 120
// Paid-but-unscheduled items have no scheduled_at to age out on, so bound
// them by how recently they were paid — generous enough that an inspection
// left unscheduled for weeks keeps nagging, but not unbounded.
const TO_SCHEDULE_LOOKBACK_DAYS = 180

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
    .gte('paid_at', paidSince)
    .order('paid_at', { ascending: false })
    .limit(MAX_EVENTS)

  if (unschedErr) {
    return Response.json({ error: unschedErr.message }, { status: 500 })
  }

  // Join intakes for the customer-facing details (caller name/phone live in
  // the caller jsonb; job_type/address/suburb are columns; scope.source marks
  // self-serve web bookings). One lookup covers both lists.
  const scheduledRows = (scheduled ?? []) as QuoteRow[]
  const unscheduledRows = (unscheduled ?? []) as QuoteRow[]
  const intakeIds = Array.from(
    new Set(
      [...scheduledRows, ...unscheduledRows]
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

  // tenantId powers the dashboard "New booking" button, which opens this
  // tenant's public self-serve booking page (/book/<tenantId>).
  return Response.json({ events, toSchedule, tenantId: auth.tenant.id })
}
