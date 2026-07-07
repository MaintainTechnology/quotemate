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
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  // Dual-auth: Clerk session token (→ clerk_user_id) OR legacy Supabase token
  // (→ owner_user_id). The unlinked-row email self-heal now lives in
  // /api/tenant/me, which the dashboard always loads first, so by the time
  // analytics runs the tenant link exists for either provider.
  const resolved = await resolveTenantRequest(supabase, req, 'id')
  if (!resolved) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const tenantId = (resolved.tenant as { id: string } | null)?.id
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
