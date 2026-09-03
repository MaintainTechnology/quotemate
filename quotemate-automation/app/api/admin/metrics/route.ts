// GET /api/admin/metrics — cross-tenant company-performance metrics for the
// /admin/metrics dashboard (docs/superpowers/specs/2026-07-03-company-analytics-
// dashboard-design.md). Admin-only.
//
// resolveAdminUserId runs BEFORE any query: the reads use the service-role key
// (RLS-bypassing), so this gate is the only thing protecting every tenant's
// data — it fails closed (403) for a missing/invalid token or a non-admin.
//
// Volumes are tiny today, but we page through every table so a future growth
// past the PostgREST row ceiling can never silently under-count. All the maths
// lives in lib/admin/metrics.ts (pure, unit-tested); this route is just I/O.

import { createClient } from '@supabase/supabase-js'
import { resolveAdminUserId } from '@/lib/admin-loader/route-auth'
import {
  buildMetrics,
  type CallRow,
  type CustomerRow,
  type IntakeRow,
  type QuoteRow,
  type SmsConversationRow,
  type TenantRow,
} from '@/lib/admin/metrics'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const PAGE = 1000
const MAX_PAGES = 500 // safety backstop (~500k rows) against a runaway loop

/** Fetch every row of `table` for the given `columns`, paging until the table
 *  is exhausted. Advances by the actual page size so it stays correct even if
 *  the server caps a page below PAGE. Ordered by id for stable paging. */
async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = []
  let from = 0
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    // Terminate only on an empty page (not on rows.length < PAGE): a server that
    // caps a page below PAGE would otherwise short-circuit and under-count. The
    // cost is one extra empty query per table — negligible.
    if (rows.length === 0) break
    from += rows.length
  }
  return out
}

export async function GET(req: Request) {
  const adminId = await resolveAdminUserId(supabase, req)
  if (!adminId) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const weeksRaw = Number(url.searchParams.get('weeks') ?? '8')
  const weeks = Number.isFinite(weeksRaw)
    ? Math.min(26, Math.max(4, Math.trunc(weeksRaw)))
    : 8
  const includeTest = url.searchParams.get('includeTest') === 'true'

  try {
    const [tenants, quotes, intakes, calls, customers, smsConversations] =
      await Promise.all([
        fetchAll<TenantRow>(
          'tenants',
          'id, business_name, owner_email, trade, trades, status, subscription_plan, created_at',
        ),
        fetchAll<QuoteRow>(
          'quotes',
          'id, tenant_id, intake_id, created_at, sent_at, accepted_at, paid_at, status, quote_kind',
        ),
        fetchAll<IntakeRow>(
          'intakes',
          'id, tenant_id, created_at, call_id, customer_id, job_type',
        ),
        fetchAll<CallRow>('calls', 'id, tenant_id, created_at'),
        fetchAll<CustomerRow>('customers', 'id, tenant_id, created_at'),
        fetchAll<SmsConversationRow>(
          'sms_conversations',
          'id, tenant_id, intake_id, created_at, conversation_type',
        ),
      ])

    const metrics = buildMetrics(
      { tenants, quotes, intakes, calls, customers, smsConversations },
      { now: new Date(), weeks, includeTest },
    )

    return Response.json({ ok: true, metrics })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'query failed'
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
