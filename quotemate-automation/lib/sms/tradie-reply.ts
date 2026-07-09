// Tradie → customer manual SMS reply, sent from the dashboard Chats tab
// composer. Reuses the pipeline's outbound dispatcher (SMS-first, retries,
// WhatsApp fallback) so a manual reply behaves exactly like an AI turn on
// the wire. Deliberately does NOT bump turn_count — that counter belongs to
// the AI dialog state machine; a manual reply only bumps last_message_at so
// the thread sorts to the top of the Chats rail.
//
// Voice calls have no row in sms_conversations, so a voice chat id simply
// 404s here — the UI hides the composer for voice threads anyway.

import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchQuoteMessage } from './dispatch'

const MAX_SMS_BODY = 1600 // Twilio hard cap for a concatenated message

export type TradieReplyResult =
  | {
      ok: true
      message: { direction: 'outbound'; body: string; created_at: string }
    }
  | { ok: false; status: 404 | 422 | 500 | 502; error: string }

export async function sendTradieReply(opts: {
  supabase: SupabaseClient
  tenantId: string
  conversationId: string
  body: string
}): Promise<TradieReplyResult> {
  const text = opts.body?.trim() ?? ''
  if (text.length === 0) {
    return { ok: false, status: 422, error: 'empty_body' }
  }
  if (text.length > MAX_SMS_BODY) {
    return { ok: false, status: 422, error: 'body_too_long' }
  }

  const { data: convo, error: convoErr } = await opts.supabase
    .from('sms_conversations')
    .select('id, tenant_id, from_number, to_number')
    .eq('id', opts.conversationId)
    .maybeSingle()
  if (convoErr) {
    return { ok: false, status: 500, error: convoErr.message }
  }
  // Unknown id and wrong-tenant id return the same 404 — don't leak that a
  // conversation exists on another tenant.
  if (!convo || convo.tenant_id !== opts.tenantId) {
    return { ok: false, status: 404, error: 'conversation_not_found' }
  }
  if (!convo.from_number) {
    return { ok: false, status: 422, error: 'no_customer_number' }
  }

  // Send first, record second — a failed send must not leave a phantom
  // outbound row in the thread.
  const sent = await dispatchQuoteMessage({
    to: convo.from_number,
    text,
    from: convo.to_number ?? undefined,
  })
  if (!sent.ok) {
    return { ok: false, status: 502, error: `send_failed:${sent.smsAttempt.code}` }
  }

  const { data: message, error: msgErr } = await opts.supabase
    .from('sms_messages')
    .insert({
      conversation_id: convo.id,
      direction: 'outbound',
      body: text,
      twilio_message_sid: sent.sid,
    })
    .select()
    .single()

  await opts.supabase
    .from('sms_conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', convo.id)

  if (msgErr) {
    // SMS went out but the record failed — surface success (the customer got
    // the text) with a synthetic message so the UI stays truthful.
    console.error('[tradie-reply] sent but failed to record message:', msgErr.message)
  }
  const created =
    (message as { created_at?: string } | null)?.created_at ??
    new Date().toISOString()
  return {
    ok: true,
    message: { direction: 'outbound', body: text, created_at: created },
  }
}
