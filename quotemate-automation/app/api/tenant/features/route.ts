// GET /api/tenant/features — lightweight per-tenant feature read for client
// page guards (FeatureGate). Returns the authed tenant's trades[] and the
// subset that are catalog feature slugs. Far cheaper than /api/tenant/me.

import { createClient } from '@supabase/supabase-js'
import { tenantFeatureSlugs } from '@/lib/features/catalog'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const token = auth.slice(7).trim()
  if (!token) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData.user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('trades')
    .eq('owner_user_id', userData.user.id)
    .maybeSingle()
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  const trades: string[] = Array.isArray(tenant?.trades) ? (tenant!.trades as string[]) : []
  return Response.json({ ok: true, trades, features: tenantFeatureSlugs(trades) })
}
