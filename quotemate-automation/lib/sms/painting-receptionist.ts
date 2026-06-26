// ════════════════════════════════════════════════════════════════════
// SMS painting receptionist — pure per-turn decision.
//
// Given the conversation's persisted painting state (gathered slots + the
// step we last asked about) plus the customer's new message, decide the
// turn:
//   • cancel     — customer asked to stop / cancel (checked FIRST).
//   • offer_form — opener: offer the self-serve form link FIRST. The route
//                  mints the per-request token and composes the message
//                  ("fill this in, or reply here and I'll ask a few
//                  questions").
//   • await_form — customer chose the form → acknowledge and wait. The
//                  form POST produces the quote out-of-band ("your quote is
//                  on its way"); a later text switches them to Q&A.
//   • ask        — fold the answer in, send the next question (dropdown
//                  options are inlined in the question text by the intake).
//   • estimate   — enough gathered cleanly → run estimatePainting + send.
//   • inspection — a customer-declared trigger (poor substrate / raked
//                  ceiling / 3+ storeys) forces an on-site visit.
//   • booking    — reply to "shall we book the inspection?". Terminal.
//   • passthrough— a warm 'quoted' thread got an unrelated message → hand
//                  it back to the general dialog (the route returns false).
//
// The route does the I/O (mint token, run estimate, persist, send SMS);
// this module is pure so the conversation logic is fully unit-tested.
// Mirrors lib/sms/roofing-receptionist.ts.
// ════════════════════════════════════════════════════════════════════

import {
  applyPaintingAnswer,
  isAffirmative,
  isNegative,
  isStopRequest,
  looksLikePaintingEnquiry,
  nextPaintingStep,
  type PaintingSlots,
  type PaintingStep,
} from './painting-intake'

/** Persisted on sms_conversations.painting_state (jsonb), decoupled from
 *  the electrical/plumbing conversation_state.slots and the roofing_state. */
export type PaintingConversationState = {
  slots: PaintingSlots
  /** The step we asked the customer about last turn (null on the opener). */
  last_step?: PaintingStep | null
  /** Token of the self-serve form request we minted (the unique-hash link). */
  pending_form_token?: string | null
  /** Token of the saved painting job awaiting / carrying the sent quote. */
  pending_quote_token?: string | null
}

/** The gather steps a customer reply is folded into. */
const ANSWERABLE_STEPS: ReadonlySet<PaintingStep> = new Set<PaintingStep>([
  'address',
  'confirm_address',
  'location',
  'scopes',
  'coats',
  'condition',
  'ceiling_height',
  'storeys',
  'colour_change',
])

export type PaintingTurnDecision =
  // Opener — route mints the form token + composes the offer message.
  | { action: 'offer_form'; slots: PaintingSlots }
  // Customer opted for the form — acknowledge and wait for the submission.
  | { action: 'await_form'; slots: PaintingSlots; reply: string }
  | { action: 'ask'; slots: PaintingSlots; step: PaintingStep; reply: string }
  | { action: 'estimate'; slots: PaintingSlots }
  | { action: 'inspection'; slots: PaintingSlots; reason: string }
  | { action: 'cancel'; slots: PaintingSlots }
  | { action: 'booking'; slots: PaintingSlots; confirmed: boolean }
  | { action: 'passthrough'; slots: PaintingSlots }

const AWAIT_FORM_ACK =
  "Great — fill that in whenever you're ready and I'll text your quote straight over. Or just reply here anytime and I'll ask a few quick questions instead."
const ADDRESS_RETRY =
  "Sorry, I didn't catch a property address there. What's the address? Please include the street number, suburb and postcode."

