// GET /api/tenant/trades/available — list the trades a tradie can turn on
// from the dashboard (Account tab → Trades). Spec §10.
//
// Auth: Bearer <supabase-access-token> — resolves the tenant by
// owner_user_id.
//
// "Available" = a trade that is active, install/job-based (§2.1), carries
// a trade_pricing_defaults row (so activate_trade_for_tenant can seed the
// pricing_book — without it activation fails), and is NOT already on the
// tenant. The dashboard renders one "Activate" button per returned trade,
// which POSTs to /api/tenant/trades/activate.

import { createClient } from '@supabase/supabase-js'
import { listManageableTrades } from '@/lib/trades/manageable'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function userFromBearer(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

export async function GET(req: Request) {
  const user = await userFromBearer(req)
  if (!user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .select('id, trade, trades')
    .eq('owner_user_id', user.id)
    .maybeSingle()
  if (tErr) {
    return Response.json({ ok: false, error: tErr.message }, { status: 500 })
  }
  if (!tenant) {
    return Response.json({ ok: false, error: 'no_tenant' }, { status: 404 })
  }

  const owned = new Set<string>()
  if (tenant.trade) owned.add(tenant.trade as string)
  for (const t of (tenant.trades as string[] | null) ?? []) owned.add(t)

  // Every activatable trade (active, job-based, has pricing defaults), each
  // tagged with whether the tenant already owns it. The Account-tab Trades
  // section renders this as a toggle list (owned = on) and POSTs the chosen
  // set to /api/tenant/trades/reconcile. The registry read + defaults check
  // is shared with /reconcile via lib/trades/manageable.
  let registry
  try {
    registry = await listManageableTrades(supabase)
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'registry_unavailable' },
      { status: 500 },
    )
  }
  const manageable = registry.map((t) => ({ ...t, owned: owned.has(t.name) }))

  // `available` = the not-yet-owned subset, kept for the legacy per-trade
  // Activate card / any existing consumer.
  const available = manageable
    .filter((t) => !t.owned)
    .map((t) => ({ name: t.name, displayName: t.displayName }))

  return Response.json({
    ok: true,
    tenantId: tenant.id,
    owned: Array.from(owned),
    available,
    manageable,
  })
}
