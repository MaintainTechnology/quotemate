// POST /api/billing/portal — open the Stripe Customer Portal for the authed
// tradie (manage payment method, switch/cancel plan, view invoices).
// Returns { url }. 400 if the tenant has no Stripe customer yet (they've
// never started a subscription).

import { tenantFromBearer } from '@/lib/billing/auth'
import { createPortalSession } from '@/lib/stripe/billing'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const auth = await tenantFromBearer(req)
  if (!auth) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (!auth.tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })
  if (!auth.tenant.stripe_customer_id) {
    return Response.json({ error: 'no_customer' }, { status: 400 })
  }

  try {
    const url = await createPortalSession(auth.tenant.stripe_customer_id)
    return Response.json({ url })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return Response.json({ error: 'portal_failed', detail: msg }, { status: 500 })
  }
}
