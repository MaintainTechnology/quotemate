// SMS roofing receptionist — per-turn decision tests: gathering, the
// "is this your roof?" confirm gate, structure picking, stop/cancel,
// inspection booking, closed-flow reopen, and address validation.

import { describe, expect, it } from 'vitest'
import {
  advanceRoofing,
  isActiveRoofingFlow,
  nextRoofingConversationState,
  parseStructureChoice,
  parseStructureFollowup,
  shouldEngageRoofing,
  type RoofingConversationState,
} from './roofing-receptionist'

/** Simulate the route loop up to the first non-ask outcome. */
function runConversation(messages: string[]) {
  let state: RoofingConversationState | null = null
  const decisions = []
  for (const m of messages) {
    const decision = advanceRoofing(state, m)
    decisions.push(decision)
    state = nextRoofingConversationState(decision)
    if (decision.action !== 'ask') break
  }
  return { decisions, state }
}

describe('advanceRoofing — gather then measure', () => {
  it('gathers all inputs across turns then signals measure', () => {
    const { decisions } = runConversation([
      'Hi, I need a re-roof quote',
      '670 London Rd, Chandler QLD 4155',
      'yes',
      'full re-roof',
      'colorbond trimdek',
      'standard',
    ])
    const steps = decisions.map((d) => (d.action === 'ask' ? d.step : d.action))
    expect(steps[0]).toBe('address')
    expect(steps).toContain('confirm_address')
    expect(steps).toContain('material')
    expect(steps).toContain('pitch')
    expect(steps[steps.length - 1]).toBe('measure')
  })

  it('asks which profile when the customer just says "colorbond", then measures', () => {
    const { decisions } = runConversation([
      'Hi, I need a re-roof quote',
      '670 London Rd, Chandler QLD 4155',
      'yes',
      'full re-roof',
      'colorbond', // names no profile → one targeted follow-up
      'corrugated',
      'standard',
    ])
    const steps = decisions.map((d) => (d.action === 'ask' ? d.step : d.action))
    expect(steps).toContain('material_profile')
    const askedProfile = decisions.find((d) => d.action === 'ask' && d.step === 'material_profile')
    expect(askedProfile && askedProfile.action === 'ask' && askedProfile.reply).toMatch(/corrugated/i)
    expect(steps[steps.length - 1]).toBe('measure')
    const last = decisions[decisions.length - 1]
    expect(last.slots.material).toBe('colorbond_corrugated')
  })

  it('opener gleans intent so it is not asked again', () => {
    const d = advanceRoofing(null, 'my roof is leaking badly')
    expect(d.slots.intent).toBe('leak_trace')
    expect(d.action).toBe('ask')
    if (d.action === 'ask') expect(d.step).toBe('address')
  })
})

