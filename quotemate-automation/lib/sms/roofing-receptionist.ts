// ════════════════════════════════════════════════════════════════════
// SMS roofing receptionist — pure per-turn decision.
//
// Given the conversation's persisted roofing state (gathered slots, the
// step we last asked about, any pending measured quote awaiting
// confirmation) plus the customer's new message, decide the turn:
//   • cancel     — customer asked to stop / cancel (checked FIRST).
//   • ask        — fold the answer in, send the next question.
//   • measure    — enough gathered → run measureAndPriceRoofs, then send
//                  the roof image link and ask "is this your roof?".
//   • inspection — gathered but material/pitch forces an on-site visit.
//   • send_saved — customer confirmed the building → send the saved quote
//                  (optionally for one picked structure). Terminal.
//   • reconfirm  — reply to the photo wasn't clear → re-ask.
//   • booking    — reply to "shall we book the inspection?". Terminal.
//
// Once a flow is closed (quote sent / cancelled / booked), an unrelated
// message never re-quotes; only a fresh roofing enquiry reopens it.
//
// The route does the I/O (measure, persist, SMS); this module is pure so
// the conversation logic is fully unit-tested.
// ════════════════════════════════════════════════════════════════════

import {
  applyRoofingAnswer,
  isAffirmative,
  isNegative,
  isStopRequest,
  looksLikeRoofingEnquiry,
  mapIntent,
  nextRoofingStep,
  parseYearBuilt,
  type RoofingSlots,
  type RoofingStep,
} from './roofing-intake'

/** Persisted on sms_conversations.roofing_state (jsonb). */
export type RoofingConversationState = {
  slots: RoofingSlots
  /** The step we asked the customer about last turn (null on the opener). */
  last_step?: RoofingStep | null
  /** Token of the saved roofing_measurements row awaiting confirmation. */
  pending_quote_token?: string | null
  /** How many structures were measured (so a numbered pick can be validated). */
  pending_structure_count?: number | null
  /** 1-based indices already sent to the customer (so "the others" can
   *  compute the complement on a warm 'quoted' thread). */
  last_served_structures?: number[] | null
}

const ANSWERABLE_STEPS: ReadonlySet<RoofingStep> = new Set<RoofingStep>([
  'address',
  'confirm_address',
  'intent',
  'material',
  'pitch',
])

export type RoofingTurnDecision =
  | { action: 'ask'; slots: RoofingSlots; step: RoofingStep; reply: string }
  | { action: 'measure'; slots: RoofingSlots }
  | { action: 'inspection'; slots: RoofingSlots; reason: string }
  // Serve the SAVED measurement for these 1-based structures (null = all).
  | { action: 'send_saved'; slots: RoofingSlots; structureChoices: number[] | null }
  | { action: 'reconfirm'; slots: RoofingSlots }
  | { action: 'cancel'; slots: RoofingSlots }
  | { action: 'booking'; slots: RoofingSlots; confirmed: boolean }
  // A warm 'quoted' thread got a message that is NOT a structure follow-up,
  // a stop, or a fresh roofing enquiry — hand it back to the general dialog
  // (the route returns false) so a new electrical/plumbing question is
  // handled normally instead of being trapped in roofing.
  | { action: 'passthrough'; slots: RoofingSlots }

const WRONG_BUILDING_REPROMPT =
  "No worries. What's the correct property address, with suburb and postcode?"
const ADDRESS_RETRY =
  "Sorry, I didn't catch a property address there. What's the address? Please include the street number, suburb and postcode."

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 }

/**
 * PURE — parse a structure pick from the customer's reply (1-based),
 * validated against the number of structures offered. Accepts a bare
 * number ("2"), "#2", "number 2", or an ordinal ("the second"). Returns
 * null when there's no valid pick.
 */
export function parseStructureChoice(inbound: string, count: number): number | null {
  const t = (inbound ?? '').toLowerCase()
  for (const [word, n] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(t) && n <= count) return n
  }
  const m = t.match(/\b#?(\d{1,2})\b/)
  if (m) {
    const n = Number(m[1])
    if (n >= 1 && n <= count) return n
  }
  return null
}

// Words that, after the pick tokens are removed, are "filler" — their
// presence doesn't make a message anything other than a structure pick.
const FOLLOWUP_FILLER =
  /\b(and|the|a|an|number|numbers|no|nos|just|only|please|pls|thanks|thx|ta|too|one|ones|of|me|my|give|send|do|it|its|yes|yep|ok|okay|okey|sure|for|i|id|want|wanna|need|can|could|would|you|get|us|actually|quote|quotes|breakdown|breakdowns|estimate|estimates|pricing|price|prices|about|what|hey|hi|see|show|them|those|these|also)\b/g
