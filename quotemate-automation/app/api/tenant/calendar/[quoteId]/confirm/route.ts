// POST /api/tenant/calendar/<quoteId>/confirm — tradie confirms a self-serve
// booking request from the dashboard Calendar tab. Advances booking_state
// from 'requested' to 'confirmed' (no deposit taken). Tenant-scoped: the
// update only matches a quote owned by the caller's tenant that is still in
// the 'requested' state, so confirming someone else's quote — or a quote
// that isn't a pending request — is a no-op 409. See
// specs/dashboard-calendar-tab.md.

import { tenantFromBearer, billingAdmin } from '@/lib/billing/auth'
import { BOOKING_STATE } from '@/lib/quote/hold'

export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  ctx: { params: Promise<{ quoteId: string }> },
) {
  const auth = await tenantFromBearer(req)
  if (!auth) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!auth.tenant) {
    return Response.json({ error: 'no_tenant' }, { status: 404 })
  }

  const { quoteId } = await ctx.params

  const sb = billingAdmin()
  const { data: updated, error } = await sb
    .from('quotes')
    .update({
      booking_state: BOOKING_STATE.CONFIRMED,
      last_status_at: new Date().toISOString(),
    })
    .eq('id', quoteId)
    .eq('tenant_id', auth.tenant.id)
    .eq('booking_state', BOOKING_STATE.REQUESTED)
    .select('id, booking_state')
    .maybeSingle()

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }
  if (!updated) {
    // No row matched — wrong tenant, unknown quote, or not a pending request.
    return Response.json(
      { ok: false, error: 'not_confirmable' },
      { status: 409 },
    )
  }

  return Response.json({ ok: true, bookingState: updated.booking_state })
}
