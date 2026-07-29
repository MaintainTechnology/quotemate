// /api/tenant/tasks/fork — copy the shared baseline step checklist for ONE job
// into this tenant's tenant_assembly_tasks rows, so the tradie can edit it from
// the dashboard without retyping every step.
//
// Mirrors /api/tenant/bom/fork: same auth, same id regex, same trade-scope
// check, same `already_customised` head-count guard, same `no_baseline` 404,
// same bulk insert.
//
// DELIBERATELY NOT mirrored: the R33/R38 catalogue-gap apparatus
// (category_gaps / has_category_gaps / gap_detection_failed). That exists
// because a BOM line joins to a product by material_category and can silently
// fall back to a generic price. A task has no category and no price, so there
// is no gap to detect and porting it would be dead code.
//
// Idempotency: no-ops when the tenant already has at least one step for the
// assembly — never silently merge into an existing custom checklist, which
// could clobber the tradie's edits. The UI hides the button in that case, but
// this server-side guard is the source of truth.

import { createClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { RECIPE_TRADES } from '@/lib/tenant/recipe-trades'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function tenantFromBearer(req: Request) {
  const resolved = await resolveTenantRequest(supabase, req, 'id, trade, trades')
  return (resolved?.tenant ?? null) as { id: string; trade: string | null; trades: string[] | null } | null
}

function allowedTradesOf(tenant: { trade: string | null; trades: string[] | null }) {
  return Array.isArray(tenant.trades) && tenant.trades.length > 0
    ? tenant.trades
    : tenant.trade
      ? [tenant.trade]
      : []
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

  const assemblyId =
    typeof (body as { assembly_id?: unknown })?.assembly_id === 'string'
      ? ((body as { assembly_id: string }).assembly_id as string).trim()
      : ''
  if (!/^[0-9a-f-]{36}$/i.test(assemblyId)) {
    return Response.json({ error: 'invalid_assembly_id' }, { status: 400 })
  }

  // Assembly must exist + its trade must be one this tenant runs.
  const { data: asm } = await supabase
    .from('shared_assemblies')
    .select('id, trade')
    .eq('id', assemblyId)
    .maybeSingle()
  if (!asm) {
    return Response.json({ error: 'invalid_assembly' }, { status: 400 })
  }
  const allowed = allowedTradesOf(tenant)
  if (!allowed.includes(asm.trade as string)) {
    return Response.json({ error: 'assembly_trade_mismatch', allowed }, { status: 400 })
  }
  // Unlike POST, nothing here validates `trade` through TRADE_ENUM — the fork
  // reads asm.trade and inserts it raw. Without this a roofing assembly that
  // had a baseline would reach the table CHECK and 500. Fail as a clean 400.
  if (!RECIPE_TRADES.includes(asm.trade as string)) {
    return Response.json(
      { error: 'assembly_trade_mismatch', allowed: RECIPE_TRADES },
      { status: 400 },
    )
  }

  // Refuse to fork when the tenant already has steps for this assembly.
  const { count: existingCount, error: countErr } = await supabase
    .from('tenant_assembly_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('assembly_id', assemblyId)
  if (countErr) return Response.json({ error: countErr.message }, { status: 500 })
  if ((existingCount ?? 0) > 0) {
    return Response.json(
      {
        error: 'already_customised',
        message:
          'You already have a checklist for this job. Edit it directly instead of forking the baseline.',
      },
      { status: 409 },
    )
  }

  const { data: baseline, error: bErr } = await supabase
    .from('shared_assembly_tasks')
    .select('title, notes, required, sort')
    .eq('assembly_id', assemblyId)
    .order('sort', { ascending: true })
  if (bErr) return Response.json({ error: bErr.message }, { status: 500 })

  if (!baseline || baseline.length === 0) {
    return Response.json(
      {
        error: 'no_baseline',
        message: "There's no standard checklist for this job yet. Add the steps manually below.",
      },
      { status: 404 },
    )
  }

  const rows = baseline.map((r) => ({
    tenant_id: tenant.id,
    assembly_id: assemblyId,
    trade: asm.trade as string,
    title: r.title as string,
    notes: (r.notes as string | null) ?? null,
    required: !!r.required,
    sort: Number(r.sort ?? 0),
  }))

  const { data: inserted, error: insErr } = await supabase
    .from('tenant_assembly_tasks')
    .insert(rows)
    .select('*')

  if (insErr) {
    return Response.json({ error: insErr.message }, { status: 500 })
  }

  return Response.json({
    ok: true,
    forked: inserted?.length ?? 0,
    lines: inserted ?? [],
  })
}
