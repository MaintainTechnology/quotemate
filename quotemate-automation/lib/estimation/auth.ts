// Shared Bearer-token → tenant resolution for the estimator routes.
// Same pattern the other /api/tenant/* routes inline; extracted here so the
// three estimator routes don't each repeat it. Uses the service-role client.

import { createClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const estimatorSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export type EstimatorTenant = { id: string; trade: string | null; trades: string[] | null }

export async function tenantFromBearer(req: Request): Promise<EstimatorTenant | null> {
  // Dual-auth: Clerk session token OR legacy Supabase token → the caller's tenant.
  const resolved = await resolveTenantRequest(estimatorSupabase, req, 'id, trade, trades')
  return (resolved?.tenant as EstimatorTenant | null) ?? null
}
