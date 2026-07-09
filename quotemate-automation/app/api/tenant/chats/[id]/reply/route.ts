// POST /api/tenant/chats/[id]/reply
//
// Sends a manual tradie → customer SMS on an existing conversation, from
// the dashboard Chats tab composer. Additive sibling of GET /api/tenant/chats
// — the capture pipeline (/api/sms/inbound, Vapi webhook) is untouched.
//
// Auth: same dual-auth resolver as the GET route. All business logic lives
// in lib/sms/tradie-reply.ts (unit-tested); this file is transport only.

import { createClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { sendTradieReply } from '@/lib/sms/tradie-reply'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const resolved = await resolveTenantRequest(supabase, req, 'id')
  if (!resolved) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const tenant = resolved.tenant as { id: string } | null
  if (!tenant) {
    return Response.json({ error: 'no_tenant' }, { status: 404 })
  }

  const { id } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as { body?: unknown }

  const result = await sendTradieReply({
    supabase,
    tenantId: tenant.id,
    conversationId: id,
    body: typeof body.body === 'string' ? body.body : '',
  })
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status })
  }
  return Response.json({ message: result.message })
}
