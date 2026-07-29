// /api/tenant/tasks — tenant-owned task checklists (migration 184, Phase 3).
//   GET  → the jobs this tradie can build checklists for + their steps
//   POST → add a step to a job
//
// Mirrors /api/tenant/bom exactly, minus the catalogue-gap apparatus: a task
// has no material_category, so there is nothing to join to a product and
// nothing to report a gap about.
//
// Ownership enforced the same way: every query is scoped to the bearer's
// tenant, so a tradie only ever sees/edits their own steps and can only attach
// them to jobs in trades they run.

import { createClient } from '@supabase/supabase-js'
import { TenantTaskLineSchema } from '@/lib/tenant/update-schema'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function tenantFromBearer(req: Request) {
  // Dual-auth: Clerk session token OR legacy Supabase token. Resolver
  // returns null for missing/invalid token AND authed-but-no-tenant;
  // both collapse to null so the 401 behaviour matches the BOM route.
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

type BaselineTask = {
  title: string
  notes: string | null
  required: boolean
  sort: number
}

// ─── GET /api/tenant/tasks ─────────────────────────────────────────
export async function GET(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const trades = allowedTradesOf(tenant)

  let aq = supabase
    .from('shared_assemblies')
    .select('id, name, trade')
    .order('trade', { ascending: true })
    .order('name', { ascending: true })
  if (trades.length > 0) aq = aq.in('trade', trades)
  const { data: assemblies, error: aErr } = await aq
  if (aErr) return Response.json({ error: aErr.message }, { status: 500 })

  const { data: lines, error: lErr } = await supabase
    .from('tenant_assembly_tasks')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('assembly_id', { ascending: true })
    .order('sort', { ascending: true })
  if (lErr) return Response.json({ error: lErr.message }, { status: 500 })

  // Shared baseline steps. The Recipes UI surfaces these read-only as a
  // starting point for jobs the tradie hasn't customised yet ("Customise
  // these steps" forks them). Resilient: a missing table or error yields
  // baselines={} so the panel simply shows the empty add form.
  const assemblyIds = (assemblies ?? []).map((a) => a.id as string)
  let baselinesByAssembly: Record<string, BaselineTask[]> = {}
  if (assemblyIds.length > 0) {
    const { data: baselineRows } = await supabase
      .from('shared_assembly_tasks')
      .select('assembly_id, title, notes, required, sort')
      .in('assembly_id', assemblyIds)
      .order('assembly_id', { ascending: true })
      .order('sort', { ascending: true })
    baselinesByAssembly = (baselineRows ?? []).reduce(
      (acc: Record<string, BaselineTask[]>, r) => {
        const k = r.assembly_id as string
        ;(acc[k] ??= []).push({
          title: r.title as string,
          notes: (r.notes as string | null) ?? null,
          required: !!r.required,
          sort: Number(r.sort ?? 0),
        })
        return acc
      },
      {},
    )
  }

  return Response.json({
    ok: true,
    assemblies: assemblies ?? [],
    lines: lines ?? [],
    baselines: baselinesByAssembly,
  })
}

// ─── POST /api/tenant/tasks ────────────────────────────────────────
export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = TenantTaskLineSchema.safeParse(body)
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

  // The job must exist, and its trade must match the line's trade AND be a
  // trade this tradie runs — same guard as the BOM line insert.
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
    title: parsed.data.title,
    notes: emptyToNull(parsed.data.notes),
    required: parsed.data.required ?? true,
    sort: parsed.data.sort ?? 0,
  }

  const { data, error } = await supabase
    .from('tenant_assembly_tasks')
    .insert(row)
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      return Response.json(
        {
          error: 'duplicate_task',
          message: 'This job already has a step with that name.',
        },
        { status: 409 },
      )
    }
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true, line: data })
}
