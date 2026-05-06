// ─────────────────────────────────────────────────────────────────────
// SMS Agent — Phase 2 (the AI brain).
// Validates Twilio signature, persists inbound, asks the Haiku dialog
// agent (lib/sms/dialog.ts) what to do next, sends the reply via the
// shared dispatcher (SMS-first / WhatsApp-fallback), persists outbound,
// updates conversation status + assumptions, and on `finish` fires a
// fire-and-forget handoff to /api/intake/structure.
// Phase 1 plumbing (signature validation, dispatcher, hardening) is
// preserved verbatim — the only swap is STATIC_REPLY → decideNextTurn.
// ─────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'
import {
  validateTwilioSignature,
  parseTwilioForm,
} from '@/lib/sms/twilio-validator'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'
import { decideNextTurn, type ConversationTurn } from '@/lib/sms/dialog'
import { extractAndStoreMmsPhotos } from '@/lib/sms/mms'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Graceful fallback if the dialog agent throws — the customer still gets
// a reply rather than silence.
const DIALOG_FALLBACK_REPLY =
  "Thanks — we'll get back to you shortly to confirm details."

export async function POST(req: Request) {
 try {
  console.log('[sms/inbound] step 1 — reading body')
  // 1. Read raw body (needed for both signature check and field parsing).
  const rawBody = await req.text()
  const params = parseTwilioForm(rawBody)

  // 2. Verify the request really came from Twilio.
  // Reconstruct the URL from forwarded headers so the signature math matches
  // what the original requester (Twilio or our simulator) signed against.
  // On Vercel, req.url can reflect an internal deployment URL while the
  // original request hit the production alias — the forwarded headers
  // preserve the original.
  const signature = req.headers.get('x-twilio-signature')
  const reqUrl = new URL(req.url)
  const forwardedHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'https'
  const url = forwardedHost
    ? `${forwardedProto}://${forwardedHost}${reqUrl.pathname}${reqUrl.search}`
    : reqUrl.toString()

  if (!validateTwilioSignature(signature, url, params)) {
    console.warn('[sms/inbound] rejected — bad Twilio signature', {
      url,
      reqUrl: req.url,
      forwardedHost: req.headers.get('x-forwarded-host'),
      forwardedProto: req.headers.get('x-forwarded-proto'),
      host: req.headers.get('host'),
      hasSignature: !!signature,
      hasAuthToken: !!process.env.TWILIO_AUTH_TOKEN,
      authTokenLen: process.env.TWILIO_AUTH_TOKEN?.length ?? 0,
      paramsKeys: Object.keys(params).sort(),
    })
    return new Response('Invalid signature', { status: 403 })
  }

  const fromNumber = params.From
  const toNumber = params.To
  const inboundBody = (params.Body ?? '').trim()
  const messageSid = params.MessageSid ?? null

  if (!fromNumber || !toNumber || !inboundBody) {
    return new Response('Missing required Twilio fields', { status: 400 })
  }

  console.log('[sms/inbound] step 3 — looking up conversation', { fromNumber })
  // 3. Find an open conversation with this customer, or create one.
  const { data: existing, error: lookupErr } = await supabase
    .from('sms_conversations')
    .select('*')
    .eq('from_number', fromNumber)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lookupErr) {
    console.error('[sms/inbound] conversation lookup failed', lookupErr)
    return new Response('DB error', { status: 500 })
  }

  let conversation = existing
  if (!conversation) {
    const { data: created, error: createErr } = await supabase
      .from('sms_conversations')
      .insert({
        from_number: fromNumber,
        to_number: toNumber,
        status: 'open',
      })
      .select()
      .single()
    if (createErr || !created) {
      console.error('[sms/inbound] conversation create failed', createErr)
      return new Response('DB error', { status: 500 })
    }
    conversation = created
  }

  // 4a. If this is an MMS, fetch the media from Twilio and upload to our
  //     intake-photos bucket BEFORE persisting the inbound row, so the
  //     resulting signed URLs land on the same row.
  let inboundPhotoUrls: string[] = []
  const numMedia = parseInt(params.NumMedia ?? '0', 10)
  if (Number.isFinite(numMedia) && numMedia > 0) {
    console.log('[sms/inbound] step 4a — extracting MMS attachments', {
      numMedia,
      conversationId: conversation.id,
    })
    try {
      const result = await extractAndStoreMmsPhotos({
        conversationId: conversation.id,
        params,
      })
      inboundPhotoUrls = result.signedUrls
      const failed = result.attempts.filter(a => !a.ok)
      if (failed.length) {
        console.warn('[sms/inbound] step 4a — some MMS attachments failed', {
          ok: result.signedUrls.length,
          failed: failed.length,
          reasons: failed.map(f => 'reason' in f ? f.reason : 'unknown'),
        })
      } else {
        console.log('[sms/inbound] step 4a — MMS attachments stored', {
          count: result.signedUrls.length,
        })
      }
    } catch (e) {
      console.error('[sms/inbound] step 4a — MMS extraction threw', e)
    }
  }

  console.log('[sms/inbound] step 4 — persisting inbound', {
    conversationId: conversation.id,
    photoCount: inboundPhotoUrls.length,
  })
  // 4. Persist the inbound message — including any MMS photo URLs we
  //    just stored.
  await supabase.from('sms_messages').insert({
    conversation_id: conversation.id,
    direction: 'inbound',
    body: inboundBody,
    twilio_message_sid: messageSid,
    photo_urls: inboundPhotoUrls,
  })

  console.log('[sms/inbound] step 5 — loading conversation history')
  // 5. Load the full message history (oldest first) — including the inbound
  //    we just persisted, so the agent sees the customer's latest message
  //    as the most recent turn.
  const { data: historyRows } = await supabase
    .from('sms_messages')
    .select('direction, body, created_at')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true })

  const turns: ConversationTurn[] = (historyRows ?? []).map(m => ({
    direction: m.direction as 'inbound' | 'outbound',
    body: m.body,
  }))
  const inboundCount = turns.filter(t => t.direction === 'inbound').length

  console.log('[sms/inbound] step 6 — calling Haiku dialog agent', {
    turnCount: turns.length,
    inboundCount,
  })
  // 6. Ask Haiku what to do next — ask | finish | escalate_inspection.
  let decision: Awaited<ReturnType<typeof decideNextTurn>>
  try {
    decision = await decideNextTurn({ history: turns, inboundCount })
    console.log('[sms/inbound] step 6 — decision', {
      action: decision.action,
      job_type_guess: decision.job_type_guess,
      ready_for_intake: decision.ready_for_intake,
      assumptions: decision.assumptions_made.length,
    })
  } catch (err: any) {
    console.error('[sms/inbound] dialog agent failed', {
      message: err?.message,
      name: err?.name,
    })
    // Graceful fallback so the customer still gets a reply.
    decision = {
      action: 'escalate_inspection',
      job_type_guess: 'unknown',
      reply_to_send: DIALOG_FALLBACK_REPLY,
      assumptions_made: [],
      ready_for_intake: false,
      reason_for_escalation: 'dialog agent error',
    }
  }

  console.log('[sms/inbound] step 7 — dispatching reply (SMS-first, WhatsApp fallback)')
  // 7. Send the reply via the shared dispatcher used by the voice agent.
  // Same SMS-first / WhatsApp-fallback strategy lives in lib/sms/dispatch.ts.
  // We pass `from: toNumber` so the SMS reply originates from the same number
  // the customer texted (TWILIO_SMS_NUMBER), keeping the conversation in one
  // thread on the customer's phone. WhatsApp fallback uses TWILIO_WHATSAPP_FROM
  // automatically (the dispatcher handles that).
  const dispatch = await dispatchQuoteMessage({
    to: fromNumber,
    from: toNumber,
    text: decision.reply_to_send,
  })

  let outboundSid: string | null = null
  let outboundChannel: 'sms' | 'whatsapp' | null = null

  if (dispatch.ok) {
    outboundSid = dispatch.sid
    outboundChannel = dispatch.channel
    console.log('[sms/inbound] step 7 — dispatch OK', {
      channel: outboundChannel,
      sid: outboundSid,
      smsFallbackReason: dispatch.smsAttempt?.reason,
    })
  } else {
    console.error('[sms/inbound] step 7 — dispatch failed (both channels)', {
      smsAttempt: dispatch.smsAttempt,
      waAttempt: dispatch.waAttempt,
    })
  }

  console.log('[sms/inbound] step 8 — persisting outbound', { channel: outboundChannel })
  // 8. Persist the outbound message — prefix with "[WhatsApp fallback]" when
  //    SMS-to-customer was rejected and we delivered via WhatsApp instead.
  await supabase.from('sms_messages').insert({
    conversation_id: conversation.id,
    direction: 'outbound',
    body: outboundChannel === 'whatsapp'
      ? `[WhatsApp fallback] ${decision.reply_to_send}`
      : decision.reply_to_send,
    twilio_message_sid: outboundSid,
  })

  // 9. Update conversation: bump turn_count, merge assumptions, set status
  //    based on the dialog agent's decision.
  //      ask                  → status stays 'open'
  //      finish               → status 'structuring' (downstream intake will run)
  //      escalate_inspection  → status 'done' (customer is being asked to book inspection)
  const newStatus =
    decision.action === 'finish' ? 'structuring'
  : decision.action === 'escalate_inspection' ? 'done'
  : 'open'

  const mergedAssumptions = [
    ...((conversation.assumptions_made as string[] | null) ?? []),
    ...decision.assumptions_made,
  ]

  console.log('[sms/inbound] step 9 — updating conversation', {
    newStatus,
    mergedAssumptionsCount: mergedAssumptions.length,
  })
  await supabase
    .from('sms_conversations')
    .update({
      turn_count: conversation.turn_count + 1,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      assumptions_made: mergedAssumptions,
      status: newStatus,
    })
    .eq('id', conversation.id)

  // 10. If the dialog finished, hand off to the existing intake pipeline.
  //     Fire-and-forget — the customer already got their reply in step 7,
  //     so the webhook returns fast even if structuring takes a while.
  if (decision.action === 'finish') {
    console.log('[sms/inbound] step 10 — firing intake/structure handoff', {
      conversationId: conversation.id,
    })
    fetch(`${process.env.APP_URL}/api/intake/structure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: conversation.id,
        sourceChannel: 'sms',
      }),
    }).catch(e => console.error('[sms/inbound] intake handoff failed', e))
  }

  console.log('[sms/inbound] step 11 — returning 200 OK')
  // 11. Twilio is happy with any 2xx — we replied via REST in step 7.
  return new Response('ok', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
 } catch (err: any) {
  console.error('[sms/inbound] UNHANDLED error', {
    message: err?.message,
    name: err?.name,
    stack: err?.stack?.split('\n').slice(0, 8).join('\n'),
  })
  return new Response(
    JSON.stringify({ error: err?.message ?? String(err) }),
    { status: 500, headers: { 'Content-Type': 'application/json' } },
  )
 }
}