// ── Cross-step intent: mid-flow corrections, topic switches, questions ──
// The step machine used to parse ONLY the current step, so a mid-flow
// address change was ignored and the flow escalated to inspection at the
// STALE address (live 2026-07-24, "Sparky": customer corrected to 999 Archer
// St while on the intent step; bot quoted an inspection at the old 223).
// Fix = fold a clear address anywhere, cue-gated fold for other corrections,
// bail to the LLM dialog for topic switches / interrupts / questions.
describe('advanceRoofing — cross-step intent (adaptive mid-flow)', () => {
  const onIntent: RoofingConversationState = {
    slots: { address: '223 Archer St, Gumdale QLD 4154', address_confirmed: true },
    last_step: 'intent',
  }

  // S1 — the screenshot. Address correction on a non-address step.
  it('S1: folds a mid-flow address correction and re-confirms the NEW address', () => {
    const d = advanceRoofing(onIntent, 'Oh I want to change address sorry its actually 999 Archer Street Gumdale')
    expect(d.action).toBe('ask')
    if (d.action === 'ask') {
      expect(d.step).toBe('confirm_address')
      expect(d.slots.address).toMatch(/999 Archer Street/i)
      expect(d.slots.address_confirmed).toBe(false)
    }
  })
  it('S1: never escalates to inspection at the stale address', () => {
    const d = advanceRoofing(onIntent, 'change my address to 999 Archer Street Gumdale please')
    expect(d.action).not.toBe('inspection')
    if (d.action === 'ask') expect(d.slots.address).not.toMatch(/223/)
  })

  // S1 follow-up — the "DID YOU GET THE ADDRESS" turn (now on confirm_address).
  it('S1b: a worried "did you get the address" re-reads the corrected address, not inspection', () => {
    const onConfirm: RoofingConversationState = {
      slots: { address: '999 Archer Street Gumdale', address_confirmed: false },
      last_step: 'confirm_address',
    }
    const d = advanceRoofing(onConfirm, 'DID YOU GET THE ADDRESS')
    expect(d.action).toBe('ask')
    if (d.action === 'ask') {
      expect(d.step).toBe('confirm_address')
      expect(d.reply).toMatch(/999/)
    }
  })

  // S2 — topic switch to another trade → hand to the general LLM dialog.
  it('S2: a topic switch ("also fix a leaking tap") bails to the general dialog', () => {
    const d = advanceRoofing(onIntent, "also can you fix a leaking tap while you're there")
    expect(d.action).toBe('passthrough')
  })

  // S3 — correction of a NON-address slot, cue-gated.
  it('S3: "no I meant colorbond kliplok" folds the material correction, stays in flow', () => {
    const onPitch: RoofingConversationState = {
      slots: { address: '1 A St', address_confirmed: true, intent: 'full_reroof', material: 'concrete_tile' },
      last_step: 'pitch',
    }
    const d = advanceRoofing(onPitch, 'no I meant colorbond kliplok')
    expect(d.action).toBe('ask')
    if (d.action === 'ask') expect(d.slots.material).toBe('colorbond_kliplok')
  })

  // S4 — multi-intent: address correction + another field in one text.
  it('S4: a combined address change + detail folds the address and re-confirms first', () => {
    const d = advanceRoofing(onIntent, "change the address to 45 Ocean Road Bondi, it's a metal roof")
    expect(d.action).toBe('ask')
    if (d.action === 'ask') {
      expect(d.step).toBe('confirm_address')
      expect(d.slots.address).toMatch(/45 Ocean Road/i)
      expect(d.slots.address_confirmed).toBe(false)
    }
  })

  // S5 — out-of-order answer (a not-yet-asked field), no correction cue.
  it('S5: an out-of-order clean answer ("its a colorbond kliplok roof") is captured', () => {
    const d = advanceRoofing(onIntent, "oh and it's a colorbond kliplok roof")
    expect(d.action).toBe('ask')
    if (d.action === 'ask') expect(d.slots.material).toBe('colorbond_kliplok')
  })

  // S6 — interrupt that is NOT an explicit stop/opt-out keyword.
  it('S6: an interrupt ("wait, hold on a sec") bails to the dialog, not cancel', () => {
    const onMaterial: RoofingConversationState = {
      slots: { address: '1 A St', address_confirmed: true, intent: 'full_reroof' },
      last_step: 'material',
    }
    const d = advanceRoofing(onMaterial, 'wait, hold on a sec')
    expect(d.action).toBe('passthrough')
  })

  // S7 — a clarification question the step parser cannot answer.
  it('S7: a clarification question on a non-address step bails to the dialog', () => {
    const onPitch: RoofingConversationState = {
      slots: { address: '1 A St', address_confirmed: true, intent: 'full_reroof', material: 'colorbond_trimdek' },
      last_step: 'pitch',
    }
    const d = advanceRoofing(onPitch, 'what number did you say again?')
    expect(d.action).toBe('passthrough')
  })

  // Stage-3 review defects (2026-07-24) — precision holes the first pass missed.
  const midPitch: RoofingConversationState = {
    slots: { address: '670 London Rd Chandler QLD 4155', address_confirmed: true, intent: 'full_reroof', material: 'colorbond_corrugated' },
    last_step: 'pitch',
  }
  // A — a numeric NON-address answer to "how steep?" must NOT be folded as
  // an address (out-of-order reused the unguarded address parser).
  it('A: "it\'s about 2 storeys" at pitch never clobbers the confirmed address', () => {
    const d = advanceRoofing(midPitch, "it's about 2 storeys")
    if (d.action === 'ask' || d.action === 'inspection') {
      expect(d.slots.address).toBe('670 London Rd Chandler QLD 4155')
      expect(d.slots.address_confirmed).not.toBe(false)
    }
  })
  // B — "way" is ordinary English, not a street type on the whole message.
  it('B: "no way to tell from 2 photos" is not read as an address', () => {
    const d = advanceRoofing(midPitch, 'no way to tell from 2 photos')
    if (d.action === 'ask' || d.action === 'inspection' || d.action === 'passthrough') {
      expect(d.slots.address).toBe('670 London Rd Chandler QLD 4155')
    }
  })
  // D — an address correction that opens with an interrupt word must still
  // FOLD the address, not bail (address wins over the pre-empt).
  it('D: "wait, change the address to 999 Archer Street" folds the address', () => {
    const d = advanceRoofing(onIntent, 'wait, change the address to 999 Archer Street Gumdale')
    expect(d.action).toBe('ask')
    if (d.action === 'ask') {
      expect(d.step).toBe('confirm_address')
      expect(d.slots.address).toMatch(/999 Archer Street/i)
    }
  })
  // E — a question that happens to contain a mappable keyword must bail to
  // the dialog, not silently commit that keyword as the answer.
  it('E: "is it colorbond or tile?" at material bails, does not commit a material', () => {
    const onMaterial: RoofingConversationState = {
      slots: { address: '1 A St', address_confirmed: true, intent: 'full_reroof' },
      last_step: 'material',
    }
    const d = advanceRoofing(onMaterial, 'is it colorbond or tile?')
    expect(d.action).toBe('passthrough')
  })

  // F1 (reorder defect) — a step answer that INCIDENTALLY restates the
  // confirmed address must take the answer, not clobber the address with a
  // degraded value and bounce back to confirm_address.
  it('F1: "full reroof at 670 London Rd" keeps the confirmed address, takes the intent', () => {
    const onIntentConfirmed: RoofingConversationState = {
      slots: { address: '670 London Rd Chandler QLD 4155', address_confirmed: true },
      last_step: 'intent',
    }
    const d = advanceRoofing(onIntentConfirmed, 'full reroof at 670 London Rd')
    expect(d.slots.address).toBe('670 London Rd Chandler QLD 4155')
    expect(d.slots.intent).toBe('full_reroof')
    if (d.action === 'ask') expect(d.step).not.toBe('confirm_address')
  })

  // REGRESSION — a normal landing answer must NOT trip the cross-step path.
  it('regression: a normal material answer still lands and asks pitch', () => {
    const onMaterial: RoofingConversationState = {
      slots: { address: '1 A St', address_confirmed: true, intent: 'full_reroof' },
      last_step: 'material',
    }
    const d = advanceRoofing(onMaterial, 'colorbond trimdek')
    expect(d.action).toBe('ask')
    if (d.action === 'ask') {
      expect(d.step).toBe('pitch')
      expect(d.slots.material).toBe('colorbond_trimdek')
    }
  })

  // REGRESSION — genuine junk still uses the bounded miss → inspection fallback.
  it('regression: unrecognisable junk still miss-counts to inspection, not passthrough', () => {
    const onPitch: RoofingConversationState = {
      slots: { address: '1 A St', address_confirmed: true, intent: 'full_reroof', material: 'colorbond_trimdek', misses: 1 },
      last_step: 'pitch',
    }
    const d = advanceRoofing(onPitch, 'the brown stuff')
    expect(d.action).toBe('inspection')
  })
})

