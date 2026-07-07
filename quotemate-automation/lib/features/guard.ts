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
import { resolveTenantRequest } from '@/lib/tenant/from-request'

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
  // Dual-auth: Clerk session token (→ clerk_user_id) OR legacy Supabase token
  // (→ owner_user_id) → the caller's tenant.
  const resolved = await resolveTenantRequest(supabase, req, 'id, trade, trades')
  if (!resolved) {
    return { ok: false, status: 401, body: { ok: false, error: 'unauthorized' } }
  }
  const tenant = resolved.tenant as { id: string; trade: string | null; trades: string[] | null } | null
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
