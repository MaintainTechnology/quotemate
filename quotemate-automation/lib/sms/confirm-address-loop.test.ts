// ════════════════════════════════════════════════════════════════════
// specs/address-confirm-loop.md — the address read-back must never loop.
//
// Live 2026-08-07 (QM Sparky, Jeff, 12 Smith St). Four different inbound
// messages, two of them unambiguous rejections, every one answered with the
// byte-identical read-back:
//
//   BOT  | Just to confirm, the property is "12 Smith St, …". Is that right?
//   CUST | No                            → same read-back
//   CUST | Hi Mate                       → same read-back
//   CUST | No, I want to do a roofing please → same read-back
//   CUST | No!                           → same read-back
//
// The state when it happened: roofing_state.last_step = 'closed',
// slots.address_confirmed = true, addr_verified set. NEITHER step machine was
// at confirm_address, so every consumer of a rejection keyed on
// `last_step === 'confirm_address'` was dead code and MAX_ADDRESS_VERIFY_REJECTS
// — which only ever bounded GEOCODER rejections — never fired.
//
// This is the monolith copy of qm-roofing-receptionist's confirm-address.check.
// The fix is duplicated across four carve-out services and here; this file is
// what stops a carve-out regeneration silently reverting it.
// ════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest'
import {
  advanceRoofing,
  nextRoofingConversationState,
  type RoofingConversationState,
  type RoofingTurnDecision,
} from './roofing-receptionist'
import {
  advancePainting,
  nextPaintingConversationState,
  type PaintingConversationState,
  type PaintingTurnDecision,
} from './painting-receptionist'
import { isAffirmative, isNegative } from './roofing-intake'
import {
  MAX_ADDRESS_VERIFY_REJECTS,
  addressHandoffReply,
  addressRecheckQuestion,
  confirmAddressQuestion,
  consumeAddressMiss,
  consumeAddressRejection,
  lastOutboundAskedAddress,
  type AddressSlotsLike,
} from './verify-address'
import { dedupeConsecutiveReply } from './send-reliability'
import { paintingTurnViaLlm, roofingTurnViaLlm, type LlmDecider } from './llm-receptionist'

const ADDR_A = '12 Smith St, Surry Hills NSW 2010'
const ADDR_B = '14 Smith St, Surry Hills NSW 2010'
const READ_BACK_A = confirmAddressQuestion(ADDR_A, false)

/** The text the customer would actually receive. Non-ask actions are composed
 *  by the route, so they are named rather than quoted. */
function said(d: RoofingTurnDecision): string {
  return d.action === 'ask' ? d.reply : `<${d.action}>`
}

/** Replay a transcript through the pure machine exactly as the route does:
 *  decide, send the reply, persist the next state, repeat. */
function replay(start: RoofingConversationState, inbounds: string[]): string[] {
  let state = start
  const out: string[] = []
  for (const msg of inbounds) {
    const d = advanceRoofing(state, msg)
    out.push(said(d))
    state = nextRoofingConversationState(d) as RoofingConversationState
  }
  return out
}

/** The handshake as it stands when the read-back has just gone out. */
const AWAITING_CONFIRM: RoofingConversationState = {
  slots: {
    address: ADDR_A,
    postcode: '2010',
    state: 'NSW',
    intent: 'full_reroof',
    material: 'colorbond_corrugated',
    pitch: 'standard',
    address_confirmed: false,
    addr_verified: ADDR_A,
  },
  last_step: 'confirm_address',
}

describe('elongated emphasis is still a yes / no', () => {
  it.each(['No', 'NO', 'Noooo', 'noooooo', 'nahhh', 'nope', 'Nooo mate'])(
    'isNegative(%j)',
    (n) => {
      expect(isNegative(n)).toBe(true)
    },
  )

  it.each(['Yes', 'YES', 'yesss', 'yeahhh', 'yep'])('isAffirmative(%j)', (y) => {
    expect(isAffirmative(y)).toBe(true)
  })

  // Ordinary doubled letters must NOT be mangled into a false match.
  it.each(['the address is correct', 'all good', 'Bell St', 'Cottesloe'])(
    'isNegative(%j) stays false',
    (t) => {
      expect(isNegative(t)).toBe(false)
    },
  )
})

