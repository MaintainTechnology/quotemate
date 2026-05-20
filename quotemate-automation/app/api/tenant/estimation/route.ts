// /api/tenant/estimation — WP3 read-only "how each job is estimated".
//
// For every shared assembly that has a structured bill of materials
// (shared_assembly_bom, migration 028), returns the BOM lines plus the
// EFFECTIVE labour-hours + markup, resolved global-vs-local via the
// tested effectiveAssembly() helper. Pure read — no writes. Bearer-auth
// + tenant-scoped exactly like /api/tenant/catalogue.

import { createClient } from '@supabase/supabase-js'
import { effectiveAssembly } from '@/lib/estimate/catalogue'

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

export async function GET(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const trades =
    Array.isArray(tenant.trades) && tenant.trades.length > 0
      ? tenant.trades
      : tenant.trade
        ? [tenant.trade]
        : []

  // Per-trade global markup from this tenant's own pricing book (WP1:
  // strictly tenant-scoped — never another tradie's book).
  const { data: books } = await supabase
    .from('pricing_book')
    .select('trade, default_markup_pct, hourly_rate')
    .eq('tenant_id', tenant.id)
  const markupByTrade = new Map<string, number>()
  const hourlyByTrade = new Map<string, number>()
  for (const b of books ?? []) {
    markupByTrade.set(b.trade as string, Number(b.default_markup_pct))
    hourlyByTrade.set(b.trade as string, Number(b.hourly_rate))
  }

  // Structured BOM joined to its shared assembly (name + global labour).
  let bomQ = supabase
    .from('shared_assembly_bom')
    .select(
      'material_category, quantity, required, description, sort, ' +
        'shared_assemblies!inner ( id, name, trade, default_labour_hours, default_unit_price_ex_gst )',
    )
    .order('sort', { ascending: true })
  if (trades.length > 0) bomQ = bomQ.in('trade', trades)
  const { data: bomRows, error: bomErr } = await bomQ
  if (bomErr) return Response.json({ error: bomErr.message }, { status: 500 })

  // Per-tenant overrides (global-vs-local) — labour hours + markup only.
  // v7 Phase 0: the `enabled` column was removed from this read; it lived
  // on tenant_assembly_overrides but no UI ever wrote to it, so the badge
  // it powered ("disabled for you") always read true even when the tradie
  // had toggled the service OFF in the Services tab. The Services-tab
  // toggle writes tenant_service_offerings.enabled — read below — and
  // that is the single source of truth shared with the estimator path.
  const { data: overrides } = await supabase
    .from('tenant_assembly_overrides')
    .select('assembly_id, labour_hours_override, markup_pct_override')
    .eq('tenant_id', tenant.id)
  const overrideByAssembly = new Map<string, any>()
  for (const o of overrides ?? []) overrideByAssembly.set(o.assembly_id as string, o)

  // Services-tab toggle state. Missing row → enabled=true (matches the
  // /api/tenant/me convention so both endpoints describe the same world).
  const { data: offerings } = await supabase
    .from('tenant_service_offerings')
    .select('assembly_id, enabled')
    .eq('tenant_id', tenant.id)
  const enabledByAssembly = new Map<string, boolean>()
  for (const o of offerings ?? []) enabledByAssembly.set(o.assembly_id as string, !!o.enabled)

  // This tradie's OWN recipe lines (tenant_assembly_bom, migration 031).
  // The estimator prefers these over the shared baseline (buildBomHint),
  // so the Estimating tab MUST show the tenant recipe when present —
  // otherwise it shows a parts list that isn't what actually gets
  // quoted. Absent table (pre-031) → null → falls back to shared.
  const tenantBomByAssembly = new Map<
    string,
    Array<{ material_category: string; quantity: number; required: boolean; description: string | null }>
  >()
  {
    const { data: ownBom } = await supabase
      .from('tenant_assembly_bom')
      .select('assembly_id, material_category, quantity, required, description, sort')
      .eq('tenant_id', tenant.id)
      .order('sort', { ascending: true })
    for (const r of (ownBom ?? []) as any[]) {
      const arr = tenantBomByAssembly.get(r.assembly_id as string) ?? []
      arr.push({
        material_category: r.material_category,
        quantity: Number(r.quantity),
        required: !!r.required,
        description: r.description ?? null,
      })
      tenantBomByAssembly.set(r.assembly_id as string, arr)
    }
  }

  // Which material categories this tradie actually has a priced, active
  // catalogue product for (WP2). Drives the per-line "priced from your
  // catalogue" vs "generic price" badge — same signal as the Recipes
  // tab, so the two tabs always agree. Resilient: absent table → [].
  const catalogueCategories: string[] = []
  {
    let cq = supabase
      .from('tenant_material_catalogue')
      .select('category')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
    if (trades.length > 0) cq = cq.in('trade', trades)
    const { data: catRows } = await cq
    const seen = new Set<string>()
    for (const r of (catRows ?? []) as Array<{ category: string | null }>) {
      const c = (r.category ?? '').trim().toLowerCase()
      if (c) seen.add(c)
    }
    catalogueCategories.push(...seen)
  }

  // Group BOM rows by assembly.
  type AsmAgg = {
    id: string
    name: string
    trade: string
    default_labour_hours: number | string
    default_unit_price_ex_gst: number | string | null
    bom: Array<{ material_category: string; quantity: number; required: boolean; description: string | null }>
  }
  const byAssembly = new Map<string, AsmAgg>()
  for (const r of (bomRows ?? []) as any[]) {
    const a = Array.isArray(r.shared_assemblies) ? r.shared_assemblies[0] : r.shared_assemblies
    if (!a) continue
    let agg = byAssembly.get(a.id)
    if (!agg) {
      agg = {
        id: a.id,
        name: a.name,
        trade: a.trade,
        default_labour_hours: a.default_labour_hours,
        default_unit_price_ex_gst: a.default_unit_price_ex_gst,
        bom: [],
      }
      byAssembly.set(a.id, agg)
    }
    agg.bom.push({
      material_category: r.material_category,
      quantity: Number(r.quantity),
      required: !!r.required,
      description: r.description ?? null,
    })
  }

  const jobs = [...byAssembly.values()].map((a) => {
    const globalMarkup = markupByTrade.get(a.trade) ?? 28
    const eff = effectiveAssembly(a.default_labour_hours, globalMarkup, overrideByAssembly.get(a.id) ?? null)
    // The estimator prefers the tenant's own recipe; the tab must too.
    const ownBom = tenantBomByAssembly.get(a.id)
    const usingTenantRecipe = !!ownBom && ownBom.length > 0
    return {
      assembly_id: a.id,
      name: a.name,
      trade: a.trade,
      hourly_rate: hourlyByTrade.get(a.trade) ?? null,
      // v7 Phase 0: `enabled` moved out of `effective` (which is purely
      // labour/markup overrides) to the job's top level, sourced from
      // tenant_service_offerings so the badge agrees with the AI's actual
      // behaviour. Missing offering row defaults to enabled (matches
      // /api/tenant/me's opt-out-by-default contract).
      enabled: enabledByAssembly.get(a.id) ?? true,
      bom: usingTenantRecipe ? ownBom! : a.bom,
      recipe_source: usingTenantRecipe ? ('tenant' as const) : ('shared' as const),
      effective: {
        labour_hours: eff.labourHours, // { value, source: 'local'|'global' }
        markup_pct: eff.markupPct,
        global_labour_hours: Number(a.default_labour_hours),
        global_markup_pct: globalMarkup,
      },
    }
  })

  return Response.json({ ok: true, jobs, catalogue_categories: catalogueCategories })
}
