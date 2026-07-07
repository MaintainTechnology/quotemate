// /api/tenant/bom/[id] — PATCH a recipe line (qty / required / sort /
// category / description) or DELETE it. Ownership enforced: the
// update/delete include .eq('tenant_id', tenant.id) so a wrong id
// affects zero rows and returns 404. Mirrors /api/tenant/catalogue/[id].

import { createClient } from '@supabase/supabase-js'
import { TenantBomLinePatchSchema } from '@/lib/tenant/update-schema'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function tenantFromBearer(req: Request) {
  // Dual-auth: Clerk session token OR legacy Supabase token. Resolver
  // returns null for missing/invalid token AND authed-but-no-tenant;
  // both collapse to null so the call sites' existing 401 stays unchanged.
  const resolved = await resolveTenantRequest(supabase, req, 'id')
  return (resolved?.tenant ?? null) as { id: string } | null
}

function emptyToNull(v: string | undefined | null): string | null {
  if (v === undefined || v === null) return null
  const t = String(v).trim()
  return t === '' ? null : t
}

// ─── PATCH /api/tenant/bom/[id] ────────────────────────────────────
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return Response.json({ error: 'invalid_id' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = TenantBomLinePatchSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_payload', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  // assembly_id / trade are intentionally NOT editable here — moving a
  // line to a different job is a delete + re-add (keeps ownership and
  // the unique index simple).
  const fields: Record<string, unknown> = {}
  if (parsed.data.material_category !== undefined) {
    fields.material_category = parsed.data.material_category
  }
  if (parsed.data.description !== undefined) {
    fields.description = emptyToNull(parsed.data.description)
  }
  if (parsed.data.quantity !== undefined) fields.quantity = parsed.data.quantity
  if (parsed.data.required !== undefined) fields.required = parsed.data.required
  if (parsed.data.sort !== undefined) fields.sort = parsed.data.sort

  if (Object.keys(fields).length === 0) {
    return Response.json({ error: 'empty_update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('tenant_assembly_bom')
    .update(fields)
    .eq('id', id)
    .eq('tenant_id', tenant.id) // ownership guard
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      return Response.json(
        { error: 'duplicate_line', message: 'That material category already exists on this job.' },
        { status: 409 },
      )
    }
    if (error.code === 'PGRST116') {
      return Response.json({ error: 'not_found' }, { status: 404 })
    }
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true, line: data })
}

// ─── DELETE /api/tenant/bom/[id] ───────────────────────────────────
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return Response.json({ error: 'invalid_id' }, { status: 400 })
  }

  const { error, count } = await supabase
    .from('tenant_assembly_bom')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('tenant_id', tenant.id) // ownership guard

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!count || count === 0) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  return Response.json({ ok: true, deleted: count })
}
