// POST /api/billing/checkout — start a subscription Checkout for the authed
// tradie. Body: { plan: 'starter'|'pro'|'crew', interval: 'month'|'year' }.
// Returns { url } to redirect to Stripe Checkout (14-day trial on Starter
// Monthly only; every other plan/interval bills immediately).

import { tenantFromBearer, billingAdmin } from '@/lib/billing/auth'
import {
  getOrCreateCustomer,
  createSubscriptionCheckout,
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