// Tokens that ARE a structure pick (numbers, ordinals, building words).
const PICK_TOKENS =
  /#?\d{1,2}|\b(first|second|third|fourth|fifth|all|both|everything|every|others?|rest|remaining|lot|buildings?|structures?|shed|garage|granny|flat|carport|outbuilding|dwelling)\b/g
// A clear structure/roof cue — makes any number a roofing pick even in a
// longer sentence ("give me breakdown for building 2 and 3").
const STRUCTURE_CUE =
  /\b(building|buildings|structure|structures|shed|garage|granny|carport|outbuilding|dwelling|breakdown|re-?roof|roofs?)\b/

/**
 * PURE — parse a MULTI-structure follow-up on a warm 'quoted' thread.
 * Returns 'all' (every structure), an array of 1-based indices, or null
 * when the message isn't a structure ask. `alreadyServed` lets "the
 * others / the rest" compute the complement of what was already sent.
 *
 * CONSERVATIVE on purpose: a bare number / quantifier is only treated as a
 * pick when the message is EITHER a "pure pick" (only pick tokens + filler
 * remain) OR carries an explicit structure cue. So "2 and 3" / "the others"
 * / "both" are picks, but "call me at 2" / "I have 2 dogs" / "both lights
 * please" are NOT — they pass through to the general dialog. This is what
 * stops a warm roofing thread from hijacking an unrelated reply.
 *   • "all" / "all of them" / "everything" / "both" → 'all'
 *   • "the others" / "the rest" / "remaining"       → complement
 *   • "2 and 3" / "2, 3" / "#2 #3" / "second and third" → [2,3]
 *   • "the shed" / "garage" (when >1 structure)     → secondary indices
 */
