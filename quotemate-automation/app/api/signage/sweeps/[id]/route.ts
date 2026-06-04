// DELETE /api/signage/sweeps/[id] — remove a sweep (and, via ON DELETE
// CASCADE, its requests, photo submissions, and assessments). HQ-authed;
// the sweep must belong to the caller's org.

import { createClient } from '@supabase/supabase-js'
import { orgFromBearer } from '@/lib/signage/org'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await orgFromBearer(supabase, req)
  if (!auth) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: sweep } = await supabase
    .from('signage_sweeps')
    .select('id, org_id')
    .eq('id', id)
    .maybeSingle()
  if (!sweep || (sweep.org_id as string) !== auth.orgId) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const { error } = await supabase.from('signage_sweeps').delete().eq('id', id)
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