describe('req 1 — a rejection is CONSUMED', () => {
  it.each(['No', 'No!', 'No, I want to do a roofing please', 'nope', 'wrong'])(
    '%j clears the verified address, counts one rejection, never re-emits the read-back',
    (msg) => {
      const d = advanceRoofing(AWAITING_CONFIRM, msg)
      expect(d.action).toBe('ask')
      expect(d.action === 'ask' && d.step).toBe('address')
      expect(d.slots.address).toBeFalsy()
      // addr_verified goes too: its whole job is to let screenConfirmAddress
      // SKIP the map check for that exact string, so leaving it behind
      // re-blesses the address the customer just refused.
      expect(d.slots.addr_verified).toBeFalsy()
      expect(d.slots.address_confirmed).not.toBe(true)
      expect(d.slots.addr_confirm_rejects).toBe(1)
      expect(said(d)).not.toBe(READ_BACK_A)
    },
  )

  // The rejection must NEVER reach a measurement — that is the money path.
  it.each(['No', 'NO', 'Noooo'])('%j never mints a measurement', (msg) => {
    const a = advanceRoofing(AWAITING_CONFIRM, msg).action
    expect(a).not.toBe('measure')
    expect(a).not.toBe('inspection')
  })

  it('a genuine confirmation still proceeds', () => {
    expect(advanceRoofing({ ...AWAITING_CONFIRM, slots: { ...AWAITING_CONFIRM.slots, address_confirmed: true } }, 'Yes').action).toBe(
      'measure',
    )
  })

  it('the same rejection at confirm_roof (the photo) asks for the correct address', () => {
    for (const msg of ['No', 'NO', 'Noooo']) {
      const d = advanceRoofing({ ...AWAITING_CONFIRM, last_step: 'confirm_roof' }, msg)
      expect(d.action === 'ask' && d.step).toBe('address')
    }
  })
})

describe('req 2 — the bound FIRES, and the count survives the turn', () => {
  it(`${MAX_ADDRESS_VERIFY_REJECTS} rejections hand off with addressHandoffReply()`, () => {
    const first = advanceRoofing(AWAITING_CONFIRM, 'No')
    expect(first.slots.addr_confirm_rejects).toBe(1)

    // The customer sends another address; we read it back; they reject again.
    const second = advanceRoofing(
      {
        slots: { ...first.slots, address: ADDR_B, address_confirmed: false },
        last_step: 'confirm_address',
      },
      'No',
    )
    expect(said(second)).toBe(addressHandoffReply(ADDR_B))
    // The handoff parks the thread for a human, it does not keep asking.
    expect(second.action === 'ask' && second.step).toBe('await_booking')
    expect(second.slots.addr_confirm_rejects).toBe(MAX_ADDRESS_VERIFY_REJECTS)
  })
})

describe('req 3 — a closed flow never re-enters verification', () => {
  const CLOSED: RoofingConversationState = {
    slots: { ...AWAITING_CONFIRM.slots, address_confirmed: true },
    last_step: 'closed',
  }
  it.each(['No', 'Hi Mate', 'No, I want to do a roofing please', 'No!'])(
    'closed flow does not restart the confirm handshake on %j',
    (msg) => {
      const d = advanceRoofing(CLOSED, msg)
      expect(d.action === 'ask' && d.step).not.toBe('confirm_address')
      expect(said(d)).not.toBe(READ_BACK_A)
    },
  )
})

