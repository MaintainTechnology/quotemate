// POST /api/billing/checkout — start OR change a subscription for the authed
// tradie. Body: { plan: 'starter'|'pro'|'crew', interval: 'month'|'year' }.
//
// Two paths, auto-selected from whether the tenant already has a live
// subscription (trialing|active|past_due):
//   • Live subscription  → update it IN PLACE, prorated (no second sub, no
//     duplicate charge). Returns { updated: true, plan, interval }.
//   • No live subscription → start a new subscription Checkout (14-day trial
//     on Starter Monthly only). Returns { url } to redirect to Stripe.

import { tenantFromBearer, billingAdmin } from '@/lib/billing/auth'
import {
  getOrCreateCustomer,
  createSubscriptionCheckout,
  updateSubscriptionToPlan,
  isUpdatableStatus,
  isPlanId,
  isInterval,
} from '@/lib/stripe/billing'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const auth = await tenantFromBearer(req)
  if (!auth) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (!auth.tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const plan = (body as { plan?: unknown })?.plan
  const interval = (body as { interval?: unknown })?.interval
  if (!isPlanId(plan) || !isInterval(interval)) {
    return Response.json({ error: 'invalid_plan_or_interval' }, { status: 400 })
  }

  const tenant = auth.tenant
  try {
    // ── Existing live subscription → change plan IN PLACE (prorated) ──
    // Guard against the double-billing bug: never open a second
    // subscription Checkout when one is already live. Reuse the existing
    // subscription and let Stripe prorate. The webhook reconciles tenants.*.
    if (tenant.stripe_subscription_id && isUpdatableStatus(tenant.subscription_status)) {
      // No-op if they're already exactly on this plan+interval.
      if (tenant.subscription_plan === plan && tenant.subscription_interval === interval) {
        return Response.json({ updated: true, plan, interval, unchanged: true })
      }
      await updateSubscriptionToPlan({
        tenantId: tenant.id,
        subscriptionId: tenant.stripe_subscription_id,
        plan,
        interval,
      })
      return Response.json({ updated: true, plan, interval })
    }

    // ── No live subscription → start a new one via Checkout ──
    const customerId = await getOrCreateCustomer({
      tenantId: tenant.id,
      email: tenant.owner_email ?? auth.userEmail,
      name: tenant.business_name,
      existingCustomerId: tenant.stripe_customer_id,
      persist: async (cid) => {
        await billingAdmin()
          .from('tenants')
          .update({ stripe_customer_id: cid })
          .eq('id', tenant.id)
      },
    })

    const url = await createSubscriptionCheckout({
      tenantId: tenant.id,
      customerId,
      plan,
      interval,
    })
    return Response.json({ url })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return Response.json({ error: 'checkout_failed', detail: msg }, { status: 500 })
  }
}
