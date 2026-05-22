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

  // Active, job-based trades + their pricing-defaults presence. An inner
  // join would also work, but selecting the relation keeps the "has
  // defaults" decision explicit and easy to read.
  const { data: trades, error: trErr } = await supabase
    .from('trades')
    .select('name, display_name, is_job_based, active, trade_pricing_defaults(trade_id)')
    .eq('active', true)
    .eq('is_job_based', true)
    .order('display_name')
  if (trErr) {
    return Response.json({ ok: false, error: trErr.message }, { status: 500 })
  }

  const available = (trades ?? [])
    .filter((t) => {
      const name = t.name as string
      if (owned.has(name)) return false
      // trade_pricing_defaults comes back as an array (0 or 1 rows) from
      // the embedded relation — a trade with no defaults can't be activated.
      const defs = t.trade_pricing_defaults as unknown[] | null
      return Array.isArray(defs) && defs.length > 0
    })
    .map((t) => ({
      name: t.name as string,
      displayName:
        (t.display_name as string | null) ?? (t.name as string),
    }))

  return Response.json({
    ok: true,
    tenantId: tenant.id,
    owned: Array.from(owned),
    available,
  })
}
