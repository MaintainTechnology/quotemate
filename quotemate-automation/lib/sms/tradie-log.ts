// Record tradie alerts so "did the tradie actually get told?" is a query.
//
// Customer turns are persisted by their callers; tradie alerts were persisted
// by nobody, on any trade. Recording here — one level below every notifier
// (roofing/painting notify, booking-notify, solar, estimate/draft, web-lead) —
// covers them all at once, including FAILED sends, which is the case worth
// catching: a silent Twilio reject used to leave no trace anywhere.
//
// conversation_id stays null by design (migration 183). A tradie alert is not
// part of the customer thread and must never appear in it: app/api/sms/inbound
// feeds that thread to the receptionist model as history, so an alert in there
// would corrupt the model's context and echo owner_mobile back at the customer.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Untyped client, like every other sms_messages writer (lib/voice/trade-handover,
// api/intake/structure, api/cron/followup-2h) — the generated row types predate
// migration 183's audience/to_number/tenant_id columns.
let client: SupabaseClient | null = null

function db(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  client ??= createClient(url, key)
  return client
}

/**
 * Best-effort. Never throws: the alert has already been sent (or already
 * failed) by the time this runs, and losing the audit row must not turn a
 * delivered notification into an error for the caller.
 */
export async function recordTradieSend(args: {
  to: string
  body: string
  ok: boolean
  sid?: string | null
  tenantId?: string | null
}): Promise<void> {
  try {
    const supabase = db()
    if (!supabase) return
    const { error } = await supabase.from('sms_messages').insert({
      conversation_id: null,
      direction: 'outbound',
      audience: 'tradie',
      to_number: args.to,
      tenant_id: args.tenantId ?? null,
      // A failed send is still worth a row — mark it so a reader can tell the
      // difference without joining Twilio logs.
      body: args.ok ? args.body : `[send failed] ${args.body}`,
      twilio_message_sid: args.sid ?? null,
    })
    if (error) {
      console.warn('[sms/tradie-log] could not record tradie send (non-fatal)', error.message)
    }
  } catch (e) {
    console.warn('[sms/tradie-log] could not record tradie send (non-fatal)', e)
  }
}
