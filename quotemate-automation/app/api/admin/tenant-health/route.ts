// GET /api/admin/tenant-health — admin-gated health report for every tenant.
//
// Powers /admin/tenants (spec A6): per-tenant green/red required checks +
// overall Ready/Incomplete verdict, plus a global provisioning-mode banner
// (live vs stub) so the team never onboards a batch in stub mode (spec A8).
//
// Webhook verification is skipped here (it would mean one Twilio API call
// per tenant) — run scripts/verify-tenant.mjs for the live SmsUrl check.

import { createClient } from '@supabase/supabase-js'
import { isAdminUser } from '@/lib/admin-loader/auth'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { checkTenantHealth, type TenantHealth } from '@/lib/onboard/health'
import { checkAllTradesReadiness } from '@/lib/onboard/trade-readiness'
import { computePreflight } from '@/lib/onboard/preflight-logic'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  // Dual-auth: resolve the caller (Clerk or Supabase) + their tenant row.
  // admin_users is keyed by the SUPABASE auth id — for a Clerk caller that is
  // the mapped tenant.owner_user_id; for a Supabase caller it's their own id.
  const resolved = await resolveTenantRequest(supabase, req, 'owner_user_id')
  if (!resolved) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const subjectId =
    (resolved.tenant as { owner_user_id: string | null } | null)?.owner_user_id ??
    (resolved.identity.provider === 'supabase' ? resolved.identity.userId : null)
  const isAdmin = subjectId ? await isAdminUser(supabase, subjectId) : false
  if (!isAdmin) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('tenants')
    .select(
      'id, business_name, status, activated_at, owner_user_id, trade, trades, twilio_sms_number, twilio_number_sid, vapi_assistant_id',
    )
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  const tenants: TenantHealth[] = []
  for (const row of data ?? []) {
    try {
      const health = await checkTenantHealth(supabase, row as any, { checkWebhook: false })
      tenants.push(health)
    } catch (e: any) {
      tenants.push({
        tenantId: (row as any).id,
        businessName: (row as any).business_name ?? null,
        status: (row as any).status ?? null,
        trades: [],
        checks: [],
        ready: false,
        requiredFailures: [`health check failed: ${e?.message ?? String(e)}`],
      })
    }
  }

  const { summary } = computePreflight(process.env)
  const provisioningLive = summary.twilio_mode === 'real' && summary.vapi_mode === 'real'
  const tradeReadiness = await checkAllTradesReadiness(supabase)

  return Response.json({
    ok: true,
    provisioning: {
      twilio_mode: summary.twilio_mode,
      vapi_mode: summary.vapi_mode,
      live: provisioningLive,
      missing_for_activation: summary.missing_for_activation,
    },
    tradeReadiness,
    counts: {
      total: tenants.length,
      ready: tenants.filter((t) => t.ready).length,
      incomplete: tenants.filter((t) => !t.ready).length,
    },
    tenants,
  })
}
