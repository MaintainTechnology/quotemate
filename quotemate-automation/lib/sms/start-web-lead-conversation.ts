// Dialog-first web lead bridge.
//
// A homeowner submits the /t/<slug> form (name, mobile, suburb, description,
// photo). Instead of one-shot drafting a quote, we seed an SMS conversation,
// ask the FIRST missing clarifying question via SMS, and alert the tradie that
// a hot lead came in. The customer's reply then flows through the unchanged
// /api/sms/inbound dialog engine → finish → /api/intake/structure →
// /api/estimate/draft, exactly like a native SMS lead.
//
// This helper is HTTP-agnostic and takes its Supabase client by injection so it
// is straightforward to unit-test. It MUST NOT create an `intakes` row or call
// /api/estimate/draft — the SMS pipeline owns intake creation (its
// `!hasExistingIntake` precondition would otherwise break).

import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decideNextTurn, type ConversationTurn } from './dialog'
import { seedStateFromKnownFields } from './extract-slots'
import { dispatchQuoteMessage } from './dispatch'
import { buildTradieWebLeadAlert } from './templates'
import { pipelineLog } from '@/lib/log/pipeline'

export type WebLeadTenant = {
  id: string
  business_name: string | null
  trade: string | null
  trades: string[] | null
  owner_mobile: string
  owner_first_name: string | null
  twilio_sms_number: string | null
}

export type StartWebLeadInput = {
  supabase: SupabaseClient
  tenant: WebLeadTenant
  form: { name: string; mobile: string; suburb: string; description: string }
  photoPaths: string[]
  photoUrls: string[]
  customerId: string | null
  /** process.env.TWILIO_SMS_NUMBER — used when the tenant has no provisioned number. */
  fallbackFrom?: string | null
}

export type StartWebLeadResult = { conversationId: string; reused: boolean; firstReply: string | null }

export async function startWebLeadConversation(input: StartWebLeadInput): Promise<StartWebLeadResult> {
  const { supabase, tenant, form, photoPaths, photoUrls, customerId, fallbackFrom } = input
  const log = pipelineLog('dispatch', `webLead:${tenant.id.slice(0, 8)}`)
  const fromNumber = tenant.twilio_sms_number ?? fallbackFrom ?? undefined
  if (!fromNumber) {
    log.err('web-lead: tenant has no SMS number and TWILIO_SMS_NUMBER is unset — customer SMS will be skipped', null, {
      tenant_id: tenant.id,
    })
  }

  // a. Dedupe — reuse an OPEN customer_quote conversation for this (from_number, tenant_id)
  //    so a double-submit doesn't spawn two threads.
  const { data: existing } = await supabase
    .from('sms_conversations')
    .select('id')
    .eq('from_number', form.mobile)
    .eq('tenant_id', tenant.id)
    .eq('status', 'open')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (existing?.id) {
    log.ok('web-lead: reusing existing open conversation', { conversation_id: existing.id })
    return { conversationId: existing.id as string, reused: true, firstReply: null }
  }

  // c. Seed conversation_state with the identity fields so the dialog skips
  //    re-asking name/suburb. job_type is left for the dialog to guess from the
  //    synthetic message below (its job_type_guess output handles it).
  const conversationState = seedStateFromKnownFields({ first_name: form.name, suburb: form.suburb })

  // d. Create the conversation row. intake_id stays null — the SMS pipeline
  //    sets it when the dialog reaches action='finish'.
  const { data: convo, error: convErr } = await supabase
    .from('sms_conversations')
    .insert({
      from_number: form.mobile,
      to_number: fromNumber ?? null,
      status: 'open',
      conversation_type: 'customer_quote',
      tenant_id: tenant.id,
      customer_id: customerId,
      photo_request_token: randomBytes(16).toString('hex'),
      photo_urls: photoUrls,
      photo_paths: photoPaths,
      conversation_state: conversationState,
      turn_count: 0,
    })
    .select('id')
    .single()
  if (convErr || !convo) {
    log.err('web-lead: conversation insert failed', convErr?.message, { tenant_id: tenant.id })
    throw convErr ?? new Error('conversation insert failed')
  }
  const conversationId = convo.id as string

  // e. Synthetic inbound message = the customer's "first text". Carries the
  //    photos so the later structureIntake aggregates them onto the intake.
  const inboundBody = form.description.trim()
  await supabase.from('sms_messages').insert({
    conversation_id: conversationId,
    direction: 'inbound',
    body: inboundBody,
    photo_urls: photoUrls,
    photo_paths: photoPaths,
  })

  // f. First dialog turn. Photos already on file → photoLink='already_sent' so
  //    the dialog doesn't fire a "send us a pic" link.
  const history: ConversationTurn[] = [{ direction: 'inbound', body: inboundBody }]
  let firstReply: string
  let assumptions: string[] = []
  try {
    const decision = await decideNextTurn({
      history,
      inboundCount: 1,
      knownFields: { firstName: form.name, suburb: form.suburb },
      conversationState,
      tenantTrades: tenant.trades ?? undefined,
      photoLink: 'already_sent',
    })
    firstReply = decision.reply_to_send
    assumptions = Array.isArray(decision.assumptions_made) ? decision.assumptions_made : []
  } catch (e: unknown) {
    log.err('web-lead: decideNextTurn failed — using fixed first question', e instanceof Error ? e.message : String(e), {
      conversation_id: conversationId,
    })
    firstReply =
      `Thanks ${form.name}! Got your request: "${inboundBody.slice(0, 80)}". ` +
      `One quick question so we can price it right — could you tell me a bit more about the job?`
  }

  // g. Send the first SMS to the customer from the tenant's number.
  let sentSid: string | null = null
  if (fromNumber) {
    const res = await dispatchQuoteMessage({ to: form.mobile, text: firstReply, from: fromNumber })
    if (res.ok) {
      sentSid = res.sid
      log.ok('web-lead: first question sent', { channel: res.channel, sid: res.sid })
    } else {
      log.err('web-lead: first question send failed', null, { code: res.smsAttempt?.code })
    }
  }

  // h. Persist the outbound message + bump the conversation turn.
  await supabase.from('sms_messages').insert({
    conversation_id: conversationId,
    direction: 'outbound',
    body: firstReply,
    twilio_message_sid: sentSid,
  })
  await supabase
    .from('sms_conversations')
    .update({
      turn_count: 1,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      assumptions_made: assumptions,
    })
    .eq('id', conversationId)

  // i. Alert the tradie — a hot lead is never lost even if the customer goes quiet.
  try {
    const alert = buildTradieWebLeadAlert({
      tradieFirstName: tenant.owner_first_name,
      customerName: form.name,
      suburb: form.suburb,
      description: form.description,
    })
    const r = await dispatchQuoteMessage({ to: tenant.owner_mobile, text: alert, from: fromNumber })
    if (r.ok) log.ok('web-lead: tradie alerted', { sid: r.sid })
    else log.err('web-lead: tradie alert failed', null, { code: r.smsAttempt?.code })
  } catch (e: unknown) {
    log.err('web-lead: tradie alert threw', e instanceof Error ? e.message : String(e), {
      conversation_id: conversationId,
    })
  }

  return { conversationId, reused: false, firstReply }
}
