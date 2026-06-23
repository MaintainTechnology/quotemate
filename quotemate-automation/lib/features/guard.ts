// ════════════════════════════════════════════════════════════════════
// Server feature gate for TRADIE-FACING API routes.
//
// Resolves the request's `Authorization: Bearer <token>` to the tradie's
// tenant, then asserts the tenant's trades[] contains the gating slug. On
// failure it returns a ready-to-send {status, body} descriptor (401 no token,
// 404 no tenant, 403 feature_not_enabled) so a route can early-return.
//
// Do NOT use this on customer-facing public token routes (/api/*/q/[token],
// request/[token], confirm/[token], …) — those serve customers, not the
// tenant, and must keep working regardless of the tenant's feature set.
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { tenantHasFeature } from './catalog'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export type FeatureGateResult =
  | { ok: true; tenant: { id: string; trades: string[]; trade: string | null } }
  | { ok: false; status: number; body: { ok: false; error: string } }

/**
 * Resolve the authed tradie's tenant and assert it has `slug` in trades[].
 * Returns the tenant on success, or a {status, body} the route returns as-is.
 */
export async function requireFeature(req: Request, slug: string): Promise<FeatureGateResult> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return { ok: false, status: 401, body: { ok: false, error: 'unauthorized' } }
  }
  const token = auth.slice(7).trim()
  if (!token) {
    return { ok: false, status: 401, body: { ok: false, error: 'unauthorized' } }
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData.user) {
    return { ok: false, status: 401, body: { ok: false, error: 'unauthorized' } }
  }

  const { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .select('id, trade, trades')
    .eq('owner_user_id', userData.user.id)
    .maybeSingle()
  if (tErr) {
    return { ok: false, status: 500, body: { ok: false, error: tErr.message } }
  }
  if (!tenant) {
    return { ok: false, status: 404, body: { ok: false, error: 'no_tenant' } }
  }

  const trades: string[] = Array.isArray(tenant.trades) ? (tenant.trades as string[]) : []
  if (!tenantHasFeature(trades, slug)) {
    return { ok: false, status: 403, body: { ok: false, error: 'feature_not_enabled' } }
  }
  return {
    ok: true,
    tenant: { id: tenant.id as string, trades, trade: (tenant.trade as string | null) ?? null },
  }
}
