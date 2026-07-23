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
  extractStreetAddress,
  isAffirmative,
  isAmbiguousMetal,
  isNegative,
  isStopRequest,
  looksLikeRoofingEnquiry,
  mapIntent,
  mapMaterial,
  nextRoofingStep,
  parseAuState,
  parsePostcode,
  parseYearBuilt,
  type RoofingSlots,
  type RoofingStep,
} from './roofing-intake'

/** Persisted on sms_conversations.roofing_state (jsonb). */
export type RoofingConversationState = {
  slots: RoofingSlots
  /** The step we asked the customer about last turn (null on the opener). */
  last_step?: RoofingStep | null
  /** Token of the saved roofing_measurements row this thread is parked on:
   *  awaiting the roof confirmation (confirm_roof), warm after a quote
   *  (quoted), or awaiting the booking reply (await_booking — kept since
   *  US-002 so the booking-confirm tradie notify can link the saved
   *  measurement). */
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
  'material_profile',
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
  // The list we sent NAMES each building ("1) Main dwelling", "2) Secondary
  // structure 1"), so read those names back before falling to digits —
  // otherwise "Main dwelling" is unrecognised and we re-send the same list.
  // Checked first: "secondary structure 1" contains a digit that means
  // something different from a bare "1".
  const secondary = t.match(/secondary\s*(?:structure|building)?\s*#?(\d{1,2})/)
  if (secondary) {
    const n = Number(secondary[1]) + 1 // "secondary structure 1" is entry 2
    if (n >= 1 && n <= count) return n
  }
  // Bare "main" counts as a pick — the list we sent literally says
  // "1) Main dwelling" (live 2026-07-23: "Main" re-sent the identical
  // list). The lookahead keeps street names out: "the one on Main Road"
  // is an address correction, not a pick.
  if (/\bmain\b(?!\s*(?:st\b|street|rd\b|road|ave\b|av\b|avenue|dr\b|drive|hwy\b|highway|pde\b|parade|ln\b|lane|ct\b|court|cres\b|crescent|pl\b|place))/.test(t)) {
    return 1
  }
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

/** How many unrecognised answers a step gets before we stop asking and
 *  route to the on-site inspection. Address gets one extra go: it's the
 *  one answer the customer can always fix by retyping, and the retry
 *  prompt spells out exactly what's needed. */
function missBudget(step: RoofingStep): number {
  return step === 'address' ? 3 : 2
}

/** PURE — did the customer's answer actually land in the slot we asked
 *  about? A 'no' at confirm_address counts as landed: it's understood, and
 *  it clears the address so we re-ask for a new one. */
function answerLanded(before: RoofingSlots, after: RoofingSlots, step: RoofingStep): boolean {
  switch (step) {
    case 'address':
      return !!after.address
    case 'confirm_address':
      // A correction (new address) or a bare postcode is understood too —
      // it just isn't a "yes". Counting those as misses would spend the
      // budget while the customer is actively fixing the address.
      return (
        after.address_confirmed === true ||
        !after.address ||
        after.address !== before.address ||
        after.postcode !== before.postcode
      )
    case 'intent':
      return !!after.intent
    case 'material':
      // "It's Colorbond" landed even though it named no profile — we now ask
      // WHICH. Counting it as a miss would burn the budget on an answer we
      // actually understood.
      return !!after.material || after.metal_hint === true
    case 'material_profile':
      // Always resolves: a named profile, or 'unknown' → inspection.
      return !!after.material
    case 'pitch':
      return !!after.pitch
    default:
      return true
  }
}

/**
 * PURE — the structures to PERSIST as the confirmed selection when a quote
 * is sent. `null` choices mean the customer took all of them.
 *
 * This must be written to roofing_measurements.included_indices, not left
 * to the `?s=` link: resolveEffectiveIndices only ever NARROWS, falling
 * back to the main-dwelling-only default when included_indices is NULL, so
 * a bare link cannot express "all". Live 2026-07-22: a customer replied
 * YES to 3 buildings, the SMS quoted 2 of them at $115,117, and the linked
 * page showed the main dwelling alone at $69,652.
 */
export function confirmedIncludedIndices(
  structureChoices: number[] | null,
  totalStructures: number,
): number[] {
  if (structureChoices && structureChoices.length > 0) return [...structureChoices]
  return Array.from({ length: Math.max(0, totalStructures) }, (_, i) => i + 1)
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
    // Only an explicit decline closes the thread without notifying the
    // tradie. A question ("what does it cost?"), a proposed time ("Tuesday
    // works"), or anything unclear is a LIVE inspection lead — confirm it
    // so the tradie is notified and a human follows up. The old
    // `isAffirmative && !isNegative` dropped every non-"yes" reply with a
    // dismissive "text us whenever" and no notify (audit 2026-07-23).
    // isStopRequest is handled above, so a genuine opt-out never lands here.
    return { action: 'booking', slots, confirmed: !isNegative(inbound) }
  }

  // (3) Confirmation: replying to "is this your roof?".
  let restartFromConfirm = false
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
    // A CLEAR new address (street number + postcode) means the customer moved
    // to a DIFFERENT property — restart the gather instead of replaying "is
    // this your roof?" for the old measurement. Live 2026-07-24: a confirm_roof
    // reused from a previous session replayed its "3 buildings at 670 London
    // Road" list on a brand-new address. Checked BEFORE the pick parser so
    // "2 Smith St … 2026" isn't misread as structure 2; the postcode
    // requirement keeps a multi-pick ("2 and 3") and an affirmation with a
    // stray number ("yes, built 1990") OUT of the restart. After isNegative so
    // a plain "no" still re-asks.
    const newAddress = !!extractStreetAddress(inbound) && !!parsePostcode(inbound)
    if (newAddress) {
      restartFromConfirm = true
    } else {
      // MULTI-pick first, but ONLY when it names ≥2 structures: "2 and 3"
      // must serve both. The single-pick parser's digit regex grabs the
      // FIRST number, so running it first silently narrowed "2 and 3" to
      // structure 2 — the customer read the price as covering two buildings
      // (money bug, same class as the 2026-07-22 included_indices fix; the
      // warm 'quoted' step below already parsed multi-picks correctly).
      // Single-result parses still fall through to parseStructureChoice,
      // which alone knows "secondary structure 1" means ENTRY 2.
      const multi = parseStructureFollowup(inbound, count)
      if (count > 1 && Array.isArray(multi) && multi.length > 1) {
        return { action: 'send_saved', slots, structureChoices: multi }
      }
      const choice = parseStructureChoice(inbound, count)
      if (choice != null && count > 1) {
        return { action: 'send_saved', slots, structureChoices: [choice] }
      }
      // The confirm prompt offers "all" (and the page says so) — accept it.
      if (count > 1 && multi === 'all') {
        return { action: 'send_saved', slots, structureChoices: null }
      }
      // An affirmation WINS over a roofing keyword: "yeah do the re-roof" is a
      // YES, not a request to start over — serve the saved measurement.
      if (isAffirmative(inbound)) {
        return { action: 'send_saved', slots, structureChoices: null }
      }
      // Only now, once yes / picks have had their say, does a fresh roofing
      // enquiry with no postcode ("quote a new roof at 5 Green St") restart —
      // a keyword the confirm step would otherwise replay over.
      if (looksLikeRoofingEnquiry(inbound)) {
        restartFromConfirm = true
      } else {
        return { action: 'reconfirm', slots }
      }
    }
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

  // (4) Closed/quoted flow — a fresh enquiry restarts from scratch. A
  // confirm_roof the customer abandoned for a new property (restartFromConfirm)
  // resets here too, then falls into the opener-harvest below.
  let lastStep: RoofingStep | null = rawLastStep
  if (rawLastStep === 'closed' || rawLastStep === 'quoted' || restartFromConfirm) {
    slots = {}
    lastStep = null
  }

  // (5) Gathering inputs.
  let nextSlots = slots
  if (lastStep && ANSWERABLE_STEPS.has(lastStep)) {
    nextSlots = applyRoofingAnswer(slots, lastStep, inbound)

    if (answerLanded(slots, nextSlots, lastStep)) {
      // Understood — clear the counter so misses never accumulate across
      // steps (one bad material answer must not shorten the pitch budget).
      delete nextSlots.misses
    } else {
      // NOT understood. Re-asking the identical question forever is how
      // this flow used to dead-end ("iron", "25 degrees", "the brown
      // stuff" all mapped to nothing). Give the customer a bounded number
      // of goes, then fall back to the on-site inspection — the same safe
      // failure mode the rest of QuoteMax uses when it can't price.
      const misses = (slots.misses ?? 0) + 1
      if (misses >= missBudget(lastStep)) {
        delete nextSlots.misses
        // For the three slots that HAVE an 'unknown' sentinel, set it and
        // let the existing gates in nextRoofingStep route to inspection.
        if (lastStep === 'material') nextSlots.material = 'unknown'
        else if (lastStep === 'pitch') nextSlots.pitch = 'unknown'
        else if (lastStep === 'intent') nextSlots.intent = 'unknown'
        // Address is different: with no usable address there is nothing to
        // measure AND nothing to put on a job sheet, so hand the lead to
        // the tradie directly rather than pretending we can quote it.
        else {
          return {
            action: 'inspection',
            slots: nextSlots,
            reason: "we couldn't confirm the property address",
          }
        }
      } else {
        nextSlots = { ...nextSlots, misses }
        // An address answer that didn't parse as an address → clarify, don't
        // store junk (and don't silently re-send the same prompt).
        if (lastStep === 'address') {
          return { action: 'ask', slots: nextSlots, step: 'address', reply: ADDRESS_RETRY }
        }
      }
    }
  } else {
    // ── Harvest the OPENING message ──────────────────────────────────
    // We are not answering a question we asked, so read whatever the
    // customer volunteered. This branch used to take only the intent and
    // the build year, which is why an address given up front was asked
    // for a second time. Observed live (tenant "Ricardos Roofing"):
    //   CUSTOMER: "I am looking to get a new roof at 670 London road Chandler"
    //   BOT:      "Happy to sort a roofing quote for you. What's the
    //              property address, including suburb and postcode?"
    // Everything harvested here is still READ BACK once for confirmation
    // (address_confirmed stays false), so a mis-parse costs one "no",
    // never a wrong quote.
    if (!nextSlots.intent) {
      const intent = mapIntent(inbound)
      if (intent) nextSlots.intent = intent
    }
    if (!nextSlots.address) {
      const addr = extractStreetAddress(inbound)
      if (addr) {
        nextSlots.address = addr
        const pc = parsePostcode(inbound)
        if (pc) nextSlots.postcode = pc
        const st = parseAuState(inbound)
        if (st) nextSlots.state = st
        nextSlots.address_confirmed = false
      }
    }
    if (!nextSlots.material) {
      // Only a POSITIVE match counts. mapMaterial returns null for a bare
      // "Colorbond"/"metal" (profile unknown) and we mirror the material
      // step by recording the hint instead, so the profile question is
      // asked rather than a profile being guessed.
      const m = mapMaterial(inbound)
      if (m) nextSlots.material = m
      else if (isAmbiguousMetal(inbound)) nextSlots.metal_hint = true
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
 *   inspection → park at await_booking (waiting for "yes book it").
 *                NOTE: this pure arm nulls pending_quote_token because the
 *                decision doesn't carry it; the ROUTE persists its own
 *                explicit state for the measure-path inspection park and
 *                KEEPS the token there (US-002 booking-notify link) — same
 *                route-owned-state carve-out as send_saved below.
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

/** Idle beyond this and a parked roofing flow is stale. The route reuses a
 *  conversation for up to REUSE_OPEN_WINDOW_MS (4h); expiring the roofing flow
 *  at 1h means a customer who walked away starts fresh next time instead of
 *  resuming a measurement from a PREVIOUS session. Live 2026-07-24: a
 *  confirm_roof reused hours later replayed "3 buildings at 670 London Road"
 *  on the next "Hi Mate", then again on a new address, then on "Hey". */
export const ROOFING_STALE_IDLE_MS = 60 * 60 * 1000

/** ONLY these steps REPLAY a saved measurement on resume, so ONLY these go
 *  stale: confirm_roof re-sends "is this your roof? N buildings…", and the
 *  warm 'quoted' thread re-serves the saved quote on a structure follow-up.
 *  await_booking / await_form / mid-gather do NOT replay — resuming them is
 *  correct, and expiring await_booking would DROP a genuine late "yes book
 *  it" (no booking, no tradie notify), undoing the 2026-07-23 lead-safety
 *  hardening. So they are deliberately excluded. */
const ROOFING_STALE_REPLAY_STEPS: ReadonlySet<RoofingStep> = new Set<RoofingStep>([
  'confirm_roof',
  'quoted',
])

/** PURE — a roofing flow parked on a stale-replay step (confirm_roof / quoted)
 *  and idle for longer than ROOFING_STALE_IDLE_MS is stale: return the closed
 *  state to persist (so the route handles the new message fresh), or null when
 *  there's nothing to expire (a non-replay step, closed/empty, or still within
 *  the window). `idleMs` is the age of the conversation's last activity,
 *  supplied by the route. Mirrors closeStaleRoofingState's closed shape. */
export function expireIdleRoofingState(
  prev: RoofingConversationState | null | undefined,
  idleMs: number,
): RoofingConversationState | null {
  const step = prev?.last_step ?? null
  if (!step || !ROOFING_STALE_REPLAY_STEPS.has(step)) return null
  if (idleMs < ROOFING_STALE_IDLE_MS) return null
  return {
    slots: {},
    last_step: 'closed',
    pending_quote_token: null,
    pending_structure_count: null,
  }
}

/** PURE — US-006: the tenant just turned roofing OFF while this thread was
 *  mid-flow. Return the closed state to persist, or null when there's
 *  nothing to close. Without this, a conversation parked at confirm_roof /
 *  await_booking was orphaned: the general dialog inherited a warm
 *  roofing_state it cannot speak to, and re-enabling roofing later resumed
 *  a zombie flow (audit 2026-07-23). */
export function closeStaleRoofingState(
  prev: RoofingConversationState | null | undefined,
): RoofingConversationState | null {
  if (!isActiveRoofingFlow(prev)) return null
  return {
    slots: {},
    last_step: 'closed',
    pending_quote_token: null,
    pending_structure_count: null,
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

/** PURE — should the roofing receptionist engage this turn?
 *
 *  Normally it engages when the thread is already an active roofing flow
 *  (mid-gather / awaiting a reply) OR the inbound reads like a fresh roofing
 *  enquiry. But when a follow-up pin is active on the thread — the tradie
 *  just chased a DIFFERENT quote (e.g. Ceiling Fans) — a stale roofing_state
 *  left on the shared phone thread must NOT resume: an affirmative reply to
 *  the follow-up ("Yes") would otherwise be hijacked into "how steep is the
 *  roof?". With a pin active, only a genuinely NEW roofing enquiry may
 *  engage; a stale-state resume falls through to the general dialog, which
 *  honours the pin. (Spec 2026-07-05 Part A2.) */
export function shouldEngageRoofing(
  prev: RoofingConversationState | null | undefined,
  inbound: string,
  followupPinActive: boolean,
  /** This tenant does roofing and NOTHING else (trades === ['roofing']).
   *  See the note below — for these tenants the keyword test is skipped. */
  roofingOnly = false,
): boolean {
  const canResume = isActiveRoofingFlow(prev) && !followupPinActive
  if (canResume) return true
  if (looksLikeRoofingEnquiry(inbound)) return true
  // SINGLE-TRADE ROOFING TENANT — no keyword required.
  //
  // The keyword test exists to ROUTE BETWEEN trades on a cross-trade
  // tenant (Atomic Electrical does electrical + roofing, so "the downlight
  // flickers" must reach the electrical dialog). A roofing-only tenant has
  // nothing to route to: every customer who texts them wants a roof
  // quoted, and the only other handler is the electrical/plumbing dialog,
  // which will happily start an electrical intake for a roofing company.
  //
  // Observed live: "Bills roofing" (trades = ['roofing']) received "test
  // from owner" and the general dialog answered it. No keyword, so no
  // roofing receptionist, so no measurement — for a business that does
  // nothing but roofs. Openers like "hi", "how much for my place?" or "can
  // you help?" fail the same way.
  //
  // The pin still wins: if the tradie just chased a different quote on this
  // thread, let the general dialog honour it.
  return roofingOnly && !followupPinActive
}