export function parseStructureFollowup(
  inbound: string,
  count: number,
  alreadyServed?: number[] | null,
): number[] | 'all' | null {
  const t = (inbound ?? '').toLowerCase().trim()
  if (!t || count < 1) return null

  // Gate: a clear structure cue, OR the message is essentially JUST a pick
  // (nothing left after removing pick tokens + filler + punctuation).
  const hasCue = STRUCTURE_CUE.test(t)
  const residue = t
    .replace(PICK_TOKENS, ' ')
    .replace(FOLLOWUP_FILLER, ' ')
    .replace(/[^a-z]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const isPurePick = residue.length === 0
  if (!hasCue && !isPurePick) return null

  // "all" — bare "all"/"everything"/"both" are safe here because the gate
  // already rejected sentences with other content ("all good thanks").
  if (/\b(all|all of them|all of it|all of the|everything|all the buildings|all structures|both of them|both buildings|both)\b/.test(t)) {
    return 'all'
  }

  if (/\b(the others?|the rest|remaining|other ones?|other buildings?)\b/.test(t)) {
    const served = new Set(alreadyServed ?? [])
    const rest: number[] = []
    for (let i = 1; i <= count; i++) if (!served.has(i)) rest.push(i)
    return rest.length > 0 ? rest : null
  }

  const nums = new Set<number>()
  for (const mm of t.matchAll(/#?(\d{1,2})/g)) {
    const n = Number(mm[1])
    if (n >= 1 && n <= count) nums.add(n)
  }
  for (const [word, n] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(t) && n <= count) nums.add(n)
  }
  if (nums.size > 0) return [...nums].sort((a, b) => a - b)

  // A bare "shed" / "garage" maps to the secondary structures (2..count).
  if (count > 1 && /\b(shed|garage|granny flat|secondary|outbuilding|carport)\b/.test(t)) {
    const secondary: number[] = []
    for (let i = 2; i <= count; i++) secondary.push(i)
    return secondary
  }

  return null
}

/**
 * PURE — advance the roofing conversation one turn.
 */
export function advanceRoofing(
  prev: RoofingConversationState | null | undefined,
  inbound: string,
): RoofingTurnDecision {
  const rawLastStep = prev?.last_step ?? null
  let slots: RoofingSlots = { ...(prev?.slots ?? {}) }

  // (1) Stop / cancel / opt-out — always honoured first, at any step.
  if (isStopRequest(inbound)) {
    return { action: 'cancel', slots }
  }

  // (2) Awaiting "shall we book the inspection?".
  if (rawLastStep === 'await_booking') {
    return { action: 'booking', slots, confirmed: isAffirmative(inbound) && !isNegative(inbound) }
  }

  // (3) Confirmation: replying to "is this your roof?".
  if (rawLastStep === 'confirm_roof') {
    const count = prev?.pending_structure_count ?? 1
    if (isNegative(inbound)) {
      const reset: RoofingSlots = {
        ...slots,
        address: null,
        postcode: null,
        state: null,
        address_confirmed: false,
      }
      return { action: 'ask', slots: reset, step: 'address', reply: WRONG_BUILDING_REPROMPT }
    }
    const choice = parseStructureChoice(inbound, count)
    if (choice != null && count > 1) {
      return { action: 'send_saved', slots, structureChoices: [choice] }
    }
    // The confirm prompt offers "all" (and the page says so) — accept it.
    if (count > 1 && parseStructureFollowup(inbound, count) === 'all') {
      return { action: 'send_saved', slots, structureChoices: null }
    }
    if (isAffirmative(inbound)) {
      return { action: 'send_saved', slots, structureChoices: null }
    }
    return { action: 'reconfirm', slots }
  }

  // (3.5) Warm 'quoted' thread — a quote was already sent. A structure
  // follow-up ("give me 2 and 3", "the others", "all of them") re-serves
  // the SAVED measurement; a fresh roofing enquiry reopens; anything else
  // is handed back to the general dialog (never trapped, never re-quoted).
  if (rawLastStep === 'quoted') {
    const count = prev?.pending_structure_count ?? 1
    const picks = parseStructureFollowup(inbound, count, prev?.last_served_structures ?? null)
    if (picks === 'all') return { action: 'send_saved', slots, structureChoices: null }
    if (picks && picks.length > 0) return { action: 'send_saved', slots, structureChoices: picks }
    // Not a structure ask. Only a clear NEW roofing enquiry reopens the
    // flow; everything else goes back to the general dialog.
    if (!looksLikeRoofingEnquiry(inbound)) return { action: 'passthrough', slots }
    // falls through to the reset below → gather a fresh roofing quote.
  }

  // (4) Closed/quoted flow — a fresh enquiry restarts from scratch.
  let lastStep: RoofingStep | null = rawLastStep
  if (rawLastStep === 'closed' || rawLastStep === 'quoted') {
    slots = {}
    lastStep = null
  }

  // (5) Gathering inputs.
  let nextSlots = slots
  if (lastStep && ANSWERABLE_STEPS.has(lastStep)) {
    nextSlots = applyRoofingAnswer(slots, lastStep, inbound)
    // An address answer that didn't parse as an address → clarify, don't
    // store junk (and don't silently re-send the same prompt).
    if (lastStep === 'address' && !nextSlots.address) {
      return { action: 'ask', slots: nextSlots, step: 'address', reply: ADDRESS_RETRY }
    }
  } else {
    if (!nextSlots.intent) {
      const intent = mapIntent(inbound)
      if (intent) nextSlots.intent = intent
    }
    if (nextSlots.year_built == null) {
      const y = parseYearBuilt(inbound)
      if (y != null) nextSlots.year_built = y
    }
  }

  const next = nextRoofingStep(nextSlots)
  if (next.step === 'ready') return { action: 'measure', slots: nextSlots }
  if (next.step === 'inspection') {
    return { action: 'inspection', slots: nextSlots, reason: next.reason ?? 'on-site inspection required' }
  }
  return { action: 'ask', slots: nextSlots, step: next.step, reply: next.question ?? '' }
}

/**
 * PURE — the roofing_state to persist after a turn. The route augments
 * the 'measure' result with the saved quote token + structure count (it
 * owns those), and preserves them on 'reconfirm'.
 *   ask        → park at the asked step
 *   measure    → park at confirm_roof
 *   reconfirm  → stay at confirm_roof
 *   inspection → park at await_booking (waiting for "yes book it")
 *   send_saved → quoted (WARM — a structure follow-up re-serves the saved
 *                measurement; the route preserves pending_quote_token +
 *                pending_structure_count, which this pure fn doesn't own)
 *   passthrough→ stays quoted (route returns false; no persist)
 *   cancel     → closed
 *   booking    → closed
 */
export function nextRoofingConversationState(
  decision: RoofingTurnDecision,
): RoofingConversationState {
  switch (decision.action) {
    case 'ask':
      return { slots: decision.slots, last_step: decision.step, pending_quote_token: null, pending_structure_count: null }
    case 'measure':
    case 'reconfirm':
      return { slots: decision.slots, last_step: 'confirm_roof' }
    case 'inspection':
      return { slots: decision.slots, last_step: 'await_booking', pending_quote_token: null, pending_structure_count: null }
    case 'send_saved':
      return { slots: decision.slots, last_step: 'quoted', last_served_structures: decision.structureChoices }
    case 'passthrough':
      return { slots: decision.slots, last_step: 'quoted' }
    case 'cancel':
    case 'booking':
      return { slots: decision.slots, last_step: 'closed', pending_quote_token: null, pending_structure_count: null }
  }
}

/** PURE — is this conversation an ACTIVE roofing flow (mid-gather or
 *  awaiting a reply), as opposed to closed/empty? The route uses this to
 *  decide whether to keep handling the thread as roofing. */
export function isActiveRoofingFlow(prev: RoofingConversationState | null | undefined): boolean {
  if (!prev || !prev.slots) return false
  const step = prev.last_step ?? null
  return step !== null && step !== 'closed'
}
