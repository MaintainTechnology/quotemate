// POST /api/admin/customers/[id]/subscription — admin plan change/start
// for the customer console (R13/R14). Admin-only.
//
// Stripe is authoritative; the tenants.subscription_* columns are a MIRROR
// synced by /api/stripe/webhook. So this route NEVER writes those columns —
// it mutates Stripe and lets the webhook reconcile (the client shows a
// "syncing" state). Two paths, auto-selected from whether a subscription
// already exists:
//
//   • Existing subscription → update its item to the new plan/interval
//     price (qm_<plan>_<interval>), prorated. (R13)
//   • No subscription → ensure a Stripe customer, then CREATE a subscription
//     with a trial so no payment method is needed up front; status lands at
//     'trialing'. The tradie adds a card before trial end via the normal
//     billing flow. (R14)
//
// On ANY Stripe failure the route returns the error, changes no DB column,
// and writes NO audit row (R18) — a failed Stripe call fires no webhook, so
// the mirror stays correct.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { resolveAdminUserId } from '@/lib/admin-loader/route-auth'
import { getStripe } from '@/lib/stripe/client'
import {
  resolvePriceId,
  getOrCreateCustomer,
  isPlanId,
  isInterval,
} from '@/lib/stripe/billing'
import { TRIAL_DAYS } from '@/app/_components/pricing-data'
import { writeAuditLog } from '@/lib/admin/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const Body = z.object({ plan: z.string(), interval: z.string() })

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const adminId = await resolveAdminUserId(supabase, req)
  if (!adminId) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  const { id } = await params

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = Body.safeParse(raw)
  if (!parsed.success || !isPlanId(parsed.data.plan) || !isInterval(parsed.data.interval)) {
    return Response.json(
      { ok: false, error: 'validation_failed: plan must be starter|pro|crew, interval month|year' },
      { status: 400 },
    )
  }
  const plan = parsed.data.plan
  const interval = parsed.data.interval

  const { data: tenant, error: loadErr } = await supabase
    .from('tenants')
    .select(
      'id, business_name, owner_email, stripe_customer_id, stripe_subscription_id, subscription_plan, subscription_interval, subscription_status',
    )
    .eq('id', id)
    .maybeSingle()
  if (loadErr) {
    return Response.json({ ok: false, error: loadErr.message }, { status: 500 })
  }
  if (!tenant) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  // Resolve the Stripe price first — a missing price is a config error, not
  // a tenant error, and we want to fail before touching anything.
  let priceId: string
  try {
    priceId = await resolvePriceId(plan, interval)
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }

  const stripe = getStripe()
  const existingSubId = (tenant.stripe_subscription_id as string | null) ?? null
  let action: 'change_plan' | 'start_subscription'

  try {
    if (existingSubId) {
      // R13 — update the existing subscription's single item to the new price.
      const sub = await stripe.subscriptions.retrieve(existingSubId)
      const itemId = sub.items?.data?.[0]?.id
      if (!itemId) throw new Error('subscription has no line item to update')
      await stripe.subscriptions.update(existingSubId, {
        items: [{ id: itemId, price: priceId }],
        proration_behavior: 'create_prorations',
        metadata: { tenant_id: tenant.id as string, plan, interval },
      })
      action = 'change_plan'
    } else {
      // R14 — start a subscription. Ensure a customer, then create a trialing
      // sub so no payment method is required up front.
      const customerId = await getOrCreateCustomer({
        tenantId: tenant.id as string,
        email: (tenant.owner_email as string | null) ?? null,
        name: (tenant.business_name as string | null) ?? null,
        existingCustomerId: (tenant.stripe_customer_id as string | null) ?? null,
        persist: async (cid) => {
          await supabase.from('tenants').update({ stripe_customer_id: cid }).eq('id', tenant.id)
        },
      })
      await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        trial_period_days: TRIAL_DAYS,
        metadata: { tenant_id: tenant.id as string, plan, interval },
      })
      action = 'start_subscription'
    }
  } catch (e) {
    // Failed Stripe call: no webhook fires, mirror unchanged, no audit row.
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }

  // Success → audit only. The subscription_* columns are reconciled by the
  // webhook, so `after` records the REQUESTED plan; the client shows syncing.
  await writeAuditLog(supabase, {
    adminUserId: adminId,
    tenantId: tenant.id as string,
    action,
    before: {
      plan: (tenant.subscription_plan as string | null) ?? null,
      interval: (tenant.subscription_interval as string | null) ?? null,
      status: (tenant.subscription_status as string | null) ?? null,
    },
    after: { plan, interval },
  })

  return Response.json({ ok: true, action, plan, interval, syncing: true })
}