// The customer is replying to the form offer. We only treat it as "use the
// form" on an EXPLICIT form cue; a decline, or anything ambiguous, starts
// the question-by-question flow (the spec's fallback). A bare "yes" is left
// to Q&A — it's safer to start asking than to assume they want the link.
const FORM_YES = /\b(form|link|fill|online|web ?form|send (it|the form|me the form)|i'?ll (do|use|fill)|use the (form|link))\b/
const FORM_NO = /\b(no|nah|nope|just ask|ask me|answer here|do it here|here|questions?|prefer|rather|over (the )?(phone|text)|by text|quicker|skip|don'?t (bother|want))\b/

/** PURE — did the customer opt to use the self-serve form? Explicit form
 *  cue and not a decline. Anything else → fall back to Q&A. */
export function customerWantsForm(text: string): boolean {
  const t = (text ?? '').toLowerCase()
  if (!t.trim()) return false
  if (FORM_NO.test(t)) return false
  return FORM_YES.test(t)
}

/** PURE — opportunistically capture an address from a message that wasn't
 *  a direct answer to the address question (e.g. a customer who declines
 *  the form by just giving their address). Leaves slots untouched when the
 *  message doesn't parse as an address. */
function captureOpeningAddress(slots: PaintingSlots, inbound: string): PaintingSlots {
  if (slots.address) return slots
  const next = applyPaintingAnswer(slots, 'address', inbound)
  return next.address ? next : slots
}

/** PURE — turn the gathered slots into the next ask/estimate/inspection. */
function fromNextStep(slots: PaintingSlots): PaintingTurnDecision {
  const next = nextPaintingStep(slots)
  if (next.step === 'ready') return { action: 'estimate', slots }
  if (next.step === 'inspection') {
    return { action: 'inspection', slots, reason: next.reason ?? 'an on-site inspection is needed' }
  }
  return { action: 'ask', slots, step: next.step, reply: next.question ?? '' }
}

/**
 * PURE — advance the painting conversation one turn.
 */
export function advancePainting(
  prev: PaintingConversationState | null | undefined,
  inbound: string,
): PaintingTurnDecision {
  const lastStep = prev?.last_step ?? null
  let slots: PaintingSlots = { ...(prev?.slots ?? {}) }

  // (1) Stop / cancel / opt-out — always honoured first, at any step.
  if (isStopRequest(inbound)) {
    return { action: 'cancel', slots }
  }

  // (2) Awaiting "shall we book the inspection?".
  if (lastStep === 'await_booking') {
    return { action: 'booking', slots, confirmed: isAffirmative(inbound) && !isNegative(inbound) }
  }

  // (3) Reply to the form offer — use the form, or start the questions.
  if (lastStep === 'offer_form') {
    if (customerWantsForm(inbound)) {
      return { action: 'await_form', slots, reply: AWAIT_FORM_ACK }
    }
    // Declined / answering here → start Q&A. Capture an address if the
    // reply already contains one ("nah just ask — it's 12 Smith St…").
    return fromNextStep(captureOpeningAddress(slots, inbound))
  }

  // (4) They were sent the form but are now texting — switch to Q&A.
  if (lastStep === 'await_form') {
    return fromNextStep(captureOpeningAddress(slots, inbound))
  }

  // (5) Warm 'quoted' thread — a quote was already sent. Only a fresh
  // painting enquiry reopens (re-offering the form); anything else is
  // handed back to the general dialog (never trapped, never re-quoted).
  if (lastStep === 'quoted') {
    if (!looksLikePaintingEnquiry(inbound)) return { action: 'passthrough', slots }
    return { action: 'offer_form', slots: {} }
  }

  // (6) Opener / closed — offer the form FIRST when this reads like a
  // painting enquiry. (The route only routes painting messages here, but
  // guard anyway.)
  if (lastStep === null || lastStep === 'closed') {
    if (looksLikePaintingEnquiry(inbound)) return { action: 'offer_form', slots: {} }
    return { action: 'passthrough', slots }
  }

  // (7) Gathering inputs — fold the answer into the step we last asked.
  if (ANSWERABLE_STEPS.has(lastStep)) {
    slots = applyPaintingAnswer(slots, lastStep, inbound)
    // An address answer that didn't parse → clarify, don't store junk.
    if (lastStep === 'address' && !slots.address) {
      return { action: 'ask', slots, step: 'address', reply: ADDRESS_RETRY }
    }
  }

  return fromNextStep(slots)
}

/**
 * PURE — the painting_state to persist after a turn. The route augments
 * the 'offer_form' result with the minted form token and the 'estimate'
 * result with the saved quote token (it owns those).
 *   offer_form → park at offer_form
 *   await_form → park at await_form
 *   ask        → park at the asked step
 *   estimate   → quoted (route may override to await_booking if the
 *                estimate itself routes to inspection)
 *   inspection → await_booking (waiting for "yes, book it")
 *   booking    → closed
 *   cancel     → closed
 *   passthrough→ stays quoted (route returns false; no persist)
 */
export function nextPaintingConversationState(
  decision: PaintingTurnDecision,
): PaintingConversationState {
  switch (decision.action) {
    case 'offer_form':
      return { slots: decision.slots, last_step: 'offer_form' }
    case 'await_form':
      return { slots: decision.slots, last_step: 'await_form' }
    case 'ask':
      return { slots: decision.slots, last_step: decision.step }
    case 'estimate':
      return { slots: decision.slots, last_step: 'quoted' }
    case 'inspection':
      return { slots: decision.slots, last_step: 'await_booking' }
    case 'passthrough':
      return { slots: decision.slots, last_step: 'quoted' }
    case 'cancel':
    case 'booking':
      return { slots: decision.slots, last_step: 'closed', pending_form_token: null, pending_quote_token: null }
  }
}

/** PURE — is this an ACTIVE painting flow (mid-gather or awaiting a reply),
 *  as opposed to closed/empty? The route uses this to decide whether to
 *  keep handling the thread as painting. */
export function isActivePaintingFlow(prev: PaintingConversationState | null | undefined): boolean {
  if (!prev || !prev.slots) return false
  const step = prev.last_step ?? null
  return step !== null && step !== 'closed'
}