describe('advanceRoofing — inspection fallback', () => {
  it('routes fibro/asbestos to inspection', () => {
    const { decisions } = runConversation([
      'need a roof repair quote',
      '12 Smith St, Bondi NSW 2026',
      'yes',
      'repair a few spots',
      'fibro',
    ])
    const last = decisions[decisions.length - 1]
    expect(last.action).toBe('inspection')
    if (last.action === 'inspection') expect(last.reason).toMatch(/asbestos/i)
  })
})

describe('parseStructureChoice', () => {
  it('reads a bare number, #n, "number n", and ordinals within range', () => {
    expect(parseStructureChoice('2', 3)).toBe(2)
    expect(parseStructureChoice('#1', 3)).toBe(1)
    expect(parseStructureChoice('number 3', 3)).toBe(3)
    expect(parseStructureChoice('the second one', 3)).toBe(2)
  })
  it('returns null out of range or when no number', () => {
    expect(parseStructureChoice('5', 2)).toBeNull()
    expect(parseStructureChoice('yes please', 2)).toBeNull()
  })
})

describe('advanceRoofing — confirm_roof gate', () => {
  const measured: RoofingConversationState = {
    slots: { address: '1 A St', address_confirmed: true, intent: 'full_reroof', material: 'colorbond_trimdek', pitch: 'standard' },
    last_step: 'confirm_roof',
    pending_quote_token: 'tok123',
    pending_structure_count: 2,
  }

  it('YES → send_saved (all structures)', () => {
    const d = advanceRoofing(measured, 'yes thats my roof')
    expect(d.action).toBe('send_saved')
    if (d.action === 'send_saved') expect(d.structureChoices).toBeNull()
  })
  it('a number → send_saved for that structure', () => {
    const d = advanceRoofing(measured, '2')
    expect(d.action).toBe('send_saved')
    if (d.action === 'send_saved') expect(d.structureChoices).toEqual([2])
  })
  // A MULTI-pick at confirm time must serve every named structure. The old
  // code ran the single-pick parser first, whose regex grabs the FIRST
  // digit — "2 and 3" quoted structure 2 alone while the customer believed
  // both were covered (same money class as the 2026-07-22 included_indices
  // bug, still open at this step; the warm 'quoted' step already handled it).
  it('"2 and 3" at confirm → send_saved BOTH structures, not just 2', () => {
    const three: RoofingConversationState = { ...measured, pending_structure_count: 3 }
    const d = advanceRoofing(three, '2 and 3')
    expect(d.action).toBe('send_saved')
    if (d.action === 'send_saved') expect(d.structureChoices).toEqual([2, 3])
  })
  it('"buildings 1 and 3 please" → send_saved [1,3]', () => {
    const three: RoofingConversationState = { ...measured, pending_structure_count: 3 }
    const d = advanceRoofing(three, 'buildings 1 and 3 please')
    expect(d.action).toBe('send_saved')
    if (d.action === 'send_saved') expect(d.structureChoices).toEqual([1, 3])
  })
  // Ordering trap: "secondary structure 1" is ENTRY 2 (the list names it
  // that way). Only the single-pick parser knows that mapping — a naive
  // multi-first parse would read the digit 1 and serve the main dwelling.
  it('"secondary structure 1" still maps to entry 2, never entry 1', () => {
    const three: RoofingConversationState = { ...measured, pending_structure_count: 3 }
    const d = advanceRoofing(three, 'secondary structure 1')
    expect(d.action).toBe('send_saved')
    if (d.action === 'send_saved') expect(d.structureChoices).toEqual([2])
  })
  it('"all of them" (the prompt offers it) → send_saved all', () => {
    const d = advanceRoofing(measured, 'all of them please')
    expect(d.action).toBe('send_saved')
    if (d.action === 'send_saved') expect(d.structureChoices).toBeNull()
  })
  it('NO → re-ask the address and reset it', () => {
    const d = advanceRoofing(measured, 'no thats the wrong building')
    expect(d.action).toBe('ask')
    if (d.action === 'ask') {
      expect(d.step).toBe('address')
      expect(d.slots.address).toBeNull()
    }
  })
  it('unclear reply → reconfirm', () => {
    const d = advanceRoofing(measured, 'hmm maybe')
    expect(d.action).toBe('reconfirm')
  })
})

