// GET /api/billing/status — the authed tradie's current subscription state,
// read from the tenant mirror columns (synced by the Stripe webhook).
// Powers the dashboard Billing tab.

import { tenantFromBearer, billingAdmin } from '@/lib/billing/auth'
import { getMonthlyUsage } from '@/lib/billing/usage'
import { planLimits } from '@/lib/billing/entitlements'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = await tenantFromBearer(req)
  if (!auth) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (!auth.tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  const t = auth.tenant
  const usage = await getMonthlyUsage(billingAdmin(), t.id)
  const limits = planLimits(t.subscription_plan)
  return Response.json({
    has_customer: !!t.stripe_customer_id,
    status: t.subscription_status,
    plan: t.subscription_plan,
    interval: t.subscription_interval,
    current_period_end: t.subscription_current_period_end,
    trial_ends_at: t.trial_ends_at,
    cancel_at_period_end: !!t.subscription_cancel_at_period_end,
    usage,
    limits: limits
      ? { quotes: limits.quotes, voice: limits.voice, voiceMinutes: limits.voiceMinutes }
      : null,
  })
}
