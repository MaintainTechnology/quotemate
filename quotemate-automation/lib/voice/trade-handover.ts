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
import { screenAddressForAutoRun, screenConfirmAddress } from '@/lib/sms/verify-address'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'
import {
  measureAndDispatchRoofing,
  ROOFING_APP_BASE_URL,
} from '@/lib/sms/roofing-measure-dispatch'
import {
  composeInspectionReasonMessage,
  composeMeasureUnavailableMessage,
} from '@/lib/sms/roofing-compose'
import { estimateAndDispatchPainting } from '@/lib/sms/painting-estimate-dispatch'
import { buildPaintingInspectionSms } from '@/lib/sms/painting-compose'
import { decidePostCallRoofingAction } from './post-call-roofing'
import { decidePostCallPaintingAction } from './post-call-painting'
import { pipelineLog } from '@/lib/log/pipeline'

// ── Extraction (the one LLM step) ────────────────────────────────────

const AnswersSchema = z.object({
  trade: z.enum(['roofing', 'painting', 'other']),
  first_name: z.string().nullish(),
  /** Full property address as spoken, incl. suburb/state/postcode. */
  address: z.string().nullish(),
  /** The receptionist read the address back and the caller agreed. Gates
   *  measuring straight off the call instead of re-asking by text. */
  address_confirmed: z.boolean().nullish(),
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
  "address": string | null, "address_confirmed": boolean,
  "material": string | null, "pitch": string | null, "intent": string | null,
  "surfaces": string | null, "coats": string | null, "condition": string | null,
  "ceiling_height": string | null, "storeys": string | null, "colour_change": string | null
}

Rules:
- trade is "roofing" ONLY when the caller wants roof work (re-roof, roof repair, leak, gutters). "painting" ONLY for residential painting jobs. EVERYTHING else — electrical, plumbing, solar, aircon, signage, commercial painting, unclear — is "other".
- Copy the CALLER'S OWN WORDS verbatim into each answer field (e.g. material: "colorbond", pitch: "pretty steep", intent: "full re-roof"). Do not normalise or interpret.
- address = the full property address as the caller stated it (street, suburb, state, postcode when given).
- address_confirmed = true ONLY when the receptionist read the address back and the caller agreed it was right ("yep", "that's it", "correct"). false if it was never read back, or the caller corrected it and the correction was not re-confirmed.
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
    .select('id, business_name, trade, trades, twilio_sms_number')
    .eq('id', tenantId)
    .maybeSingle()
  const trades = (tenant?.trades as string[] | null) ?? []
  if (!trades.includes('roofing') && !trades.includes('painting')) return false

  const answers = await extractVoiceTradeAnswers(transcript)
  if (!answers) return false
  const trade = decideVoiceTradeHandover(answers.trade, trades)
  if (!trade) return false

  const fromNumber =
    (tenant?.twilio_sms_number as string | null) ?? process.env.TWILIO_SMS_NUMBER ?? null
  const stateCol = trade === 'roofing' ? 'roofing_state' : 'painting_state'
  const firstName = (answers.first_name ?? '').trim().split(/\s+/)[0] || null

  // ── Roofing: measure off the call, don't re-ask what was agreed ──────
  // The caller gave the address, roof type and job on the phone and the
  // receptionist read the address back for a yes. So the FIRST text is the
  // same buildings/confirm-roof message the SMS receptionist sends after
  // ITS measure — not the address question all over again.
  let measurePlan: ReturnType<typeof decidePostCallRoofingAction> | null = null
  if (trade === 'roofing') {
    const captured = mapVoiceAnswersToRoofingSlots(answers)
    measurePlan = decidePostCallRoofingAction(captured, Boolean(answers.address_confirmed))
    if (measurePlan.action === 'measure') {
      // Map-check before measuring: a misheard suburb must never be
      // measured. Only a clean match auto-runs; a correction (incl. an
      // unconfirmed suburb) or a not-found drops back to the text read-back.
      // NB screenConfirmAddress cannot answer this — it returns a reply for
      // every successful verification, so "has a reply" ≠ "was corrected".
      const screened = await screenAddressForAutoRun(measurePlan.slots)
      if (screened.kind === 'proceed') {
        measurePlan = { ...measurePlan, slots: screened.slots }
      } else {
        measurePlan = {
          action: 'ask',
          slots: screened.slots,
          step: screened.kind === 'reject' ? 'address' : 'confirm_address',
          question: screened.reply,
        }
      }
    }
  }

  // ── Painting: same rule — a complete brief is estimated, not re-asked ─
  let paintPlan: ReturnType<typeof decidePostCallPaintingAction> | null = null
  if (trade === 'painting') {
    const captured = mapVoiceAnswersToPaintingSlots(answers)
    paintPlan = decidePostCallPaintingAction(captured, Boolean(answers.address_confirmed))
    if (paintPlan.action === 'estimate') {
      const screened = await screenAddressForAutoRun(paintPlan.slots)
      if (screened.kind === 'proceed') {
        paintPlan = { ...paintPlan, slots: screened.slots }
      } else {
        paintPlan = {
          action: 'ask',
          slots: screened.slots,
          step: screened.kind === 'reject' ? 'address' : 'confirm_address',
          question: screened.reply,
        }
      }
    }
  }

  const plan = measurePlan ?? paintPlan
  let opening =
    plan?.action === 'ask' && plan.question
      ? { state: { slots: plan.slots, last_step: plan.step }, question: plan.question }
      : trade === 'roofing'
        ? buildRoofingHandoverOpening(measurePlan?.slots ?? mapVoiceAnswersToRoofingSlots(answers))
        : buildPaintingHandoverOpening(paintPlan?.slots ?? mapVoiceAnswersToPaintingSlots(answers))

  // A read-back we're about to TEXT must be map-checked too — the same
  // screen the SMS route runs at confirm_address. Without it a misheard
  // suburb gets parroted back and a "yes" locks it in. Skipped when the
  // question already came from screenAddressForAutoRun above (that call
  // stamps addr_verified, which makes this a no-op anyway).
  if (opening && opening.state.last_step === 'confirm_address') {
    const screened = await screenConfirmAddress(opening.state.slots)
    opening = {
      state: {
        ...opening.state,
        slots: screened.slots,
        last_step: screened.step ?? opening.state.last_step,
      },
      question: screened.reply ?? opening.question,
    }
  }

  // A measure/estimate/inspection plan needs no opening question — that
  // dispatch (or the reason message) IS the first text.
  const acting =
    plan?.action === 'measure' || plan?.action === 'estimate' || plan?.action === 'inspection_reason'
  if (!acting && !opening) return false

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

  // Seed with the gathered slots; the measure/estimate below overwrites the
  // state with the machine's own post-run one (confirm_roof + token, etc.).
  const seedState = opening?.state ?? { slots: plan?.slots ?? {}, last_step: null }

  let conversationId: string
  if (existing?.id) {
    conversationId = existing.id as string
    const { error } = await supabase
      .from('sms_conversations')
      .update({
        [stateCol]: seedState,
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
        [stateCol]: seedState,
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

  /** Send one SMS to the caller and record it on the thread. */
  const sendReply = async (text: string) => {
    const res = await dispatchQuoteMessage({ to: callerNumber, text, from: fromNumber ?? undefined })
    if (!res.ok) {
      log.err('voice-handover: SMS failed on both channels', null, { sms_code: res.smsAttempt.code })
      return res
    }
    await supabase.from('sms_messages').insert({
      conversation_id: conversationId,
      direction: 'outbound',
      body: text,
      twilio_message_sid: res.sid,
    })
    return res
  }
  const persistState = async (state: RoofingConversationState | PaintingConversationState) => {
    await supabase
      .from('sms_conversations')
      .update({
        [stateCol]: state,
        turn_count: 1,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)
  }

  // ── The measure runs here, off the call's own brief ──────────────────
  if (measurePlan?.action === 'measure') {
    const dispatched = await measureAndDispatchRoofing({
      supabase,
      tenantId,
      tenantTrade: (tenant?.trade as string | null) ?? null,
      conversationId,
      customerPhone: callerNumber,
      replyFrom: fromNumber ?? undefined,
      firstName,
      baseUrl: ROOFING_APP_BASE_URL,
      slots: measurePlan.slots,
      isInspection: measurePlan.isInspection,
      inspectionReason: measurePlan.reason,
      sendReply,
    })
    if (dispatched.ok) {
      await persistState(dispatched.state)
      log.ok('voice-handover: measured off the call, confirm SMS sent', {
        conversation_id: conversationId,
        token: dispatched.token,
        structures: dispatched.quote.structures.length,
      })
      return true
    }
    // Measure unavailable despite a complete brief — same safe landing as
    // the SMS route: say so and park at await_booking so a "yes" books the
    // site visit. The lead is never lost.
    await sendReply(
      composeMeasureUnavailableMessage(firstName, measurePlan.slots.address ?? 'your property'),
    )
    await persistState({
      slots: measurePlan.slots,
      last_step: 'await_booking',
      pending_quote_token: null,
      pending_structure_count: null,
    })
    return true
  }

  // ── Painting: run the estimate off the call's brief ──────────────────
  if (paintPlan?.action === 'estimate') {
    const dispatched = await estimateAndDispatchPainting({
      supabase,
      tenantId,
      customerPhone: callerNumber,
      firstName,
      baseUrl: ROOFING_APP_BASE_URL,
      slots: paintPlan.slots,
      sendReply,
    })
    if (dispatched.ok) {
      await persistState(dispatched.state)
      log.ok('voice-handover: painting estimated off the call', {
        conversation_id: conversationId,
        token: dispatched.token,
        inspection: dispatched.inspection,
      })
      return true
    }
    // Same landing as the SMS route when the estimate can't be produced.
    await sendReply("Thanks, we've got your painting details. Our team will confirm your quote shortly.")
    await persistState({
      slots: paintPlan.slots,
      last_step: 'closed',
      pending_form_token: null,
      pending_quote_token: null,
    })
    return true
  }

  // ── The brief itself forces a site visit — say why (SMS parity) ──────
  if (measurePlan?.action === 'inspection_reason') {
    await sendReply(
      composeInspectionReasonMessage(
        firstName,
        measurePlan.slots.address ?? 'your property',
        measurePlan.reason,
      ),
    )
    await persistState({
      slots: measurePlan.slots,
      last_step: 'await_booking',
      pending_quote_token: null,
      pending_structure_count: null,
    })
    return true
  }
  if (paintPlan?.action === 'inspection_reason') {
    await sendReply(
      buildPaintingInspectionSms({
        firstName,
        address: paintPlan.slots.address ?? 'your property',
        reason: paintPlan.reason,
      }),
    )
    await persistState({
      slots: paintPlan.slots,
      last_step: 'await_booking',
      pending_form_token: null,
      pending_quote_token: null,
    })
    return true
  }

  // ── Something's genuinely missing — ask THAT question by text ────────
  // One short bridge line, then the machine's OWN question; every message
  // after this comes verbatim from the SMS receptionist.
  if (!opening) return false
  const business = (tenant?.business_name as string | null) ?? 'the team'
  const opener = `${firstName ? `Hi ${firstName}, thanks` : 'Thanks'} for calling ${business}! Let's finish your ${trade} quote by text. `
  const res = await sendReply(opener + opening.question)
  if (!res.ok) return false
  await persistState(opening.state)

  log.ok('voice-handover: SMS receptionist thread seeded', {
    conversation_id: conversationId,
    trade,
    step: opening.state.last_step,
  })
  return true
}
