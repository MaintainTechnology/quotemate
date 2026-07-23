// ════════════════════════════════════════════════════════════════════
// Voice → SMS-receptionist handover (2026-07-23).
//
// A roofing or painting voice call must be processed by the SAME
// deterministic pipeline the SMS receptionist runs — same questions, same
// map-checked address confirm, same measure → "is this your roof?" →
// priced-quote chain, same customer messages, same tradie notify. (Live
// incident: a roofing call fell through to the generic electrical/plumbing
// intake→estimate pipeline and produced a $99-inspection quote instead of
// the satellite-measured roofing quote.)
//
// Mechanism — the web-lead bridge pattern (start-web-lead-conversation.ts),
// but for the trade state machines: extract the caller's spoken answers
// from the transcript (one Sonnet call), map them through the SMS machines'
// OWN parsers (applyRoofingAnswer / applyPaintingAnswer — zero vocabulary
// drift), seed an sms_conversations row with roofing_state/painting_state,
// and text the machine's own next question from the tenant's number. The
// customer's reply then flows through the UNCHANGED /api/sms/inbound
// receptionist — everything downstream is literally the SMS process.
//
// Electrical/plumbing (and solar/aircon/etc., which have no SMS trade
// machine) keep the generic intake→estimate pipeline untouched:
// decideVoiceTradeHandover returns null for them.
//
// The extraction is the only LLM step; everything else is pure + tested.
// Any failure anywhere returns false so the webhook falls through to the
// generic pipeline — the safe pre-existing behaviour.
// ════════════════════════════════════════════════════════════════════

import { anthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SMS_RECEPTIONIST_MODEL, SMS_RECEPTIONIST_MAX_TOKENS } from '@/lib/sms/model'
import {
  applyRoofingAnswer,
  nextRoofingStep,
  type RoofingSlots,
} from '@/lib/sms/roofing-intake'
import type { RoofingConversationState } from '@/lib/sms/roofing-receptionist'
import {
  applyPaintingAnswer,
  nextPaintingStep,
  type PaintingSlots,
} from '@/lib/sms/painting-intake'
import type { PaintingConversationState } from '@/lib/sms/painting-receptionist'
import { screenConfirmAddress } from '@/lib/sms/verify-address'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'
import { pipelineLog } from '@/lib/log/pipeline'

// ── Extraction (the one LLM step) ────────────────────────────────────

const AnswersSchema = z.object({
  trade: z.enum(['roofing', 'painting', 'other']),
  first_name: z.string().nullish(),
  /** Full property address as spoken, incl. suburb/state/postcode. */
  address: z.string().nullish(),
  // Roofing answers — customer's words verbatim.
  material: z.string().nullish(),
  pitch: z.string().nullish(),
  intent: z.string().nullish(),
  // Painting answers — customer's words verbatim.
  surfaces: z.string().nullish(),
  coats: z.string().nullish(),
  condition: z.string().nullish(),
  ceiling_height: z.string().nullish(),
  storeys: z.string().nullish(),
  colour_change: z.string().nullish(),
})

export type VoiceTradeAnswers = z.infer<typeof AnswersSchema>

const EXTRACT_SYSTEM = `You extract structured intake answers from an Australian tradie phone-call transcript (AI receptionist + caller).

Return ONLY a JSON object, no prose, with these fields (null when not stated):
{
  "trade": "roofing" | "painting" | "other",
  "first_name": string | null,
  "address": string | null,
  "material": string | null, "pitch": string | null, "intent": string | null,
  "surfaces": string | null, "coats": string | null, "condition": string | null,
  "ceiling_height": string | null, "storeys": string | null, "colour_change": string | null
}

Rules:
- trade is "roofing" ONLY when the caller wants roof work (re-roof, roof repair, leak, gutters). "painting" ONLY for residential painting jobs. EVERYTHING else — electrical, plumbing, solar, aircon, signage, commercial painting, unclear — is "other".
- Copy the CALLER'S OWN WORDS verbatim into each answer field (e.g. material: "colorbond", pitch: "pretty steep", intent: "full re-roof"). Do not normalise or interpret.
- address = the full property address as the caller stated it (street, suburb, state, postcode when given).
- first_name = the caller's first name if they gave one.`

