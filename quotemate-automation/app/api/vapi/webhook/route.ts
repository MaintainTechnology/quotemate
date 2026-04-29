import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const payload = await req.json()

  // Vapi sends an event with type 'end-of-call-report'
  if (payload.message?.type !== 'end-of-call-report') {
    return Response.json({ ok: true })
  }

  const call = payload.message.call
  const { data: callRow } = await supabase.from('calls').insert({
    vapi_call_id: call.id,
    caller_number: call.customer?.number,
    duration_seconds: payload.message.durationSeconds,
    transcript: payload.message.transcript,
    recording_url: payload.message.recordingUrl,
    ended_at: new Date().toISOString(),
  }).select().single()

  // Kick off Stage 04 — the Intake Engine — without blocking Vapi's webhook
  fetch(`${process.env.APP_URL}/api/intake/structure`, {
    method: 'POST',
    body: JSON.stringify({ callId: callRow!.id }),
  })

  return Response.json({ ok: true })
}
