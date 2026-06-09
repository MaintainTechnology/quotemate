// Shared Bearer-token → tenant resolution for the estimator routes.
// Same pattern the other /api/tenant/* routes inline; extracted here so the
// three estimator routes don't each repeat it. Uses the service-role client.

import { createClient } from '@supabase/supabase-js'

export const estimatorSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export type EstimatorTenant = { id: string; trade: string | null; trades: string[] | null }

export async function tenantFromBearer(req: Request): Promise<EstimatorTenant | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await estimatorSupabase.auth.getUser(token)
  if (error || !data.user) return null
  const { data: tenant } = await estimatorSupabase
    .from('tenants')
    .select('id, trade, trades')
    .eq('owner_user_id', data.user.id)
    .maybeSingle()
  if (!tenant) return null
  return tenant as EstimatorTenant
}
