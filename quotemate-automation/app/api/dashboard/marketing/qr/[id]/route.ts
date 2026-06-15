// PATCH /api/dashboard/marketing/qr/[id] — repoint destination, rename,
// or change status (pause/archive/reactivate). Ownership-checked.

import { z } from 'zod'
import { marketingSupabase as supabase, userFromBearer, tenantForUser } from '@/lib/marketing/auth'

export const dynamic = 'force-dynamic'

const PatchBody = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  destination_type: z.enum(['sms', 'landing']).optional(),
  prefill_body: z.string().trim().max(140).nullable().optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
})

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = PatchBody.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 })
  }

  // Ownership: the QR must belong to the caller's tenant.
  const { data: qr } = await supabase
    .from('marketing_qrs')
    .select('id, tenant_id, destination_config, destination_type')
    .eq('id', id)
    .maybeSingle()
  if (!qr) return Response.json({ error: 'not_found' }, { status: 404 })
  if (qr.tenant_id !== tenant.id) return Response.json({ error: 'forbidden' }, { status: 403 })

  const u = parsed.data
  const patch: Record<string, unknown> = {}
  if (u.label !== undefined) patch.label = u.label
  if (u.status !== undefined) patch.status = u.status
  if (u.destination_type !== undefined) {
    if (u.destination_type === 'sms' && !tenant.twilio_sms_number) {
      return Response.json({ error: 'no_sms_number' }, { status: 422 })
    }
    patch.destination_type = u.destination_type
  }
  // prefill_body lives inside destination_config; merge so we don't clobber.
  if (u.prefill_body !== undefined) {
    const current = (qr.destination_config as Record<string, unknown>) ?? {}
    patch.destination_config = u.prefill_body
      ? { ...current, prefill_body: u.prefill_body }
      : (() => { const { prefill_body: _drop, ...rest } = current; void _drop; return rest })()
  }

  if (Object.keys(patch).length === 0) return Response.json({ ok: true, noop: true })

  const { error } = await supabase.from('marketing_qrs').update(patch).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