export async function extractVoiceTradeAnswers(
  transcript: string,
): Promise<VoiceTradeAnswers | null> {
  try {
    const { text } = await generateText({
      model: anthropic(SMS_RECEPTIONIST_MODEL),
      maxOutputTokens: SMS_RECEPTIONIST_MAX_TOKENS,
      maxRetries: 1,
      system: EXTRACT_SYSTEM,
      prompt: `TRANSCRIPT:\n${transcript.slice(0, 12000)}`,
    })
    const raw = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
    return AnswersSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

// ── Pure core ────────────────────────────────────────────────────────

/** Which trade machine (if any) should own this call's follow-up. Null =
 *  generic pipeline (electrical/plumbing untouched; trades the tenant
 *  doesn't offer never hand over). */
export function decideVoiceTradeHandover(
  trade: string | null | undefined,
  tenantTrades: string[] | null | undefined,
): 'roofing' | 'painting' | null {
  if (trade !== 'roofing' && trade !== 'painting') return null
  if (!Array.isArray(tenantTrades) || !tenantTrades.includes(trade)) return null
  return trade
}

/** Spoken answers → RoofingSlots via the SMS machine's OWN per-step
 *  parsers (metal_hint, unknown-material routing, etc. all identical).
 *  Unparseable answers leave the slot empty — the SMS machine asks. */
export function mapVoiceAnswersToRoofingSlots(
  a: Partial<VoiceTradeAnswers>,
): RoofingSlots {
  let slots: RoofingSlots = {}
  if (a.address) slots = applyRoofingAnswer(slots, 'address', a.address)
  if (a.intent) slots = applyRoofingAnswer(slots, 'intent', a.intent)
  if (a.material) slots = applyRoofingAnswer(slots, 'material', a.material)
  if (a.pitch) slots = applyRoofingAnswer(slots, 'pitch', a.pitch)
  // The SMS flow must ALWAYS re-confirm the address by text — the map
  // check (screenConfirmAddress) runs there, and a misheard voice address
  // must never be measured unverified.
  slots.address_confirmed = false
  return slots
}

export function mapVoiceAnswersToPaintingSlots(
  a: Partial<VoiceTradeAnswers>,
): PaintingSlots {
  let slots: PaintingSlots = {}
  if (a.address) slots = applyPaintingAnswer(slots, 'address', a.address)
  if (a.surfaces) slots = applyPaintingAnswer(slots, 'scopes', a.surfaces)
  if (a.coats) slots = applyPaintingAnswer(slots, 'coats', a.coats)
  if (a.condition) slots = applyPaintingAnswer(slots, 'condition', a.condition)
  if (a.ceiling_height) slots = applyPaintingAnswer(slots, 'ceiling_height', a.ceiling_height)
  if (a.storeys) slots = applyPaintingAnswer(slots, 'storeys', a.storeys)
  if (a.colour_change) slots = applyPaintingAnswer(slots, 'colour_change', a.colour_change)
  slots.address_confirmed = false
  return slots
}

/** Seeded slots → the machine's own opening state + first SMS question.
 *  Null when the machine has no question to ask (defensive — with
 *  address_confirmed=false the first step is always address/confirm). */
export function buildRoofingHandoverOpening(slots: RoofingSlots): {
  state: RoofingConversationState
  question: string
} | null {
  const next = nextRoofingStep(slots)
  if (!next.question) return null
  return { state: { slots, last_step: next.step }, question: next.question }
}

export function buildPaintingHandoverOpening(slots: PaintingSlots): {
  state: PaintingConversationState
  question: string
} | null {
  const next = nextPaintingStep(slots)
  if (!next.question) return null
  return { state: { slots, last_step: next.step }, question: next.question }
}

// ── Orchestrator (called by the Vapi webhook) ────────────────────────

export async function runVoiceTradeHandover(args: {
  supabase: SupabaseClient
  tenantId: string | null
  callerNumber: string | null
  transcript: string
}): Promise<boolean> {
  const { supabase, tenantId, callerNumber, transcript } = args
  if (!tenantId || !callerNumber || !transcript.trim()) return false
  const log = pipelineLog('dispatch', `voiceHandover:${tenantId.slice(0, 8)}`)

  // Tenant gate BEFORE the LLM call — electrical/plumbing-only tenants
  // never pay for an extraction that can't hand over.
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, business_name, trades, twilio_sms_number')
    .eq('id', tenantId)
    .maybeSingle()
  const trades = (tenant?.trades as string[] | null) ?? []
  if (!trades.includes('roofing') && !trades.includes('painting')) return false

  const answers = await extractVoiceTradeAnswers(transcript)
  if (!answers) return false
  const trade = decideVoiceTradeHandover(answers.trade, trades)
  if (!trade) return false

  const opening =
    trade === 'roofing'
      ? buildRoofingHandoverOpening(mapVoiceAnswersToRoofingSlots(answers))
      : buildPaintingHandoverOpening(mapVoiceAnswersToPaintingSlots(answers))
  if (!opening) return false

  // Map-check the address BEFORE reading it back — identical to the SMS
  // route's confirm_address screening (a misheard suburb must not pass).
  if (opening.state.last_step === 'confirm_address') {
    const screened = await screenConfirmAddress(opening.state.slots)
    opening.state.slots = screened.slots
    if (screened.step) opening.state.last_step = screened.step
    if (screened.reply) opening.question = screened.reply
  }

  const fromNumber =
    (tenant?.twilio_sms_number as string | null) ?? process.env.TWILIO_SMS_NUMBER ?? null
  const stateCol = trade === 'roofing' ? 'roofing_state' : 'painting_state'

  // Reuse an open conversation for this (caller, tenant) or create one —
  // the /api/sms/inbound receptionist owns it from the first reply on.
  const { data: existing } = await supabase
    .from('sms_conversations')
    .select('id')
    .eq('from_number', callerNumber)
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  let conversationId: string
  if (existing?.id) {
    conversationId = existing.id as string
    const { error } = await supabase
      .from('sms_conversations')
      .update({
        [stateCol]: opening.state,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)
    if (error) {
      log.err('voice-handover: state update failed', error.message)
      return false
    }
  } else {
    const { data: convo, error } = await supabase
      .from('sms_conversations')
      .insert({
        from_number: callerNumber,
        to_number: fromNumber,
        status: 'open',
        conversation_type: 'customer_quote',
        tenant_id: tenantId,
        [stateCol]: opening.state,
        turn_count: 0,
      })
      .select('id')
      .single()
    if (error || !convo) {
      log.err('voice-handover: conversation insert failed', error?.message)
      return false
    }
    conversationId = convo.id as string
  }

  // One short bridge line, then the machine's OWN question — every
  // message after this comes verbatim from the SMS receptionist.
  const first = (answers.first_name ?? '').trim().split(/\s+/)[0]
  const business = (tenant?.business_name as string | null) ?? 'the team'
  const opener = `${first ? `Hi ${first}, thanks` : 'Thanks'} for calling ${business}! Let's finish your ${trade} quote by text. `
  const text = opener + opening.question

  const res = await dispatchQuoteMessage({ to: callerNumber, text, from: fromNumber ?? undefined })
  if (!res.ok) {
    log.err('voice-handover: opening SMS failed on both channels', null, {
      sms_code: res.smsAttempt.code,
    })
    return false
  }
  await supabase.from('sms_messages').insert({
    conversation_id: conversationId,
    direction: 'outbound',
    body: text,
    twilio_message_sid: res.sid,
  })
  await supabase
    .from('sms_conversations')
    .update({ turn_count: 1, last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  log.ok('voice-handover: SMS receptionist thread seeded', {
    conversation_id: conversationId,
    trade,
    step: opening.state.last_step,
  })
  return true
}