describe('req 4 — an unparsed reply counts a miss, never repeats', () => {
  it('"Hi Mate" spends a miss and does not repeat the read-back verbatim', () => {
    const d = advanceRoofing(AWAITING_CONFIRM, 'Hi Mate')
    expect(said(d)).not.toBe(READ_BACK_A)
    expect(d.action).toBe('ask')
    expect(d.slots.misses).toBe(1)
  })

  it('past the miss budget it moves on rather than asking again', () => {
    const spent = advanceRoofing(
      { ...AWAITING_CONFIRM, slots: { ...AWAITING_CONFIRM.slots, misses: 1 } },
      'Hi Mate',
    )
    expect(spent.action).not.toBe('ask')
  })
})

describe('the incident transcript, replayed', () => {
  // Bot #1 is the read-back already on the wire (AWAITING_CONFIRM); the four
  // customer lines follow verbatim from the spec. The spec's assertion is that
  // bot #3 differs from bot #2 — "Hi Mate" cannot be answered with the same
  // words "No" was.
  const bots = [
    READ_BACK_A,
    ...replay(AWAITING_CONFIRM, ['No', 'Hi Mate', 'No, I want to do a roofing please', 'No!']),
  ]

  it('bot #3 differs from bot #2', () => {
    expect(bots[2]).not.toBe(bots[1])
  })

  it('no two consecutive replies are byte-identical', () => {
    for (let i = 1; i < bots.length; i++) expect(bots[i]).not.toBe(bots[i - 1])
  })

  it('the read-back is never sent again', () => {
    for (const b of bots.slice(1)) expect(b).not.toBe(READ_BACK_A)
  })
})

describe('the read-back is recognised from the TRANSCRIPT, not from last_step', () => {
  // This is the key every rejection consumer now uses. In the incident the
  // persisted step said 'closed' while the read-back was on the wire, so every
  // step-keyed guard was dead code.
  it('detects the read-back however stale last_step is', () => {
    expect(
      lastOutboundAskedAddress([
        { direction: 'inbound', body: 'hi' },
        { direction: 'outbound', body: READ_BACK_A },
      ]),
    ).toBe(true)
  })

  it('the suggestion wording counts as a read-back', () => {
    expect(
      lastOutboundAskedAddress([
        { direction: 'outbound', body: `I can't find "x" on the map. Did you mean "y"?` },
      ]),
    ).toBe(true)
  })

  it('an ordinary reply is not a read-back', () => {
    expect(
      lastOutboundAskedAddress([{ direction: 'outbound', body: 'Roughly how steep is the roof?' }]),
    ).toBe(false)
  })

  it('an INBOUND read-back echo does not count', () => {
    expect(
      lastOutboundAskedAddress([
        { direction: 'outbound', body: 'Roughly how steep is the roof?' },
        { direction: 'inbound', body: READ_BACK_A },
      ]),
    ).toBe(false)
  })
})

describe('the shared budget clears every trace of the rejected address', () => {
  it('drops addr_verified too, then fires on the configured rejection', () => {
    const r = consumeAddressRejection({
      address: ADDR_A,
      postcode: '2010',
      state: 'NSW' as const,
      address_confirmed: true,
      addr_verified: ADDR_A,
    })
    expect(r.slots.addr_verified).toBeNull()
    expect(r.slots.address).toBeNull()
    expect(r.slots.address_confirmed).toBe(false)
    expect(r.handoff).not.toBe(true)
    expect(r.step).toBe('address')

    const spent = consumeAddressRejection({ ...r.slots, address: ADDR_B })
    expect(spent.handoff).toBe(true)
    expect(spent.step).toBe('await_booking')
  })
})

