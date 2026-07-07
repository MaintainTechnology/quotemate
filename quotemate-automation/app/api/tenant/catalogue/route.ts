// /api/tenant/catalogue — WP2 operator materials catalogue
// (tenant_material_catalogue, migration 028).
//   GET  → list this tenant's catalogue rows
//   POST → create a row
//
// Mirrors /api/tenant/services for auth + ownership. Every query is
// scoped to the bearer's tenant, so a tradie can only ever see/create
// their own catalogue rows.

import { createClient } from '@supabase/supabase-js'
import { MaterialCatalogueSchema } from '@/lib/tenant/update-schema'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function tenantFromBearer(req: Request) {
  // Dual-auth: Clerk session token (→ clerk_user_id) OR legacy Supabase
  // token (→ owner_user_id). Resolver returns null for a missing/invalid
  // token AND for authed-but-no-tenant; both collapse to null here so the
  // call sites' existing 401 behaviour is preserved unchanged.
  const resolved = await resolveTenantRequest(supabase, req, 'id, trade, trades')
  return (resolved?.tenant ?? null) as { id: string; trade: string | null; trades: string[] | null } | null
}

function emptyToNull(v: string | undefined | null): string | null {
  if (v === undefined || v === null) return null
  const t = String(v).trim()
  return t === '' ? null : t
}

function allowedTradesOf(tenant: { trade: string | null; trades: string[] | null }) {
  return Array.isArray(tenant.trades) && tenant.trades.length > 0
    ? tenant.trades
    : tenant.trade
      ? [tenant.trade]
      : []
}

// ─── GET /api/tenant/catalogue ─────────────────────────────────────
export async function GET(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('tenant_material_catalogue')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('trade', { ascending: true })
    .order('category', { ascending: true })
    .order('name', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true, catalogue: data ?? [] })
}

// ─── POST /api/tenant/catalogue ────────────────────────────────────
export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = MaterialCatalogueSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_payload', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const allowed = allowedTradesOf(tenant)
  if (!allowed.includes(parsed.data.trade)) {
    return Response.json({ error: 'trade_not_owned', allowed }, { status: 400 })
  }

  const row = {
    tenant_id: tenant.id,
    trade: parsed.data.trade,
    category: parsed.data.category,
    name: parsed.data.name,
    brand: emptyToNull(parsed.data.brand),
    range_series: emptyToNull(parsed.data.range_series),
    supplier: emptyToNull(parsed.data.supplier),
    unit: parsed.data.unit?.trim() || 'each',
    unit_price_ex_gst: parsed.data.unit_price_ex_gst,
    customer_supply_price_ex_gst:
      parsed.data.customer_supply_price_ex_gst == null
        ? null
        : parsed.data.customer_supply_price_ex_gst,
    tier_hint: emptyToNull(parsed.data.tier_hint as string | undefined),
    image_path: emptyToNull(parsed.data.image_path),
    description: emptyToNull(parsed.data.description),
    cost_price_ex_gst:
      parsed.data.cost_price_ex_gst == null
        ? null
        : parsed.data.cost_price_ex_gst,
    is_preferred: parsed.data.is_preferred ?? false,
    active: parsed.data.active ?? true,
  }

  const { data, error } = await supabase
    .from('tenant_material_catalogue')
    .insert(row)
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      return Response.json(
        {
          error: 'duplicate_name',
          message: 'You already have a catalogue item with this name in this trade.',
        },
        { status: 409 },
      )
    }
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true, item: data })
}
