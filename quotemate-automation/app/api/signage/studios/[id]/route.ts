// DELETE /api/signage/studios/[id] — remove a studio (and, via ON DELETE
// CASCADE, any of its sweep requests/photos/assessments). Used to clear the
// demo seed studios once real locations are added. HQ-authed; org-scoped.

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

  const { data: studio } = await supabase.from('studios').select('id, org_id').eq('id', id).maybeSingle()
  if (!studio || (studio.org_id as string) !== auth.orgId) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const { error } = await supabase.from('studios').delete().eq('id', id)
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
