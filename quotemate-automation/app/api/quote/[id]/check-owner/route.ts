// GET /api/quote/[id]/check-owner
//
// Lightweight authorisation probe used by the tradie-edit UI on the
// customer-facing quote page (/q/<token>). The UI mounts a client
// component on every quote page load that calls this endpoint with the
// caller's Supabase Bearer token; on success the "Edit quote" affordance
// renders. Visitors without a session, or signed-in tradies viewing
// someone else's quote, get { owner: false } and the edit panel stays
// hidden so the customer view is undisturbed.
//
// This endpoint does NOT expose the quote payload — it only confirms
// ownership. Editing happens via POST /api/quote/[id]/edit which does
// the same auth check before mutating.

import { createClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quoteId } = await params

  // Dual-auth: Clerk session token (→ clerk_user_id) OR legacy Supabase token
  // (→ owner_user_id). resolveTenantRequest returns null for a missing / empty
  // / invalid token, so the three legacy reason codes (no_session / empty_bearer
  // / bad_token) collapse to 'no_session' — the caller only needs owner:false to
  // keep the edit affordance hidden.
  const resolved = await resolveTenantRequest(supabase, req, 'id, business_name')
  if (!resolved) {
    return Response.json({ owner: false, reason: 'no_session' })
  }
  const tenant = resolved.tenant as { id: string; business_name: string | null } | null

  // Load the quote and confirm the caller's resolved tenant owns it. The
  // single round trip keeps the latency of the page-load owner check below
  // 100ms.
  const { data: quote } = await supabase
    .from('quotes')
    .select('id, tenant_id, paid_at')
    .eq('id', quoteId)
    .maybeSingle()
  if (!quote) return Response.json({ owner: false, reason: 'no_quote' })
  if (!quote.tenant_id) {
    // Legacy pre-v6 quotes without tenant scoping — nobody "owns" them in
    // the multi-tenant sense. Refuse edit access.
    return Response.json({ owner: false, reason: 'unscoped_quote' })
  }

  if (!tenant || quote.tenant_id !== tenant.id) {
    return Response.json({ owner: false, reason: 'not_owner' })
  }

  return Response.json({
    owner: true,
    tenantBusinessName: tenant.business_name,
    paid: !!quote.paid_at,
  })
}
