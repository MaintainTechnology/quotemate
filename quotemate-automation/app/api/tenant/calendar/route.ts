// GET /api/tenant/calendar — the tradie's bookings for the dashboard
// Calendar tab. A booking is any quote for this tenant with a scheduled_at
// set (self-serve request, reserved, confirmed, or paid+booked). Read-only
// and tenant-scoped. See specs/dashboard-calendar-tab.md.
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

type CalendarEvent = {
  quoteId: string
  shareToken: string | null
  scheduledAt: string
  bookingState: string | null
  status: string | null
  paid: boolean
  paidTier: string | null
  customerName: string | null
  customerPhone: string | null
  jobType: string | null
  address: string | null
  suburb: string | null
  source: string | null
}

function clampIso(value: string | null, fallbackMs: number): string {
  if (value) {
    const t = Date.parse(value)
    if (Number.isFinite(t)) return new Date(t).toISOString()
  }
  return new Date(fallbackMs).toISOString()
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

  const { data: quotes, error } = await sb
    .from('quotes')
    .select('id, share_token, scheduled_at, booking_state, status, paid_at, paid_tier, intake_id')
    .eq('tenant_id', auth.tenant.id)
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', from)
    .lte('scheduled_at', to)
    .order('scheduled_at', { ascending: true })
    .limit(MAX_EVENTS)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Join intakes for the customer-facing details (caller name/phone live in
  // the caller jsonb; job_type/address/suburb are columns; scope.source marks
  // self-serve web bookings).
  const intakeIds = Array.from(
    new Set(
      (quotes ?? [])
        .map((q) => q.intake_id as string | null)
        .filter((id): id is string => !!id),
    ),
  )
  type IntakeRow = {
    caller: { name?: string; phone?: string } | null
    job_type: string | null
    address: string | null
    suburb: string | null
    scope: { source?: string } | null
  }
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

  const events: CalendarEvent[] = (quotes ?? [])
    .filter((q) => typeof q.scheduled_at === 'string')
    .map((q) => {
      const intake = q.intake_id ? intakeMap[q.intake_id as string] : null
      return {
        quoteId: q.id as string,
        shareToken: (q.share_token as string | null) ?? null,
        scheduledAt: q.scheduled_at as string,
        bookingState: (q.booking_state as string | null) ?? null,
        status: (q.status as string | null) ?? null,
        paid: !!q.paid_at,
        paidTier: (q.paid_tier as string | null) ?? null,
        customerName: intake?.caller?.name?.trim() || null,
        customerPhone: intake?.caller?.phone?.trim() || null,
        jobType: intake?.job_type ?? null,
        address: intake?.address ?? null,
        suburb: intake?.suburb ?? null,
        source: intake?.scope?.source ?? null,
      }
    })

  return Response.json({ events })
}
