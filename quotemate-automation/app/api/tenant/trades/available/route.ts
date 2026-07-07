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
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  // Dual-auth: Clerk session token (→ clerk_user_id) OR legacy Supabase token
  // (→ owner_user_id).
  const resolved = await resolveTenantRequest(supabase, req, 'id, trade, trades')
  if (!resolved) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const tenant = resolved.tenant as {
    id: string
    trade: string | null
    trades: string[] | null
  } | null
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
