// /api/tenant/estimation/[assemblyId] — v7 Phase 4.
//
//   PATCH  → upsert {labour_hours_override, markup_pct_override} for
//            this assembly on the authed tenant. Either field may be
//            null to clear (reset-to-default).
//   DELETE → remove the override row entirely (also reset-to-default).
//
// Background: tenant_assembly_overrides (migration 028) already carried
// the columns, but no UI ever wrote to them — until now. The `enabled`
// column on this table was removed from the read path in v7 Phase 0
// (the Services-tab toggle is the single source of truth for that).
// So this route writes ONLY labour/markup.
//
// Bearer-authed + tenant-scoped. Sanity-checks the assembly_id belongs
// to a trade the tenant runs so a typo can't pollute another tradie's
// assembly graph.

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

const PatchSchema = z.object({
  // null = clear this override (revert to global). Number = local override.
  labour_hours_override: z.union([z.number().positive().max(40), z.null()]).optional(),
  markup_pct_override: z.union([z.number().min(0).max(200), z.null()]).optional(),
})

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ assemblyId: string }> },
) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { assemblyId } = await ctx.params
  if (!assemblyId) return Response.json({ error: 'assembly_id_missing' }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_payload', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  // At least one of the two fields must be set (otherwise this is a noop —
  // call DELETE instead).
  if (
    parsed.data.labour_hours_override === undefined &&
    parsed.data.markup_pct_override === undefined
  ) {
    return Response.json({ error: 'no_fields_to_update' }, { status: 400 })
  }

  // Verify the assembly belongs to a trade the tenant runs.
  const trades = tradesOf(tenant)
  const { data: asm } = await supabase
    .from('shared_assemblies')
    .select('id, trade')
    .eq('id', assemblyId)
    .maybeSingle()
  if (!asm) {
    return Response.json({ error: 'assembly_not_found' }, { status: 404 })
  }
  if (!trades.includes(asm.trade as string)) {
    return Response.json({ error: 'assembly_trade_not_owned' }, { status: 400 })
  }

  // Upsert. We do an explicit fetch + insert/update because the table's
  // PK is (tenant_id, assembly_id) and Supabase's upsert with that
  // composite key + the trigger on updated_at is finicky.
  const { data: existing } = await supabase
    .from('tenant_assembly_overrides')
    .select('tenant_id')
    .eq('tenant_id', tenant.id)
    .eq('assembly_id', assemblyId)
    .maybeSingle()

  const updateFields: Record<string, unknown> = {}
  if (parsed.data.labour_hours_override !== undefined) {
    updateFields.labour_hours_override = parsed.data.labour_hours_override
  }
  if (parsed.data.markup_pct_override !== undefined) {
    updateFields.markup_pct_override = parsed.data.markup_pct_override
  }

  if (existing) {
    const { error } = await supabase
      .from('tenant_assembly_overrides')
      .update(updateFields)
      .eq('tenant_id', tenant.id)
      .eq('assembly_id', assemblyId)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabase.from('tenant_assembly_overrides').insert({
      tenant_id: tenant.id,
      assembly_id: assemblyId,
      ...updateFields,
    })
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ assemblyId: string }> },
) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { assemblyId } = await ctx.params
  if (!assemblyId) return Response.json({ error: 'assembly_id_missing' }, { status: 400 })

  const { error } = await supabase
    .from('tenant_assembly_overrides')
    .delete()
    .eq('tenant_id', tenant.id)
    .eq('assembly_id', assemblyId)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
