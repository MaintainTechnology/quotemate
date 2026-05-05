import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { pipelineLog } from '@/lib/log/pipeline'
import { generateShareToken } from '@/lib/stripe/checkout'

export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Calls with transcripts shorter than this are treated as hangups before
// any usable content was captured — webhook returns 200 to Vapi but does
// not dispatch the chain. Both the photo-request SMS and the quote-with-
// pay-links SMS are suppressed in this branch.
const MIN_TRANSCRIPT_CHARS = 50

export async function POST(req: Request) {
  const log = pipelineLog('webhook')
  log.step('received')

  const payload = await req.json()

  // Vapi sends many event types — status-update, transcript, function-call,
  // hang, end-of-call-report. We only act on end-of-call-report.
  if (payload.message?.type !== 'end-of-call-report') {
    log.ok('event ignored — not end-of-call-report', { event_type: payload.message?.type })
    return Response.json({ ok: true, ignored: payload.message?.type })
  }

  const call = payload.message.call
  if (!call?.id) {
    log.err('end-of-call-report missing call.id')
    return Response.json({ ok: false, error: 'missing call.id' }, { status: 400 })
  }

  // Vapi sends durationSeconds as a float (e.g. 32.053). Our `duration_seconds`
  // column is `int`, so round before inserting.
  const durationSeconds =
    typeof payload.message.durationSeconds === 'number'
      ? Math.round(payload.message.durationSeconds)
      : null

  const transcript = payload.message.transcript ?? null
  const transcriptChars = transcript?.length ?? 0

  log.step('upserting calls row', {
    vapi_call_id: call.id,
    caller_number: call.customer?.number ?? 'null',
    transcript_chars: transcriptChars,
    duration_s: durationSeconds ?? 'null',
  })

  // Upsert (not insert) so Vapi retrying the same end-of-call event is idempotent.
  // The unique constraint on vapi_call_id otherwise fires on retry → null callRow.
  const { data: callRow, error } = await supabase
    .from('calls')
    .upsert(
      {
        vapi_call_id: call.id,
        caller_number: call.customer?.number ?? null,
        duration_seconds: durationSeconds,
        transcript,
        recording_url: payload.message.recordingUrl ?? null,
        ended_at: new Date().toISOString(),
      },
      { onConflict: 'vapi_call_id' }
    )
    .select()
    .single()

  if (error || !callRow) {
    log.err('upsert failed', error?.message, { code: error?.code, hint: error?.hint })
    return Response.json(
      { ok: false, error: error?.message ?? 'upsert returned no row' },
      { status: 500 }
    )
  }

  log.ok('calls row upserted', { call_id: callRow.id })

  // Early-skip gate: caller hung up before saying anything meaningful.
  // Skip the entire chain — no SMS, no estimation, no photo prompt.
  if (transcriptChars < MIN_TRANSCRIPT_CHARS) {
    log.ok('transcript too short — skipping chain entirely (no SMS, no estimation)', {
      chars: transcriptChars,
      threshold: MIN_TRANSCRIPT_CHARS,
    })
    log.done('webhook handler done — chain skipped (empty call)', { call_id: callRow.id })
    return Response.json({ ok: true, callId: callRow.id, skipped: 'transcript_too_short' })
  }

  // Generate a one-shot upload token + persist on the call. Used downstream
  // by the photo-request SMS that fires from /api/intake/structure once the
  // intake quality gate confirms the call had usable content.
  const photoRequestToken = generateShareToken()
  await supabase
    .from('calls')
    .update({ photo_request_token: photoRequestToken })
    .eq('id', callRow.id)
  log.ok('photo_request_token generated', { token: photoRequestToken.slice(0, 8) + '…' })

  // Dispatch to /api/intake/structure. The intake handler now owns BOTH
  // the photo-request SMS (suppressed when intake quality is empty) and
  // the dispatch to /api/estimate/draft (also suppressed when empty).
  // Webhook used to fire the photo SMS itself; that was moved to keep the
  // gate centralised — a single decision point per call.
  after(async () => {
    const dispatch = pipelineLog('webhook', callRow.id)
    dispatch.step('dispatching to /api/intake/structure')
    try {
      const res = await fetch(`${process.env.APP_URL}/api/intake/structure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: callRow.id }),
      })
      if (res.ok) {
        dispatch.ok('intake/structure dispatched', { http: res.status })
      } else {
        dispatch.err('intake/structure rejected', `HTTP ${res.status}`, { body: (await res.text()).slice(0, 200) })
      }
    } catch (e) {
      dispatch.err('intake dispatch threw', e)
    }
  })

  log.done('webhook handler done', { call_id: callRow.id })
  return Response.json({ ok: true, callId: callRow.id })
}
