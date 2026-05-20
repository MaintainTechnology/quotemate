// /api/supplier-catalogue — v7 Phase 2b read endpoint for the
// "Browse supplier catalogue" UI in CatalogueTab.
//
// Returns ALL active supplier_catalogue rows for the authed tenant's
// trades, plus the set of supplier_catalogue_ids the tenant has ALREADY
// added to their own tenant_material_catalogue. The browse UI uses
// the latter to badge rows "already in your catalogue" so a tradie
// doesn't duplicate-add.
//
// Bearer-authed + tenant-scoped, mirrors /api/tenant/catalogue's auth.
// Service-role read on supplier_catalogue is fine — it's a global
// library, RLS-off (see migration 040 / docs/rls-design.md), and
// the per-trade filter scopes the payload by what the tradie does.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function tenantFromBearer(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, trade, trades')
    .eq('owner_user_id', data.user.id)
    .maybeSingle()
  if (!tenant) return null
  return tenant as { id: string; trade: string | null; trades: string[] | null }
}

function tradesOf(tenant: { trade: string | null; trades: string[] | null }): string[] {
  return Array.isArray(tenant.trades) && tenant.trades.length > 0
    ? tenant.trades
    : tenant.trade
      ? [tenant.trade]
      : []
}

export async function GET(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const trades = tradesOf(tenant)
  if (trades.length === 0) {
    return Response.json({ ok: true, supplier_rows: [], already_stocked: [] })
  }

  // Active (non-retired) supplier rows in the tenant's trades.
  const { data: supplierRows, error: sErr } = await supabase
    .from('supplier_catalogue')
    .select(
      'id, trade, category, brand, range_series, name, supplier_label, ' +
        'default_unit, default_unit_price_ex_gst, tier_hint, image_url, description, ' +
        'supplier_revision',
    )
    .in('trade', trades)
    .is('retired_at', null)
    .order('trade', { ascending: true })
    .order('category', { ascending: true })
    .order('brand', { ascending: true })
    .order('name', { ascending: true })

  if (sErr) return Response.json({ error: sErr.message }, { status: 500 })

  // Already-stocked supplier ids on this tenant's catalogue.
  const { data: linked, error: lErr } = await supabase
    .from('tenant_material_catalogue')
    .select('supplier_catalogue_id')
    .eq('tenant_id', tenant.id)
    .not('supplier_catalogue_id', 'is', null)

  if (lErr) return Response.json({ error: lErr.message }, { status: 500 })

  const already_stocked = Array.from(
    new Set(
      (linked ?? [])
        .map((r: { supplier_catalogue_id: string | null }) => r.supplier_catalogue_id)
        .filter((id): id is string => !!id),
    ),
  )

  return Response.json({
    ok: true,
    supplier_rows: supplierRows ?? [],
    already_stocked,
  })
}
