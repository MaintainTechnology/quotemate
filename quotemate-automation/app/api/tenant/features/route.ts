// GET /api/tenant/features — lightweight per-tenant feature read for client
// page guards (FeatureGate). Returns the authed tenant's trades[] and the
// subset that are catalog feature slugs. Far cheaper than /api/tenant/me.

import { createClient } from '@supabase/supabase-js'
import { tenantFeatureSlugs } from '@/lib/features/catalog'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  // Dual-auth: Clerk session token (→ clerk_user_id) OR legacy Supabase token
  // (→ owner_user_id). No token → 401. A missing tenant deliberately degrades
  // to empty trades (page guards treat "no features" as the safe closed
  // state) rather than 404 — preserving the original behaviour.
  const resolved = await resolveTenantRequest(supabase, req, 'trades')
  if (!resolved) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const tenant = resolved.tenant as { trades?: string[] | null } | null
  const trades: string[] = Array.isArray(tenant?.trades) ? (tenant!.trades as string[]) : []
  return Response.json({ ok: true, trades, features: tenantFeatureSlugs(trades) })
}
