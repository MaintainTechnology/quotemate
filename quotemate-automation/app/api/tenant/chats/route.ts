// GET /api/tenant/chats
//
// Returns the tradie's most recent SMS conversations + their full
// message threads. Powers the dashboard's "Chats" tab — a complete
// communication-history view that includes conversations which
// didn't (yet) produce a quote (escalated to inspection, ended
// without a job, mid-flow, lead drop-offs, etc.).
//
// Sibling endpoint to /api/tenant/me which surfaces quoted
// conversations as an inline transcript on each Quote card. This
// endpoint exists separately so the Chats tab loads lazily on click
// without bloating the main dashboard payload.
//
// Auth: Bearer <supabase-access-token>, same pattern as /api/tenant/me.
// Scoped to tenants.owner_user_id = caller's id. Service-role client
// for reads (no RLS shipped yet).

import { createClient } from '@supabase/supabase-js'

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

// How many conversations to return per call. Tradies eyeballing the
// last few days of inbound traffic need recency, not paginated archive.
// Easy to upgrade to a `cursor=<last_message_at>` param if real usage
// shows people want older threads.
const CHAT_LIMIT = 30
// Per-conversation message cap. Bounds payload size; a typical dialog
// is 10-20 turns so 60 is plenty of headroom for outliers.
const MESSAGE_CAP_PER_CONVO = 60

export async function GET(req: Request) {
  const user = await userFromBearer(req)
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Resolve the caller's tenant — same lookup pattern as /api/tenant/me.
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('owner_user_id', user.id)
    .maybeSingle()
  if (tenantErr) {
    return Response.json({ error: tenantErr.message }, { status: 500 })
  }
  if (!tenant) {
    return Response.json({ error: 'no_tenant' }, { status: 404 })
  }

  // Pull the most recent N conversations for this tenant. Order by
  // last_message_at desc so the most active threads land first.
  type ConvoRow = {
    id: string
    from_number: string | null
    to_number: string | null
    status: string | null
    conversation_type: string | null
    intake_id: string | null
    turn_count: number | null
    created_at: string
    last_message_at: string | null
    conversation_state: { slots?: Record<string, unknown> } | null
  }
  const convoRes = await supabase
    .from('sms_conversations')
    .select(
      'id, from_number, to_number, status, conversation_type, intake_id, ' +
        'turn_count, created_at, last_message_at, conversation_state',
    )
    .eq('tenant_id', tenant.id)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(CHAT_LIMIT)

  if (convoRes.error) {
    return Response.json({ error: convoRes.error.message }, { status: 500 })
  }
  const convos = (convoRes.data ?? []) as unknown as ConvoRow[]

  if (convos.length === 0) {
    return Response.json({ chats: [] })
  }

  // Load all messages for those conversations in one round-trip. We
  // overshoot the per-conversation cap intentionally so the slicing
  // happens client-side after we've grouped by conversation_id.
  const conversationIds = convos.map((c) => c.id)
  const { data: msgs } = await supabase
    .from('sms_messages')
    .select('conversation_id, direction, body, created_at')
    .in('conversation_id', conversationIds)
    .order('created_at', { ascending: true })

  // Group messages by conversation, capping at MESSAGE_CAP_PER_CONVO.
  type Msg = {
    direction: 'inbound' | 'outbound'
    body: string
    created_at: string
  }
  const byConvo: Record<string, Msg[]> = {}
  for (const m of msgs ?? []) {
    const cid = m.conversation_id as string
    if (!byConvo[cid]) byConvo[cid] = []
    if (byConvo[cid].length < MESSAGE_CAP_PER_CONVO) {
      byConvo[cid].push({
        direction: m.direction as 'inbound' | 'outbound',
        body: m.body as string,
        created_at: m.created_at as string,
      })
    }
  }

  // Enrich each conversation row with its message thread + a
  // surfaced first_name / job_type / suburb pulled from
  // conversation_state.slots so the Chats tab can render a heading
  // without doing the lookup client-side.
  const chats = convos.map((c) => {
    const slots = (c.conversation_state?.slots ?? {}) as Record<string, unknown>
    return {
      id: c.id,
      from_number: c.from_number,
      to_number: c.to_number,
      status: c.status,
      conversation_type: c.conversation_type,
      intake_id: c.intake_id,
      turn_count: c.turn_count ?? 0,
      created_at: c.created_at,
      last_message_at: c.last_message_at,
      first_name: (slots.first_name as string | null) ?? null,
      job_type: (slots.job_type as string | null) ?? null,
      suburb: (slots.suburb as string | null) ?? null,
      messages: byConvo[c.id] ?? [],
    }
  })

  return Response.json({ chats })
}