describe('req 5 — the identical-consecutive-reply backstop', () => {
  it('a byte-identical repeat is never sent as-is, but nothing is dropped', () => {
    const same = dedupeConsecutiveReply(READ_BACK_A, READ_BACK_A)
    expect(same.repeated).toBe(true)
    expect(same.body).not.toBe(READ_BACK_A)
    expect(same.body).toContain(READ_BACK_A)
  })

  it('a different reply, and the first reply on a thread, are untouched', () => {
    expect(dedupeConsecutiveReply(READ_BACK_A, 'What is the address?')).toEqual({
      body: READ_BACK_A,
      repeated: false,
    })
    expect(dedupeConsecutiveReply(READ_BACK_A, null)).toEqual({
      body: READ_BACK_A,
      repeated: false,
    })
  })
})

describe("the LLM path, on the state the incident was actually in", () => {
  // last_step 'closed' with the read-back live on the wire. The model is faked
  // to do exactly what it did that day: pick a HELD-step tool and copy our own
  // read-back verbatim out of the history (assertGroundedReply licenses that —
  // our last 8 outbounds are authoritative by construction). Before the fix
  // every rejection consumer was keyed on last_step === 'confirm_address', so
  // all of them were dead code here and this reply went straight out.
  const history = [
    { direction: 'inbound', body: 'quote my roof at 12 Smith St, Surry Hills NSW 2010' },
    { direction: 'outbound', body: READ_BACK_A },
  ]
  const parrot: LlmDecider = async () => ({
    tool: 'answer_business_question',
    slots: {},
    reply_to_send: READ_BACK_A,
    booking_consent: 'unclear',
    declined_trade: null,
    structure_choices: null,
  })
  const facts = {
    business_name: 'QM Sparky',
    owner_first_name: 'Jeff',
    trades: ['roofing'],
    state: 'NSW',
  }
  const INCIDENT: RoofingConversationState = {
    slots: { ...AWAITING_CONFIRM.slots, address_confirmed: true },
    last_step: 'closed',
  }

  it.each(['No', 'No!', 'No, I want to do a roofing please'])(
    "%j is consumed even with last_step 'closed', and never re-emits the read-back",
    async (msg) => {
      const r = await roofingTurnViaLlm({
        prev: INCIDENT,
        inbound: msg,
        history,
        facts,
        decide: parrot,
      })
      const d = r.decision
      expect(d.action).toBe('ask')
      expect(d.slots.address).toBeFalsy()
      expect(d.slots.addr_confirm_rejects).toBe(1)
      expect(said(d)).not.toBe(READ_BACK_A)
    },
  )

  it('a rejection that CARRIES a correction keeps the new address instead of clearing it', async () => {
    const corrected = await roofingTurnViaLlm({
      prev: INCIDENT,
      inbound: `No, it's ${ADDR_B}`,
      history: [...history, { direction: 'inbound', body: `No, it's ${ADDR_B}` }],
      facts,
      decide: async () => ({
        tool: 'verify_address',
        slots: { address: ADDR_B, address_confirmed: false },
        reply_to_send: confirmAddressQuestion(ADDR_B, false),
        booking_consent: 'unclear',
        declined_trade: null,
        structure_choices: null,
      }),
    })
    expect(corrected.decision.slots.address).toBe(ADDR_B)
  })

  // req 4 on the DEFAULT path. The deterministic machine has counted this miss
  // since 2026-08-07; the LLM path — which is the one that runs — did not, so
  // "Hi Mate" got the byte-identical read-back with no budget spent.
  it.each(['Hi Mate', 'Howdy', 'mate'])(
    '%j spends the miss budget instead of repeating the read-back verbatim',
    async (msg) => {
      const r = await roofingTurnViaLlm({ prev: INCIDENT, inbound: msg, history, facts, decide: parrot })
      const d = r.decision
      expect(said(d)).not.toBe(READ_BACK_A)
      expect(d.slots.addr_confirm_misses).toBe(1)
      expect(said(d)).toBe(addressRecheckQuestion(ADDR_A))
    },
  )

  it('the miss budget hands off rather than asking a third time', async () => {
    const spent = await roofingTurnViaLlm({
      prev: { ...INCIDENT, slots: { ...INCIDENT.slots, addr_confirm_misses: MAX_ADDRESS_VERIFY_REJECTS - 1 } },
      inbound: 'Hi Mate',
      history,
      facts,
      decide: parrot,
    })
    expect(said(spent.decision)).toBe(addressHandoffReply(ADDR_A))
    expect(spent.decision.action === 'ask' && spent.decision.handoff).toBe(true)
  })

  // req 3, the other half. Only the REJECTION was made transcript-keyed at
  // first, so a customer who said YES on the incident state stayed in the loop
  // a customer who said NO escaped.
  it.each(['Yes', 'yep', 'Yes please'])(
    '%j on a stale step confirms the address instead of re-emitting the read-back',
    async (msg) => {
      const r = await roofingTurnViaLlm({ prev: INCIDENT, inbound: msg, history, facts, decide: parrot })
      expect(said(r.decision)).not.toBe(READ_BACK_A)
      expect(r.decision.action).toBe('measure')
    },
  )

  // NON-GOAL GUARD: "changing what a successful verification does". rejectsReadBack
  // ORs in a bare negation cue, so an affirmation carrying an incidental "don't"
  // reads as a rejection unless the affirmative is checked first — and wiping a
  // freshly confirmed address is worse than the loop.
  it.each([
    "Yes correct, don't worry about the gutters",
    "Yeah that's the one, the neighbour isn't involved",
    "Yes that's right, I'm not fussed on colour",
    "Correct. Can't wait to get it done",
  ])('%j is a confirmation, not a rejection — it still reaches the measure', async (msg) => {
    const r = await roofingTurnViaLlm({
      prev: AWAITING_CONFIRM,
      inbound: msg,
      history,
      facts,
      decide: async () => ({
        tool: 'verify_address',
        slots: {},
        reply_to_send: 'Great, checking that now.',
        booking_consent: 'unclear',
        declined_trade: null,
        structure_choices: null,
      }),
    })
    expect(r.decision.action).toBe('measure')
    expect(r.decision.slots.address).toBe(ADDR_A)
    expect(r.decision.slots.addr_confirm_rejects ?? 0).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════
// PAINTING — the trade the incident was actually on
// (painting_state.last_step = 'coats'). Every requirement above, mirrored,
// because a suite that only exercises advanceRoofing is exactly how three
// defects shipped green.
// ════════════════════════════════════════════════════════════════════

function saidP(d: PaintingTurnDecision): string {
  return d.action === 'ask' || d.action === 'await_form' ? d.reply : `<${d.action}>`
}

function replayP(start: PaintingConversationState, inbounds: string[]): string[] {
  let state = start
  const out: string[] = []
  for (const msg of inbounds) {
    const d = advancePainting(state, msg)
    out.push(saidP(d))
    state = nextPaintingConversationState(d)
  }
  return out
}

const P_AWAITING_CONFIRM: PaintingConversationState = {
  slots: {
    address: ADDR_A,
    postcode: '2010',
    state: 'NSW',
    address_confirmed: false,
    addr_verified: ADDR_A,
    scopes: ['walls'],
    coats: 2,
  },
  last_step: 'confirm_address',
}

describe('painting req 1 — a rejection is CONSUMED', () => {
  it.each(['No', 'No!', 'No, I want to do a roofing please', 'nope', 'wrong', 'Noooo'])(
    '%j clears the verified address, counts one rejection, never re-emits the read-back',
    (msg) => {
      const d = advancePainting(P_AWAITING_CONFIRM, msg)
      expect(d.action).toBe('ask')
      expect(d.action === 'ask' && d.step).toBe('address')
      expect(d.slots.address).toBeFalsy()
      expect(d.slots.addr_verified).toBeFalsy()
      expect(d.slots.address_confirmed).not.toBe(true)
      expect(d.slots.addr_confirm_rejects).toBe(1)
      expect(saidP(d)).not.toBe(READ_BACK_A)
    },
  )

  it.each(['No', 'NO', 'Noooo'])('%j never mints an estimate', (msg) => {
    const a = advancePainting(P_AWAITING_CONFIRM, msg).action
    expect(a).not.toBe('estimate')
    expect(a).not.toBe('inspection')
  })

  it('a genuine confirmation still proceeds past the read-back', () => {
    const d = advancePainting(P_AWAITING_CONFIRM, 'Yes')
    expect(d.slots.address_confirmed).toBe(true)
    expect(d.action === 'ask' && d.step).not.toBe('confirm_address')
  })
})

describe('painting req 2 — the bound FIRES, and the count survives the turn', () => {
  it(`${MAX_ADDRESS_VERIFY_REJECTS} rejections hand off with addressHandoffReply()`, () => {
    const first = advancePainting(P_AWAITING_CONFIRM, 'No')
    expect(first.slots.addr_confirm_rejects).toBe(1)

    const second = advancePainting(
      {
        slots: { ...first.slots, address: ADDR_B, address_confirmed: false },
        last_step: 'confirm_address',
      },
      'No',
    )
    expect(saidP(second)).toBe(addressHandoffReply(ADDR_B))
    expect(second.action === 'ask' && second.step).toBe('await_booking')
    expect(second.action === 'ask' && second.handoff).toBe(true)
    expect(second.slots.addr_confirm_rejects).toBe(MAX_ADDRESS_VERIFY_REJECTS)
    // The count must ride in the persisted painting_state or the bound resets.
    expect(nextPaintingConversationState(second).slots.addr_confirm_rejects).toBe(
      MAX_ADDRESS_VERIFY_REJECTS,
    )
  })
})

describe('painting req 3 — a finished flow never re-enters verification', () => {
  const CLOSED: PaintingConversationState = {
    slots: { ...P_AWAITING_CONFIRM.slots, address_confirmed: true },
    last_step: 'closed',
  }
  it.each(['No', 'Hi Mate', 'No, I want to do a roofing please', 'No!'])(
    'closed flow does not restart the confirm handshake on %j',
    (msg) => {
      const d = advancePainting(CLOSED, msg)
      expect(d.action === 'ask' && d.step).not.toBe('confirm_address')
      expect(saidP(d)).not.toBe(READ_BACK_A)
    },
  )
})

describe('painting req 4 — an unparsed reply counts a miss, never repeats', () => {
  it('"Hi Mate" spends a miss and re-asks in DIFFERENT words', () => {
    const d = advancePainting(P_AWAITING_CONFIRM, 'Hi Mate')
    expect(saidP(d)).not.toBe(READ_BACK_A)
    expect(saidP(d)).toBe(addressRecheckQuestion(ADDR_A))
    expect(d.slots.addr_confirm_misses).toBe(1)
  })

  it('five consecutive "Hi Mate" never emit the read-back and stop asking', () => {
    const bots = replayP(P_AWAITING_CONFIRM, ['Hi Mate', 'Hi Mate', 'Hi Mate', 'Hi Mate', 'Hi Mate'])
    for (const b of bots) expect(b).not.toBe(READ_BACK_A)
    expect(bots[1]).toBe(addressHandoffReply(ADDR_A))
  })
})

describe('the incident transcript, replayed on PAINTING', () => {
  const bots = [
    READ_BACK_A,
    ...replayP(P_AWAITING_CONFIRM, ['No', 'Hi Mate', 'No, I want to do a roofing please', 'No!']),
  ]

  it('bot #3 differs from bot #2', () => {
    expect(bots[2]).not.toBe(bots[1])
  })

  it('no two consecutive replies are byte-identical', () => {
    for (let i = 1; i < bots.length; i++) expect(bots[i]).not.toBe(bots[i - 1])
  })

  it('the read-back is never sent again', () => {
    for (const b of bots.slice(1)) expect(b).not.toBe(READ_BACK_A)
  })
})

describe('the PAINTING LLM path, on the state the incident was actually in', () => {
  // painting_state.last_step = 'coats' — the value the spec records. Every
  // step-keyed guard is dead code here, which is the whole point.
  const history = [
    { direction: 'inbound', body: 'painting quote for 12 Smith St, Surry Hills NSW 2010' },
    { direction: 'outbound', body: READ_BACK_A },
  ]
  const parrot: LlmDecider = async () => ({
    tool: 'answer_business_question',
    slots: {},
    reply_to_send: READ_BACK_A,
    booking_consent: 'unclear',
    declined_trade: null,
    structure_choices: null,
  })
  const facts = {
    business_name: 'QM Sparky',
    owner_first_name: 'Jeff',
    trades: ['painting'],
    state: 'NSW',
  }
  const INCIDENT: PaintingConversationState = {
    slots: { ...P_AWAITING_CONFIRM.slots, address_confirmed: true },
    last_step: 'coats',
  }

  it.each(['No', 'No!', 'No, I want to do a roofing please'])(
    "%j is consumed even with last_step 'coats', and never re-emits the read-back",
    async (msg) => {
      const r = await paintingTurnViaLlm({ prev: INCIDENT, inbound: msg, history, facts, decide: parrot })
      const d = r.decision
      expect(d.action).toBe('ask')
      expect(d.slots.address).toBeFalsy()
      expect(d.slots.addr_verified).toBeFalsy()
      expect(d.slots.addr_confirm_rejects).toBe(1)
      expect(saidP(d)).not.toBe(READ_BACK_A)
    },
  )

  it.each(['Hi Mate', 'Howdy'])('%j counts a miss instead of repeating verbatim', async (msg) => {
    const r = await paintingTurnViaLlm({ prev: INCIDENT, inbound: msg, history, facts, decide: parrot })
    expect(saidP(r.decision)).not.toBe(READ_BACK_A)
    expect(r.decision.slots.addr_confirm_misses).toBe(1)
  })

  it.each(['Yes', 'yep'])('%j confirms rather than re-emitting the read-back', async (msg) => {
    const r = await paintingTurnViaLlm({ prev: INCIDENT, inbound: msg, history, facts, decide: parrot })
    expect(saidP(r.decision)).not.toBe(READ_BACK_A)
    expect(r.decision.slots.address_confirmed).toBe(true)
  })

  it('a rejection that CARRIES a correction keeps the new address', async () => {
    const r = await paintingTurnViaLlm({
      prev: INCIDENT,
      inbound: `No, it's ${ADDR_B}`,
      history,
      facts,
      decide: async () => ({
        tool: 'verify_address',
        slots: { address: ADDR_B, address_confirmed: false },
        reply_to_send: confirmAddressQuestion(ADDR_B, false),
        booking_consent: 'unclear',
        declined_trade: null,
        structure_choices: null,
      }),
    })
    expect(r.decision.slots.address).toBe(ADDR_B)
  })
})

describe('the miss budget is a separate counter with the same exit', () => {
  it('counts, re-asks in different words, then hands off', () => {
    const one = consumeAddressMiss<AddressSlotsLike>({ address: ADDR_A, addr_verified: ADDR_A })
    expect(one.slots.addr_confirm_misses).toBe(1)
    expect(one.step).toBe('confirm_address')
    expect(one.reply).toBe(addressRecheckQuestion(ADDR_A))
    // Nobody rejected the address, so it is NOT cleared.
    expect(one.slots.address).toBe(ADDR_A)
    expect(one.handoff).not.toBe(true)

    const spent = consumeAddressMiss(one.slots)
    expect(spent.handoff).toBe(true)
    expect(spent.step).toBe('await_booking')
    expect(spent.reply).toBe(addressHandoffReply(ADDR_A))
  })
})
