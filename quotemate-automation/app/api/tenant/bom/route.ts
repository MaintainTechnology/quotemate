// /api/tenant/bom — tenant-owned bills of materials (the editable
// "recipe book", migration 031).
//   GET  → the jobs this tradie can build recipes for + their lines
//   POST → add a recipe line to a job
//
// Ownership enforced exactly like /api/tenant/catalogue: every query is
// scoped to the bearer's tenant, so a tradie only ever sees/edits their
// own recipes and can only attach lines to jobs in trades they run.

import { createClient } from '@supabase/supabase-js'
import { TenantBomLineSchema } from '@/lib/tenant/update-schema'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { recipeTradesFor } from '@/lib/tenant/recipe-trades'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function tenantFromBearer(req: Request) {
  // Dual-auth: Clerk session token OR legacy Supabase token. Resolver
  // returns null for missing/invalid token AND authed-but-no-tenant;
  // both collapse to null so the call sites' existing 401 stays unchanged.
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

// ─── GET /api/tenant/bom ───────────────────────────────────────────
export async function GET(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  // Same narrowing as /api/tenant/tasks, and for the same reason: this picker
  // used to offer every job in the tenant's trades while TenantBomLineSchema
  // accepts only TRADE_ENUM, so on a multi-trade tenant the tab opened on an
  // aircon job and "Add part" 400s on every submit. Those jobs have no shared
  // baseline and no existing tenant rows, so nothing functional is hidden.
  // An empty result means "no jobs" — never "no filter".
  const trades = recipeTradesFor(allowedTradesOf(tenant))

  let assemblies: Array<{ id: string; name: string; trade: string }> = []
  if (trades.length > 0) {
    const { data, error: aErr } = await supabase
      .from('shared_assemblies')
      .select('id, name, trade')
      .in('trade', trades)
      .order('trade', { ascending: true })
      .order('name', { ascending: true })
    if (aErr) return Response.json({ error: aErr.message }, { status: 500 })
    assemblies = (data ?? []) as Array<{ id: string; name: string; trade: string }>
  }

  const { data: lines, error: lErr } = await supabase
    .from('tenant_assembly_bom')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('assembly_id', { ascending: true })
    .order('sort', { ascending: true })
  if (lErr) return Response.json({ error: lErr.message }, { status: 500 })

  // Shared baseline lines (migration 028 — `shared_assembly_bom`). The
  // Recipes UI surfaces these as an editable starting point for jobs the
  // tradie hasn't customised yet ("Customise this recipe" forks the
  // baseline into tenant_assembly_bom). Resilient: missing table / error
  // ⇒ baselines={} so the UI just falls back to the legacy empty form.
  const assemblyIds = assemblies.map((a) => a.id)
  let baselinesByAssembly: Record<string, BaselineLine[]> = {}
  if (assemblyIds.length > 0) {
    const { data: baselineRows } = await supabase
      .from('shared_assembly_bom')
      .select('assembly_id, material_category, description, quantity, required, sort, include_when')
      .in('assembly_id', assemblyIds)
      .order('assembly_id', { ascending: true })
      .order('sort', { ascending: true })
    baselinesByAssembly = (baselineRows ?? []).reduce(
      (acc: Record<string, BaselineLine[]>, r) => {
        const k = r.assembly_id as string
        ;(acc[k] ??= []).push({
          material_category: r.material_category as string,
          description: (r.description as string | null) ?? null,
          quantity: Number(r.quantity),
          required: !!r.required,
          sort: Number(r.sort ?? 0),
          include_when:
            r.include_when && typeof r.include_when === 'object'
              ? (r.include_when as Record<string, unknown>)
              : null,
        })
        return acc
      },
      {},
    )
  }

  // Which material categories this tradie actually has a finite, active
  // tenant price for, keyed by trade so a same-named category in another
  // trade cannot make this recipe look quote-ready.
  // Resilient: absent table (pre-028 prod) / error → [] so GET still
  // returns assemblies + lines (no behaviour change).
  let cq = supabase
    .from('tenant_material_catalogue')
    .select('trade, category, unit_price_ex_gst')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
  if (trades.length > 0) cq = cq.in('trade', trades)
  const { data: catRows } = await cq
  const categorySets = new Map<string, Set<string>>()
  for (const row of catRows ?? []) {
    const trade = String(row.trade ?? '').trim().toLowerCase()
    const category = String(row.category ?? '').trim().toLowerCase()
    const rawPrice = row.unit_price_ex_gst
    const price = rawPrice === null || rawPrice === undefined || rawPrice === ''
      ? Number.NaN
      : typeof rawPrice === 'string'
        ? Number.parseFloat(rawPrice)
        : Number(rawPrice)
    if (!trade || !category || !Number.isFinite(price)) continue
    const set = categorySets.get(trade) ?? new Set<string>()
    set.add(category)
    categorySets.set(trade, set)
  }
  const catalogueCategoriesByTrade = Object.fromEntries(
    [...categorySets.entries()].map(([trade, categories]) => [trade, [...categories].sort()]),
  )

  return Response.json({
    ok: true,
    assemblies,
    lines: lines ?? [],
    baselines: baselinesByAssembly,
    catalogue_categories_by_trade: catalogueCategoriesByTrade,
  })
}

type BaselineLine = {
  material_category: string
  description: string | null
  quantity: number
  required: boolean
  sort: number
  include_when: Record<string, unknown> | null
}

// ─── POST /api/tenant/bom ──────────────────────────────────────────
export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = TenantBomLineSchema.safeParse(body)
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

  // The job must exist and its trade must match the line's trade AND be
  // a trade this tradie runs (can't build recipes for jobs they don't do).
  const { data: asm } = await supabase
    .from('shared_assemblies')
    .select('id, trade')
    .eq('id', parsed.data.assembly_id)
    .maybeSingle()
  if (!asm) {
    return Response.json({ error: 'invalid_assembly' }, { status: 400 })
  }
  if (asm.trade !== parsed.data.trade || !allowed.includes(asm.trade as string)) {
    return Response.json({ error: 'assembly_trade_mismatch' }, { status: 400 })
  }

  const row = {
    tenant_id: tenant.id,
    assembly_id: parsed.data.assembly_id,
    trade: parsed.data.trade,
    material_category: parsed.data.material_category,
    description: emptyToNull(parsed.data.description),
    quantity: parsed.data.quantity,
    required: parsed.data.required ?? true,
    sort: parsed.data.sort ?? 0,
  }

  const { data, error } = await supabase
    .from('tenant_assembly_bom')
    .insert(row)
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      return Response.json(
        {
          error: 'duplicate_line',
          message: 'This job already has a recipe line for that material category.',
        },
        { status: 409 },
      )
    }
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true, line: data })
}
