// /api/tenant/catalogue/stock-essentials — v7 Phase 2d.
//
// "Stock the essentials for my trade" — the one-click button that takes a
// brand-new tradie from "empty catalogue" to "AI can auto-quote my wedge"
// in under 5 seconds. Without this, the supplier_catalogue browse UI is
// technically functional but the 45-minute manual stocking step IS the
// onboarding tax that loses tradies to ServiceM8.
//
// What it does:
//   For each trade the tenant runs, picks ONE good-tier SKU per
//   essential category from supplier_catalogue, then calls the same
//   bulk-add logic /api/tenant/catalogue/bulk-add uses so the row gets
//   the granular→grounding category mapping and the supplier_catalogue_id
//   link. Idempotent — already-stocked SKUs are skipped.
//
// "Essential categories" are the easy-5 wedge categories per trade,
// not the full supplier catalogue. We avoid overstocking; the tradie
// browses the full library when they want range/best tiers.
//
// Bearer-authed + tenant-scoped, identical to /api/tenant/catalogue.

import { createClient } from '@supabase/supabase-js'
import { granularToGroundingCategory } from '@/lib/catalogue/category-mapping'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Essential supplier_catalogue categories per trade — the categories a
// brand-new tradie's first quotes MUST cover. The bulk-add logic picks
// one good-tier SKU from each, falling back to any tier if no `good` row
// exists for the category. Tuned to the easy-5 wedges in v3/v5.
const ESSENTIAL_CATEGORIES: Record<string, string[]> = {
  electrical: ['gpo', 'downlight', 'smoke_alarm', 'safety_switch', 'ceiling_fan', 'outdoor_light'],
  plumbing: ['tapware_basin', 'tapware_kitchen', 'toilet', 'hws_gas', 'hws_electric'],
}

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

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const trades = tradesOf(tenant)
  if (trades.length === 0) {
    return Response.json({ error: 'tenant_has_no_trades' }, { status: 400 })
  }

  // Pick one supplier row per (trade, essential category). Strategy:
  // prefer good-tier; fall back to any tier if no good exists. Sort by
  // brand so the choice is deterministic across runs.
  type PickedRow = {
    id: string
    trade: string
    category: string
    name: string
    brand: string
    range_series: string | null
    supplier_label: string | null
    default_unit: string
    default_unit_price_ex_gst: number | string
    tier_hint: string | null
    image_url: string | null
    description: string | null
  }
  const picked: PickedRow[] = []

  for (const trade of trades) {
    const essentials = ESSENTIAL_CATEGORIES[trade] ?? []
    if (essentials.length === 0) continue
    const { data: rows, error: rErr } = await supabase
      .from('supplier_catalogue')
      .select(
        'id, trade, category, name, brand, range_series, supplier_label, ' +
          'default_unit, default_unit_price_ex_gst, tier_hint, image_url, description',
      )
      .eq('trade', trade)
      .in('category', essentials)
      .is('retired_at', null)
      .order('category', { ascending: true })
      .order('brand', { ascending: true })
    if (rErr) {
      return Response.json({ error: rErr.message }, { status: 500 })
    }
    const byCategory = new Map<string, PickedRow[]>()
    for (const r of (rows ?? []) as unknown as PickedRow[]) {
      const arr = byCategory.get(r.category) ?? []
      arr.push(r)
      byCategory.set(r.category, arr)
    }
    for (const cat of essentials) {
      const candidates = byCategory.get(cat) ?? []
      if (candidates.length === 0) continue
      const good = candidates.find((c) => c.tier_hint === 'good') ?? candidates[0]
      picked.push(good)
    }
  }

  if (picked.length === 0) {
    return Response.json({
      ok: true,
      added: 0,
      total: 0,
      message: 'no supplier rows found for your trades — catalogue may not be seeded yet',
    })
  }

  // Skip anything the tenant has already linked. Same idempotency
  // guarantee as bulk-add — clicking the button twice doesn't duplicate.
  const { data: linked } = await supabase
    .from('tenant_material_catalogue')
    .select('supplier_catalogue_id')
    .eq('tenant_id', tenant.id)
    .in('supplier_catalogue_id', picked.map((p) => p.id))
  const alreadyStocked = new Set(
    (linked ?? [])
      .map((r: { supplier_catalogue_id: string | null }) => r.supplier_catalogue_id)
      .filter((id): id is string => !!id),
  )

  let added = 0
  let skipped = 0
  const failures: Array<{ id: string; reason: string }> = []

  for (const p of picked) {
    if (alreadyStocked.has(p.id)) {
      skipped++
      continue
    }
    const groundingCategory = granularToGroundingCategory(p.category)
    if (!groundingCategory) {
      failures.push({ id: p.id, reason: `unmapped category ${p.category}` })
      continue
    }
    const row = {
      tenant_id: tenant.id,
      trade: p.trade,
      category: groundingCategory,
      name: p.name,
      brand: p.brand,
      range_series: p.range_series,
      supplier: p.supplier_label,
      unit: p.default_unit || 'each',
      unit_price_ex_gst: p.default_unit_price_ex_gst,
      tier_hint: p.tier_hint,
      image_path: p.image_url,
      description: p.description,
      active: true,
      is_preferred: false,
      supplier_catalogue_id: p.id,
    }
    const { error: iErr } = await supabase
      .from('tenant_material_catalogue')
      .insert(row)
    if (iErr) {
      // Likely a duplicate name from a prior manual add — skip, don't fail.
      if (iErr.code === '23505') {
        skipped++
      } else {
        failures.push({ id: p.id, reason: iErr.message })
      }
      continue
    }
    added++
  }

  return Response.json({
    ok: true,
    added,
    skipped,
    total: picked.length,
    failures,
  })
}
