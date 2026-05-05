// ─────────────────────────────────────────────────────────────────────
// Phase 1 STUB — plumbing only.
// Validates Twilio signature, persists messages, sends a static reply.
// Phase 2 swaps STATIC_REPLY for the Haiku dialog agent (lib/sms/dialog.ts).
// Phase 3 adds the fire-and-forget handoff to /api/intake/structure.
// Full final shape lives in docs/sms-sop.html SMS06.
// ─────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'
import {
  validateTwilioSignature,
  parseTwilioForm,
} from '@/lib/sms/twilio-validator'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const STATIC_REPLY =
  "Thanks — we got your message. Our SMS quoting agent goes live shortly. We'll be in touch."

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

  console.log('[sms/inbound] step 4 — persisting inbound', { conversationId: conversation.id })
  // 4. Persist the inbound message.
  await supabase.from('sms_messages').insert({
    conversation_id: conversation.id,
    direction: 'inbound',
    body: inboundBody,
    twilio_message_sid: messageSid,
  })

  console.log('[sms/inbound] step 5 — dispatching reply (SMS-first, WhatsApp fallback)')
  // 5. Send the reply via the shared dispatcher used by the voice agent.
  // Same SMS-first / WhatsApp-fallback strategy lives in lib/sms/dispatch.ts.
  // We pass `from: toNumber` so the SMS reply originates from the same number
  // the customer texted (TWILIO_SMS_NUMBER), keeping the conversation in one
  // thread on the customer's phone. WhatsApp fallback uses TWILIO_WHATSAPP_FROM
  // automatically (the dispatcher handles that).
  const dispatch = await dispatchQuoteMessage({
    to: fromNumber,
    from: toNumber,
    text: STATIC_REPLY,
  })

  let outboundSid: string | null = null
  let outboundChannel: 'sms' | 'whatsapp' | null = null

  if (dispatch.ok) {
    outboundSid = dispatch.sid
    outboundChannel = dispatch.channel
    console.log('[sms/inbound] step 5 — dispatch OK', {
      channel: outboundChannel,
      sid: outboundSid,
      smsFallbackReason: dispatch.smsAttempt?.reason,
    })
  } else {
    console.error('[sms/inbound] step 5 — dispatch failed (both channels)', {
      smsAttempt: dispatch.smsAttempt,
      waAttempt: dispatch.waAttempt,
    })
  }

  console.log('[sms/inbound] step 6 — persisting outbound', { channel: outboundChannel })
  // 6. Persist the outbound message.
  await supabase.from('sms_messages').insert({
    conversation_id: conversation.id,
    direction: 'outbound',
    body: outboundChannel === 'whatsapp'
      ? `[WhatsApp fallback] ${STATIC_REPLY}`
      : STATIC_REPLY,
    twilio_message_sid: outboundSid,
  })

  console.log('[sms/inbound] step 7 — updating conversation')
  // 7. Bump turn count and timestamps.
  await supabase
    .from('sms_conversations')
    .update({
      turn_count: conversation.turn_count + 1,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  console.log('[sms/inbound] step 8 — returning 200 OK')
  // 8. Twilio is happy with any 2xx — we replied via REST in step 5.
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
