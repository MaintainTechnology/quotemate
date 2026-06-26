// /api/dashboard/flyer/[id]
//   GET    → one flyer (incl. document), ownership-checked.
//   PATCH  → rename and/or replace the saved document.
//   DELETE → remove the flyer.
// Auth: Authorization: Bearer <token>. Every action is tenant-scoped.

import { marketingSupabase as supabase, userFromBearer } from '@/lib/marketing/auth'
import { tenantBrandForUser } from '@/lib/flyer/tenant'
import { PatchFlyerBody, ownershipVerdict } from '@/lib/flyer/api-logic'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantBrandForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  const { data: flyer } = await supabase
    .from('flyers')
    .select('id, tenant_id, name, template_id, document, png_path, pdf_path, created_at, updated_at')
    .eq('id', id)
    .maybeSingle()
  const verdict = ownershipVerdict(flyer as { tenant_id: string } | null, tenant.id)
  if (!verdict.ok) return Response.json({ error: verdict.error }, { status: verdict.status })
  return Response.json({ flyer })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantBrandForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = PatchFlyerBody.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { data: flyer } = await supabase.from('flyers').select('tenant_id').eq('id', id).maybeSingle()
  const verdict = ownershipVerdict(flyer as { tenant_id: string } | null, tenant.id)
  if (!verdict.ok) return Response.json({ error: verdict.error }, { status: verdict.status })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (parsed.data.name !== undefined) patch.name = parsed.data.name
  if (parsed.data.document !== undefined) patch.document = parsed.data.document

  const { error } = await supabase.from('flyers').update(patch).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantBrandForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  const { data: flyer } = await supabase.from('flyers').select('tenant_id').eq('id', id).maybeSingle()
  const verdict = ownershipVerdict(flyer as { tenant_id: string } | null, tenant.id)
  if (!verdict.ok) return Response.json({ error: verdict.error }, { status: verdict.status })

  const { error } = await supabase.from('flyers').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
