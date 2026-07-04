// GET /api/tenant/analytics — the authed tradie's OWN Overview analytics.
//
// Auth mirrors /api/tenant/me: Authorization: Bearer <supabase-access-token>,
// validated via supabase.auth.getUser, resolved to the tradie's tenant row by
// owner_user_id (with an owner_email self-heal fallback). Every read is scoped
// to that tenant_id, and the aggregation lives in lib/dashboard/tradie-analytics
// (pure, unit-tested) — this route is just auth + I/O.

import { createClient } from '@supabase/supabase-js'
import {
  buildTradieAnalytics,
  type TradieCallRow,
  type TradieCustomerRow,
  type TradieIntakeRow,
  type TradieQuoteRow,
  type TradieSmsRow,
} from '@/lib/dashboard/tradie-analytics'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function userFromBearer(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

/** Resolve the signed-in user's tenant id (owner_user_id, then owner_email). */
async function resolveTenantId(userId: string, email: string | undefined) {
  const primary = await supabase
    .from('tenants')
    .select('id')
    .eq('owner_user_id', userId)
    .maybeSingle()
  if (primary.data?.id) return primary.data.id as string
  if (email) {
    const byEmail = await supabase
      .from('tenants')
      .select('id')
      .eq('owner_email', email.toLowerCase())
      .maybeSingle()
    if (byEmail.data?.id) return byEmail.data.id as string
  }
  return null
}

export async function GET(req: Request) {
  const user = await userFromBearer(req)
  if (!user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const tenantId = await resolveTenantId(user.id, user.email)
  if (!tenantId) {
    return Response.json({ ok: false, error: 'no_tenant' }, { status: 404 })
  }

  const url = new URL(req.url)
  const weeksRaw = Number(url.searchParams.get('weeks') ?? '8')
  const weeks = Number.isFinite(weeksRaw)
    ? Math.min(26, Math.max(4, Math.trunc(weeksRaw)))
    : 8

  try {
    const [quotes, intakes, calls, sms, customers] = await Promise.all([
      supabase
        .from('quotes')
        .select(
          'id, tenant_id, intake_id, created_at, sent_at, accepted_at, paid_at, status, total_inc_gst, needs_inspection',
        )
        .eq('tenant_id', tenantId),
      supabase
        .from('intakes')
        .select('id, tenant_id, created_at, call_id, customer_id, job_type')
        .eq('tenant_id', tenantId),
      supabase
        .from('calls')
        .select('id, tenant_id, created_at, caller_number')
        .eq('tenant_id', tenantId),
      supabase
        .from('sms_conversations')
        .select(
          'id, tenant_id, intake_id, created_at, conversation_type, from_number, status',
        )
        .eq('tenant_id', tenantId),
      supabase
        .from('customers')
        .select('id, tenant_id, created_at')
        .eq('tenant_id', tenantId),
    ])

    const firstError =
      quotes.error || intakes.error || calls.error || sms.error || customers.error
    if (firstError) {
      return Response.json({ ok: false, error: firstError.message }, { status: 500 })
    }

    const analytics = buildTradieAnalytics(
      {
        quotes: (quotes.data ?? []) as TradieQuoteRow[],
        intakes: (intakes.data ?? []) as TradieIntakeRow[],
        calls: (calls.data ?? []) as TradieCallRow[],
        sms: (sms.data ?? []) as TradieSmsRow[],
        customers: (customers.data ?? []) as TradieCustomerRow[],
      },
      { now: new Date(), weeks },
    )

    return Response.json({ ok: true, analytics })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'query failed'
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