describe('advanceRoofing — stop / cancel / booking / closed', () => {
  const midFlow: RoofingConversationState = {
    slots: { address: '1 A St', address_confirmed: true, intent: 'full_reroof' },
    last_step: 'material',
  }

  it('a stop/cancel request at any step → cancel', () => {
    expect(advanceRoofing(midFlow, 'STOP PLEASE').action).toBe('cancel')
    expect(advanceRoofing(null, "let's cancel now and stop this session").action).toBe('cancel')
    expect(advanceRoofing(null, 'FUCK NO!').action).toBe('cancel')
    expect(advanceRoofing(midFlow, 'not interested anymore').action).toBe('cancel')
  })

  it('bare "no" is NOT a stop — it answers the confirm', () => {
    const confirm: RoofingConversationState = { slots: { address: '1 A St', address_confirmed: true, intent: 'full_reroof', material: 'colorbond_trimdek', pitch: 'standard' }, last_step: 'confirm_roof', pending_structure_count: 1 }
    expect(advanceRoofing(confirm, 'no').action).toBe('ask') // wrong building → re-ask
  })

  // await_booking used to be single-shot: confirmed = isAffirmative && !isNegative,
  // so ANY non-"yes" reply → confirmed=false → "text us whenever" + the thread
  // closed with NO tradie notify. A hot inspection lead who asked a question or
  // proposed a day was silently dropped (audit 2026-07-23). The fix: only an
  // explicit decline closes without notifying; everything else is a live lead.
  it('await_booking: yes → booking confirmed', () => {
    const base: RoofingConversationState = { slots: {}, last_step: 'await_booking' }
    expect(advanceRoofing(base, 'yes please book it')).toMatchObject({ action: 'booking', confirmed: true })
  })
  it('await_booking: a clarifying question is a LIVE LEAD → confirmed (tradie notified), not dropped', () => {
    const base: RoofingConversationState = { slots: {}, last_step: 'await_booking' }
    expect(advanceRoofing(base, 'what does the inspection cost?')).toMatchObject({ action: 'booking', confirmed: true })
  })
  it('await_booking: a proposed time is booking intent → confirmed', () => {
    const base: RoofingConversationState = { slots: {}, last_step: 'await_booking' }
    expect(advanceRoofing(base, 'Tuesday works for me')).toMatchObject({ action: 'booking', confirmed: true })
  })
  it('await_booking: an explicit no still declines gracefully (no notify)', () => {
    const base: RoofingConversationState = { slots: {}, last_step: 'await_booking' }
    expect(advanceRoofing(base, 'no thanks')).toMatchObject({ action: 'booking', confirmed: false })
    // "not right now" is a soft decline (matches the deny set) — stays declined.
    expect(advanceRoofing(base, 'not right now')).toMatchObject({ action: 'booking', confirmed: false })
  })

  it('a closed flow re-opens only on a fresh enquiry and resets slots', () => {
    const closed: RoofingConversationState = { slots: { address: 'old place', intent: 'full_reroof' }, last_step: 'closed' }
    const d = advanceRoofing(closed, 'I need a re-roof quote')
    expect(d.action).toBe('ask')
    if (d.action === 'ask') {
      expect(d.step).toBe('address')
      expect(d.slots.address).toBeFalsy() // old slots wiped
    }
  })
})

