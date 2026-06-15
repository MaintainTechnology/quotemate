// PATCH /api/dashboard/invites/codes/[id] — update status / quota / expiry.
// Quota can only be RAISED (never below quota_used). Caller must own the
// code's tenant (or be a platform admin for platform-wide codes).

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { isPlatformAdmin } from '@/lib/onboard/invitation-codes'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function userFromBearer(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

const PatchBody = z.object({
  status: z.enum(['active', 'paused', 'revoked']).optional(),
  quota_total: z.coerce.number().int().positive().max(100000).optional(),
  expires_at: z.string().datetime().nullable().optional(),
})

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params // Next 16: params is a Promise
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

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

  // Load the code + ownership context.
  const { data: code } = await supabase
    .from('onboarding_codes')
    .select('id, tenant_id, quota_used')
    .eq('id', id)
    .maybeSingle()
  if (!code) return Response.json({ error: 'not_found' }, { status: 404 })

  // Ownership: platform-wide codes need platform admin; tenant codes need
  // the caller to own that tenant.
  if (code.tenant_id === null) {
    if (!isPlatformAdmin(user.id)) return Response.json({ error: 'forbidden' }, { status: 403 })
  } else {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('owner_user_id', user.id)
      .maybeSingle()
    if (!tenant || tenant.id !== code.tenant_id) {
      return Response.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  const updates = parsed.data
  if (updates.quota_total !== undefined && updates.quota_total < (code.quota_used as number)) {
    return Response.json(
      { error: 'quota_below_used', message: `Quota cannot drop below ${code.quota_used} already used.` },
      { status: 422 },
    )
  }

  const patch: Record<string, unknown> = {}
  if (updates.status !== undefined) patch.status = updates.status
  if (updates.quota_total !== undefined) patch.quota_total = updates.quota_total
  if (updates.expires_at !== undefined) patch.expires_at = updates.expires_at
  if (Object.keys(patch).length === 0) return Response.json({ ok: true, noop: true })

  const { error } = await supabase.from('onboarding_codes').update(patch).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
