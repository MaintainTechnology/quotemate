// /api/tenant/tier-ladder — v7 Phase 3.
//
//   GET    → ladder rows (category, tier, catalogue_id) joined with the
//            catalogue product name+brand for label rendering, PLUS the
//            tenant's full active catalogue grouped by category so the
//            picker UI can populate dropdowns.
//   POST   → upsert one ladder slot { category, tier, catalogue_id }.
//   DELETE ?category=X&tier=Y  → remove one slot.
//
// Money-path-adjacent: the rows here drive chooseMaterial()'s strongest
// override (Phase 3 wiring). Bearer-authed + tenant-scoped; service-role
// writes (RLS bypassed exactly like the rest of /api/tenant/*).

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

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

// GET — ladder + catalogue (for dropdowns).
export async function GET(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const trades = tradesOf(tenant)
  if (trades.length === 0) {
    return Response.json({ ok: true, ladder: [], catalogue_by_category: {} })
  }

  // Tenant's ladder rows.
  const { data: ladder, error: lErr } = await supabase
    .from('tenant_tier_ladder')
    .select('category, tier, catalogue_id, updated_at')
    .eq('tenant_id', tenant.id)
    .order('category', { ascending: true })
    .order('tier', { ascending: true })
  if (lErr) return Response.json({ error: lErr.message }, { status: 500 })

  // Tenant's active catalogue rows, used by the picker UI to populate
  // per-category dropdowns. Returned keyed by category for fast client
  // grouping. trade restricted to the tenant's trades for safety even
  // though tenant_id already scopes the read.
  const { data: catalogue, error: cErr } = await supabase
    .from('tenant_material_catalogue')
    .select('id, trade, category, name, brand, range_series, tier_hint')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .in('trade', trades)
    .order('category', { ascending: true })
    .order('brand', { ascending: true })
    .order('name', { ascending: true })
  if (cErr) return Response.json({ error: cErr.message }, { status: 500 })

  const catalogue_by_category: Record<string, typeof catalogue> = {}
  for (const row of (catalogue ?? []) as any[]) {
    const key = row.category as string
    if (!catalogue_by_category[key]) catalogue_by_category[key] = []
    ;(catalogue_by_category[key] as any[]).push(row)
  }

  return Response.json({
    ok: true,
    ladder: ladder ?? [],
    catalogue_by_category,
  })
}

// POST — upsert one slot.
const UpsertSchema = z.object({
  category: z.string().min(1).max(80),
  tier: z.enum(['good', 'better', 'best']),
  catalogue_id: z.string().uuid(),
})

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = UpsertSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_payload', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  // Verify the catalogue row belongs to this tenant — otherwise a tradie
  // could pin some other tenant's product into their ladder (and the FK
  // would silently let them since it doesn't include tenant_id).
  const { data: cat } = await supabase
    .from('tenant_material_catalogue')
    .select('id, tenant_id, category')
    .eq('id', parsed.data.catalogue_id)
    .maybeSingle()
  if (!cat || cat.tenant_id !== tenant.id) {
    return Response.json({ error: 'catalogue_id_not_owned' }, { status: 400 })
  }

  // We allow ladder.category ≠ catalogue.category — a tenant may file a
  // product under a different category for ladder purposes if their
  // recipe vocabulary differs. The estimator joins on (ladder.category,
  // tier) → catalogue_id, then reads that catalogue row's price/name; the
  // mismatch is benign as long as the tenant is intentional. Worth a
  // friendly warning, not a hard error.
  const row = {
    tenant_id: tenant.id,
    category: parsed.data.category,
    tier: parsed.data.tier,
    catalogue_id: parsed.data.catalogue_id,
  }
  const { error: upErr } = await supabase
    .from('tenant_tier_ladder')
    .upsert(row, { onConflict: 'tenant_id,category,tier' })
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 })

  return Response.json({
    ok: true,
    category: row.category,
    tier: row.tier,
    catalogue_id: row.catalogue_id,
    warning:
      cat.category && cat.category !== parsed.data.category
        ? `the chosen product's catalogue category (${cat.category}) differs from the ladder category (${parsed.data.category})`
        : undefined,
  })
}

// DELETE ?category=X&tier=Y
export async function DELETE(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const category = url.searchParams.get('category')
  const tier = url.searchParams.get('tier')
  if (!category || !tier || !['good', 'better', 'best'].includes(tier)) {
    return Response.json({ error: 'category_or_tier_missing' }, { status: 400 })
  }
  const { error } = await supabase
    .from('tenant_tier_ladder')
    .delete()
    .eq('tenant_id', tenant.id)
    .eq('category', category)
    .eq('tier', tier)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