describe('advanceRoofing — address validation', () => {
  it('rejects a non-address reply (no street number) and re-asks clearly', () => {
    const d = advanceRoofing({ slots: {}, last_step: 'address' }, 'somewhere in town thanks')
    expect(d.action).toBe('ask')
    if (d.action === 'ask') {
      expect(d.step).toBe('address')
      expect(d.reply).toMatch(/didn't catch/i)
      expect(d.slots.address).toBeFalsy()
    }
  })
  it('accepts a real address with a street number', () => {
    const d = advanceRoofing({ slots: {}, last_step: 'address' }, '5 Smith St, Bondi NSW 2026')
    expect(d.action).toBe('ask')
    if (d.action === 'ask') expect(d.step).toBe('confirm_address')
  })
})

describe('isActiveRoofingFlow', () => {
  it('true mid-gather/awaiting, false when closed or empty', () => {
    expect(isActiveRoofingFlow({ slots: {}, last_step: 'material' })).toBe(true)
    expect(isActiveRoofingFlow({ slots: {}, last_step: 'confirm_roof' })).toBe(true)
    expect(isActiveRoofingFlow({ slots: {}, last_step: 'await_booking' })).toBe(true)
    expect(isActiveRoofingFlow({ slots: {}, last_step: 'closed' })).toBe(false)
    expect(isActiveRoofingFlow({ slots: {}, last_step: null })).toBe(false)
    expect(isActiveRoofingFlow(null)).toBe(false)
  })
})

describe('nextRoofingConversationState', () => {
  it('parks each action at the right step', () => {
    const ask = advanceRoofing(null, 'hello')
    expect(nextRoofingConversationState(ask).last_step).toBe('address')
    expect(nextRoofingConversationState({ action: 'measure', slots: {} }).last_step).toBe('confirm_roof')
    expect(nextRoofingConversationState({ action: 'inspection', slots: {}, reason: 'x' }).last_step).toBe('await_booking')
    // send_saved parks at the WARM 'quoted' state (not closed) so a
    // structure follow-up can re-serve the saved measurement.
    expect(nextRoofingConversationState({ action: 'send_saved', slots: {}, structureChoices: null }).last_step).toBe('quoted')
    expect(nextRoofingConversationState({ action: 'cancel', slots: {} }).last_step).toBe('closed')
    expect(nextRoofingConversationState({ action: 'booking', slots: {}, confirmed: true }).last_step).toBe('closed')
  })
})

describe('parseStructureFollowup', () => {
  it('"all of them" / "everything" / "both" → all', () => {
    expect(parseStructureFollowup('quote all of them', 3)).toBe('all')
    expect(parseStructureFollowup('give me everything', 3)).toBe('all')
    expect(parseStructureFollowup('both please', 2)).toBe('all')
  })
  it('a list of numbers / ordinals → sorted unique indices', () => {
    expect(parseStructureFollowup('give me breakdown for 2 and 3 too', 3)).toEqual([2, 3])
    expect(parseStructureFollowup('2, 3', 3)).toEqual([2, 3])
    expect(parseStructureFollowup('#3 #2', 3)).toEqual([2, 3])
    expect(parseStructureFollowup('the second and third', 3)).toEqual([2, 3])
  })
  it('"the others" → complement of what was already served', () => {
    expect(parseStructureFollowup('give me the others too', 3, [1])).toEqual([2, 3])
    expect(parseStructureFollowup('the rest please', 3, [1, 2])).toEqual([3])
  })
  it('a bare shed/garage maps to the secondary structures', () => {
    expect(parseStructureFollowup('what about the shed', 3)).toEqual([2, 3])
    expect(parseStructureFollowup('the garage too', 2)).toEqual([2])
  })
  it('out-of-range numbers are dropped; nothing valid → null', () => {
    expect(parseStructureFollowup('9', 3)).toBeNull()
    expect(parseStructureFollowup('thanks heaps', 3)).toBeNull()
    expect(parseStructureFollowup('', 3)).toBeNull()
  })
  it('does NOT hijack a number that is part of a non-structure sentence', () => {
    // These would re-fire the roofing quote under a naive "any digit" scan.
    expect(parseStructureFollowup('call me at 2', 3)).toBeNull()
    expect(parseStructureFollowup('I have 2 dogs', 3)).toBeNull()
    expect(parseStructureFollowup('both lights please', 2)).toBeNull()
    expect(parseStructureFollowup('can you also quote me 6 downlights', 3)).toBeNull()
    expect(parseStructureFollowup('all good thanks', 3)).toBeNull()
  })
  it('still fires on a clear structure cue even in a longer sentence', () => {
    expect(parseStructureFollowup('can you do building 2 and 3 as well', 3)).toEqual([2, 3])
    expect(parseStructureFollowup('what about that shed out the back', 3)).toEqual([2, 3])
  })
})

describe('advanceRoofing — warm "quoted" thread (no fall-through to electrical)', () => {
  const quoted: RoofingConversationState = {
    slots: { address: '670 London Rd, Chandler QLD 4155', address_confirmed: true, intent: 'full_reroof', material: 'colorbond_trimdek', pitch: 'standard' },
    last_step: 'quoted',
    pending_quote_token: 'tok123',
    pending_structure_count: 3,
    last_served_structures: [1],
  }

  it('"give me breakdown for 2 and 3 too" → send_saved for [2,3] (served from the saved measurement)', () => {
    const d = advanceRoofing(quoted, 'give me breakdown for 2 and 3 too')
    expect(d.action).toBe('send_saved')
    if (d.action === 'send_saved') expect(d.structureChoices).toEqual([2, 3])
  })
  it('"the others" → the complement of what was already served', () => {
    const d = advanceRoofing(quoted, 'and the others please')
    expect(d.action).toBe('send_saved')
    if (d.action === 'send_saved') expect(d.structureChoices).toEqual([2, 3])
  })
  it('"all of them" → send_saved all (null)', () => {
    const d = advanceRoofing(quoted, 'actually quote all of them')
    expect(d.action).toBe('send_saved')
    if (d.action === 'send_saved') expect(d.structureChoices).toBeNull()
  })
  it('a NON-structure, NON-roofing message → passthrough (general dialog handles it)', () => {
    expect(advanceRoofing(quoted, 'can you also quote me 6 downlights?').action).toBe('passthrough')
    expect(advanceRoofing(quoted, 'thanks mate').action).toBe('passthrough')
  })
  it('a stop request while quoted still cancels', () => {
    expect(advanceRoofing(quoted, 'STOP').action).toBe('cancel')
  })
  it('a fresh roofing enquiry while quoted reopens the gather (resets slots)', () => {
    const d = advanceRoofing(quoted, 'I need a re-roof quote at a new place')
    expect(d.action).toBe('ask')
    if (d.action === 'ask') {
      expect(d.step).toBe('address')
      expect(d.slots.address).toBeFalsy()
    }
  })
  it('"quoted" counts as an ACTIVE flow', () => {
    expect(isActiveRoofingFlow(quoted)).toBe(true)
  })
})

describe('shouldEngageRoofing — follow-up pin guard (spec 2026-07-05 Part A2)', () => {
  // A mid-gather roofing flow still parked on the thread (we last asked
  // about pitch). This is the stale state a follow-up on a DIFFERENT quote
  // must not resume.
  const activeRoofing: RoofingConversationState = { slots: {}, last_step: 'pitch' }
  const closedRoofing: RoofingConversationState = { slots: {}, last_step: 'closed' }

  it('R-A1: stale active roofing state + active pin + affirmative reply → does NOT engage (falls through to the general dialog)', () => {
    expect(shouldEngageRoofing(activeRoofing, 'Yes', true)).toBe(false)
    expect(shouldEngageRoofing(activeRoofing, 'yep sounds good', true)).toBe(false)
  })

  it('R-A2: active pin + a genuinely NEW roofing enquiry → still engages', () => {
    expect(shouldEngageRoofing(activeRoofing, 'I need a re-roof', true)).toBe(true)
    expect(shouldEngageRoofing(null, 'can I get a re-roof quote', true)).toBe(true)
  })

  it('no pin → behaviour is unchanged: active flow resumes, fresh enquiry engages, anything else passes through', () => {
    expect(shouldEngageRoofing(activeRoofing, 'Yes', false)).toBe(true) // resume active flow
    expect(shouldEngageRoofing(null, 'I need a re-roof', false)).toBe(true) // fresh enquiry
    expect(shouldEngageRoofing(null, 'Yes', false)).toBe(false) // neither
    expect(shouldEngageRoofing(closedRoofing, 'Yes', false)).toBe(false) // closed flow
  })
})

// Reported 2026-07-23: "when the address has already been provided in the
// first query, it asks for the address again". Root cause: the opening-turn
// branch of advanceRoofing harvested only intent + year_built.
// Production proof (tenant "Ricardos Roofing"):
//   CUSTOMER: "I am looking to get a new roof at 670 London road Chandler"
//   BOT:      "Happy to sort a roofing quote for you. What's the property
//              address, including suburb and postcode?"
describe('advanceRoofing — harvests the opening message', () => {
  it('does not re-ask for an address given in the first message', () => {
    const d = advanceRoofing(null, 'I am looking to get a new roof at 670 London road Chandler')
    expect(d.action).toBe('ask')
    if (d.action !== 'ask') return
    // Straight to the read-back, not back to "what's the address?"
    expect(d.step).toBe('confirm_address')
    expect(d.reply).toContain('670 London road Chandler')
    expect(d.slots.address).toContain('670 London road Chandler')
    expect(d.slots.intent).toBe('full_reroof')
  })

  it('captures postcode and state from the opening message', () => {
    const d = advanceRoofing(null, 'need my roof replaced at 1434 Numinbah Road Chillingham NSW 2484')
    if (d.action !== 'ask') throw new Error('expected ask')
    expect(d.slots.postcode).toBe('2484')
    expect(d.slots.state).toBe('NSW')
  })

  it('harvests a named material from the opening message', () => {
    const d = advanceRoofing(null, 'my terracotta tile roof at 12 Smith St needs repointing')
    if (d.action !== 'ask') throw new Error('expected ask')
    expect(d.slots.material).toBe('terracotta_tile')
  })

  // A bare brand name still must not pick a profile — that was the bug that
  // quoted Trimdek for a customer who said "Colorbond".
  it('records a metal HINT rather than guessing a profile', () => {
    const d = advanceRoofing(null, 'colorbond roof at 12 Smith St needs replacing')
    if (d.action !== 'ask') throw new Error('expected ask')
    expect(d.slots.material).toBeFalsy()
    expect(d.slots.metal_hint).toBe(true)
  })

  // Harvesting must never invent an address out of a plain enquiry.
  it('invents nothing when the opener carries no address', () => {
    for (const m of ['do you do roofing?', 'need a roofer', 'how much for a re-roof', 'roof quote please']) {
      const d = advanceRoofing(null, m)
      if (d.action !== 'ask') throw new Error(`expected ask for "${m}"`)
      expect(d.slots.address).toBeFalsy()
      expect(d.step).toBe('address')
    }
  })

  // The harvested address is still read back exactly once.
  it('leaves a harvested address unconfirmed', () => {
    const d = advanceRoofing(null, 'reroof quote for 670 London Road, Chandler QLD 4155')
    if (d.action !== 'ask') throw new Error('expected ask')
    expect(d.slots.address_confirmed).toBe(false)
  })
})

// A tenant whose only trade is roofing has nothing to route to. Requiring a
// roofing keyword there hands their customers to the electrical/plumbing
// dialog. Observed live on "Bills roofing" (trades = ['roofing']): the
// opener "test from owner" never reached the roofing receptionist.
describe('shouldEngageRoofing — roofing-only tenant needs no keyword', () => {
  const openers = [
    'test from owner',
    'hi',
    'Hi there, are you available?',
    'how much for my place?',
    'can you help me out',
    'I need a quote',
    '670 London Road, Chandler QLD 4155',
  ]

  it('engages on any opener when the tenant does roofing and nothing else', () => {
    for (const m of openers) {
      expect(shouldEngageRoofing(null, m, false, true)).toBe(true)
    }
  })

  it('still requires a keyword for a cross-trade tenant', () => {
    for (const m of openers) {
      expect(shouldEngageRoofing(null, m, false, false)).toBe(false)
    }
    // ...and the electrical job on a cross-trade tenant still routes away.
    expect(shouldEngageRoofing(null, 'the downlight near the roof cavity flickers', false, false)).toBe(false)
  })

  it('the follow-up pin still wins over the roofing-only shortcut', () => {
    const midGather: RoofingConversationState = { slots: {}, last_step: 'pitch' }
    expect(shouldEngageRoofing(null, 'Yes', true, true)).toBe(false)
    expect(shouldEngageRoofing(midGather, 'Yes', true, true)).toBe(false)
  })

  it('defaults to the old keyword behaviour when the flag is omitted', () => {
    expect(shouldEngageRoofing(null, 'test from owner', false)).toBe(false)
  })
})
