// DELETE /api/dashboard/flyer/canva/designs/[id]
//   Remove a Canva design entry from QuoteMax (ownership-checked). The design
//   itself remains in the tenant's Canva account; this only drops our row.
// Auth: Authorization: Bearer <token>. Tenant-scoped.

import { marketingSupabase as supabase, userFromBearer } from '@/lib/marketing/auth'
import { tenantBrandForUser } from '@/lib/flyer/tenant'
import { ownershipVerdict } from '@/lib/flyer/api-logic'

export const dynamic = 'force-dynamic'

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantBrandForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  const { data: row } = await supabase
    .from('canva_designs')
    .select('tenant_id')
    .eq('id', id)
    .maybeSingle()
  const verdict = ownershipVerdict((row as { tenant_id: string } | null) ?? null, tenant.id)
  if (!verdict.ok) return Response.json({ error: verdict.error }, { status: verdict.status })

  const { error } = await supabase.from('canva_designs').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
