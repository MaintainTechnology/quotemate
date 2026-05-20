// /api/tenant/followups/events — per-touch CRM log for a follow-up lead.
//
// GET  ?quoteId=X        → events for ONE quote, newest first
// POST { quoteId, kind: 'note', outcome, note? }
//                        → log a manual touch; ALSO sets
//                          quotes.followed_up_at + followup_note so the
//                          existing To Chase / Contacted split keeps
//                          working without a second write path.
//
// Auto-logged 'call' / 'sms' events come from /followups/call and
// /followups/text directly (server-to-server inserts, not via this
// endpoint) — see migration 039 for the data shape.
//
// Auth mirrors /api/tenant/followups: Bearer supabase token →
// getUser → tenant by owner_user_id. Every read/write is scoped to the
// caller's tenant_id so cross-tenant access is impossible (404 on
// foreign quote ids).

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const NOTE_OUTCOMES = new Set([
  'left_voicemail',
  'spoke',
  'no_answer',
  'wants_callback',
  'not_interested',
  'other',
])

async function authed(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('owner_user_id', data.user.id)
    .maybeSingle()
  if (!tenant) return null
  return { tenantId: (tenant as { id: string }).id, userId: data.user.id }
}

// ─── GET ───────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const ctx = await authed(req)
  if (!ctx) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const quoteId = url.searchParams.get('quoteId')
  if (!quoteId) {
    return Response.json({ error: 'quoteId is required' }, { status: 400 })
  }

  // Ownership probe FIRST — if the quote isn't ours, return 404 with no
  // event payload so we leak nothing about other tenants' rows.
  const { data: q } = await supabase
    .from('quotes')
    .select('id')
    .eq('id', quoteId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()
  if (!q) return Response.json({ error: 'not_found' }, { status: 404 })

  const { data: rows, error } = await supabase
    .from('quote_followup_events')
    .select('id, kind, outcome, summary, note, created_at, actor_user_id')
    .eq('tenant_id', ctx.tenantId)
    .eq('quote_id', quoteId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ events: rows ?? [] })
}

// ─── POST ──────────────────────────────────────────────────────────
// Today only kind='note' is accepted here — call/sms events are inserted
// by their respective dispatch routes so the log can't drift out of
// sync with what actually fired on Twilio. Reject the other kinds here
// rather than silently allow a UI to over-claim.
export async function POST(req: Request) {
  const ctx = await authed(req)
  if (!ctx) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let body: { quoteId?: unknown; kind?: unknown; outcome?: unknown; note?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const quoteId = typeof body.quoteId === 'string' ? body.quoteId : null
  const kind = body.kind === 'note' ? 'note' : null
  const outcomeRaw = typeof body.outcome === 'string' ? body.outcome : ''
  const outcome = NOTE_OUTCOMES.has(outcomeRaw) ? outcomeRaw : null
  const note =
    typeof body.note === 'string' && body.note.trim()
      ? body.note.trim().slice(0, 500)
      : null

  if (!quoteId) {
    return Response.json({ error: 'quoteId is required' }, { status: 400 })
  }
  if (!kind) {
    return Response.json(
      { error: 'kind must be "note" (call/sms are logged automatically)' },
      { status: 400 },
    )
  }
  if (!outcome) {
    return Response.json(
      { error: 'outcome is required for a note (e.g. spoke, left_voicemail)' },
      { status: 400 },
    )
  }

  // Ownership guard: insert + quote-update only when the quote belongs
  // to the caller. The tenant_id filter on the quote update is the
  // single source of authority — a foreign quoteId silently matches 0
  // rows and we 404, never inserting an orphan event row.
  const { data: q } = await supabase
    .from('quotes')
    .select('id')
    .eq('id', quoteId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()
  if (!q) return Response.json({ error: 'not_found' }, { status: 404 })

  const summary = humanOutcome(outcome)
  const { data: inserted, error: insErr } = await supabase
    .from('quote_followup_events')
    .insert({
      tenant_id: ctx.tenantId,
      quote_id: quoteId,
      actor_user_id: ctx.userId,
      kind,
      outcome,
      summary,
      note,
    })
    .select('id, kind, outcome, summary, note, created_at, actor_user_id')
    .single()
  if (insErr) return Response.json({ error: insErr.message }, { status: 500 })

  // Keep the parking flag in lockstep so the "Contacted" section in the
  // dashboard fills regardless of which API path wrote the touch.
  const nowIso = new Date().toISOString()
  await supabase
    .from('quotes')
    .update({
      followed_up_at: nowIso,
      ...(note ? { followup_note: note } : {}),
    })
    .eq('id', quoteId)
    .eq('tenant_id', ctx.tenantId)

  return Response.json({
    ok: true,
    event: inserted,
    quote: { id: quoteId, followed_up_at: nowIso, followup_note: note },
  })
}

function humanOutcome(o: string): string {
  switch (o) {
    case 'left_voicemail':
      return 'Left voicemail'
    case 'spoke':
      return 'Spoke with customer'
    case 'no_answer':
      return 'No answer'
    case 'wants_callback':
      return 'Wants a callback'
    case 'not_interested':
      return 'Not interested'
    case 'other':
      return 'Other'
    default:
      return o
  }
}
