// /api/tenant/catalogue/bulk-add — v7 Phase 2b "Add to my catalogue"
// action for the supplier-catalogue browse UI.
//
// Takes an array of supplier_catalogue IDs, copies each one into the
// authed tenant's tenant_material_catalogue, applying the granular→
// grounding category mapping so the tenant row uses the same vocab as
// the rest of the tradie's catalogue (and matches the CatalogueTab
// dropdown's CATEGORIES). The original supplier_catalogue.id is
// preserved as supplier_catalogue_id (migration 042) so the supplier-
// refresh banner (deferred to Phase 5) can later compare revisions.
//
// Idempotent: skips supplier IDs the tenant has already linked (so a
// double-click in the UI doesn't error or duplicate). Returns per-id
// status so the UI can surface partial-success cases.
//
// Bearer-authed + tenant-scoped. Service-role write; RLS layer in 040
// is bypassed by service role exactly like /api/tenant/catalogue.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { granularToGroundingCategory } from '@/lib/catalogue/category-mapping'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BulkAddSchema = z.object({
  supplier_catalogue_ids: z.array(z.string().uuid()).min(1).max(100),
})

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

type BulkResult = {
  supplier_catalogue_id: string
  status: 'added' | 'already_stocked' | 'trade_mismatch' | 'supplier_not_found' | 'category_unknown' | 'insert_failed'
  tenant_catalogue_id?: string
  error?: string
}

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = BulkAddSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_payload', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const trades = tradesOf(tenant)
  if (trades.length === 0) {
    return Response.json({ error: 'tenant_has_no_trades' }, { status: 400 })
  }

  // Fetch the supplier rows.
  const { data: supplierRows, error: sErr } = await supabase
    .from('supplier_catalogue')
    .select(
      'id, trade, category, brand, range_series, name, supplier_label, ' +
        'default_unit, default_unit_price_ex_gst, tier_hint, image_url, description',
    )
    .in('id', parsed.data.supplier_catalogue_ids)
    .is('retired_at', null)

  if (sErr) return Response.json({ error: sErr.message }, { status: 500 })

  const supplierById = new Map<string, any>()
  for (const r of (supplierRows ?? []) as any[]) supplierById.set(r.id as string, r)

  // Already-linked supplier ids so we can skip duplicates.
  const { data: linked } = await supabase
    .from('tenant_material_catalogue')
    .select('supplier_catalogue_id')
    .eq('tenant_id', tenant.id)
    .in('supplier_catalogue_id', parsed.data.supplier_catalogue_ids)
  const alreadyStocked = new Set(
    (linked ?? [])
      .map((r: { supplier_catalogue_id: string | null }) => r.supplier_catalogue_id)
      .filter((id): id is string => !!id),
  )

  const results: BulkResult[] = []
  let added = 0

  for (const supplierId of parsed.data.supplier_catalogue_ids) {
    if (alreadyStocked.has(supplierId)) {
      results.push({ supplier_catalogue_id: supplierId, status: 'already_stocked' })
      continue
    }
    const s = supplierById.get(supplierId)
    if (!s) {
      results.push({ supplier_catalogue_id: supplierId, status: 'supplier_not_found' })
      continue
    }
    if (!trades.includes(s.trade)) {
      // The tenant doesn't run this trade — refuse the copy.
      results.push({ supplier_catalogue_id: supplierId, status: 'trade_mismatch' })
      continue
    }
    const groundingCategory = granularToGroundingCategory(s.category)
    if (!groundingCategory) {
      // Supplier row uses an unknown category — caller should add it to
      // the mapping or to CATEGORIES. Surface explicitly instead of
      // dropping a row into a category the dashboard dropdown can't show.
      results.push({
        supplier_catalogue_id: supplierId,
        status: 'category_unknown',
        error: `supplier category "${s.category}" has no grounding mapping`,
      })
      continue
    }

    // Build the tenant row. unit_price_ex_gst defaults to supplier RRP —
    // the tradie can edit it from the Catalogue tab. tier_hint, brand,
    // range_series, supplier_label all carry over. supplier_catalogue_id
    // links back so future refresh banners can compare revisions.
    const row = {
      tenant_id: tenant.id,
      trade: s.trade,
      category: groundingCategory,
      name: s.name,
      brand: s.brand,
      range_series: s.range_series,
      supplier: s.supplier_label,
      unit: s.default_unit || 'each',
      unit_price_ex_gst: s.default_unit_price_ex_gst,
      tier_hint: s.tier_hint,
      image_path: s.image_url,
      description: s.description,
      active: true,
      is_preferred: false,
      supplier_catalogue_id: s.id,
    }

    const { data: inserted, error: iErr } = await supabase
      .from('tenant_material_catalogue')
      .insert(row)
      .select('id')
      .single()

    if (iErr) {
      // Most likely a duplicate name (unique on tenant_id+trade+lower(name)
      // per migration 028). The browse UI should have shown the
      // already-stocked badge but a tradie can stock the same product
      // under different supplier IDs (or have manually added it earlier).
      results.push({
        supplier_catalogue_id: supplierId,
        status: 'insert_failed',
        error: iErr.code === '23505' ? 'duplicate name in your catalogue' : iErr.message,
      })
      continue
    }
    results.push({
      supplier_catalogue_id: supplierId,
      status: 'added',
      tenant_catalogue_id: inserted!.id as string,
    })
    added++
  }

  return Response.json({
    ok: true,
    added,
    total: parsed.data.supplier_catalogue_ids.length,
    results,
  })
}
