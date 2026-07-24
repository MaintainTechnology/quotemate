// ════════════════════════════════════════════════════════════════════
// Regression — the roofing SMS flow must always COMPLETE.
//
// Before this suite, every gathering step re-asked the identical question
// forever whenever the customer's answer didn't map to an enum value:
// "iron" (material), "25 degrees" (pitch) and "replace it all" (intent)
// are all things Australians actually text, and all three dead-ended the
// conversation in an infinite re-ask loop — no quote, no inspection, no
// tradie alert.
//
// Two guards, tested here:
//   1. The mappers understand the common plain-language answers.
//   2. When an answer STILL doesn't map, a bounded miss counter routes the
//      job to the on-site inspection — the codebase's documented safe
//      failure mode — instead of looping.
// ════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest'
import {
  applyRoofingAnswer,
  extractStreetAddress,
  isAmbiguousMetal,
  mapMaterial,
  mapPitch,
  mapIntent,
  nextRoofingStep,
  type RoofingSlots,
} from './roofing-intake'
import {
  advanceRoofing,
  closeStaleRoofingState,
  confirmedIncludedIndices,
  expireIdleRoofingState,
  latestInboundBurst,
  parseStructureChoice,
  roofingTurnInput,
  shouldEngageRoofing,
  type RoofingConversationState,
  type RoofingTurnDecision,
} from './roofing-receptionist'
import { resolveEffectiveIndices } from '@/lib/roofing/selection'

// Drive the receptionist for N turns, feeding the same reply each time,
// exactly as the route does: persist the returned slots + asked step.
function runTurns(
  start: RoofingConversationState,
  reply: string,
  turns: number,
): RoofingTurnDecision {
  let state = start
  let decision: RoofingTurnDecision = advanceRoofing(state, reply)
  for (let i = 1; i < turns; i++) {
    if (decision.action !== 'ask') return decision
    state = { slots: decision.slots, last_step: decision.step }
    decision = advanceRoofing(state, reply)
  }
  return decision
}

const GATHERED: RoofingSlots = {
  address: '12 Smith St, Bondi NSW 2026',
  postcode: '2026',
  state: 'NSW',
  address_confirmed: true,
  intent: 'full_reroof',
}

describe('roofing mappers — plain-language answers Australians actually send', () => {
  it('maps iron / galvanised iron to corrugated metal', () => {
    expect(mapMaterial('iron')).toBe('colorbond_corrugated')
    expect(mapMaterial('galvanised iron')).toBe('colorbond_corrugated')
    expect(mapMaterial('galvanized iron')).toBe('colorbond_corrugated')
    expect(mapMaterial('galv')).toBe('colorbond_corrugated')
    // Existing behaviour must not regress.
    expect(mapMaterial('corrugated iron')).toBe('colorbond_corrugated')
    // A bare brand name names no profile — asked as a follow-up, never guessed.
    expect(mapMaterial('colorbond')).toBeNull()
    expect(mapMaterial('colorbond trimdek')).toBe('colorbond_trimdek')
    expect(mapMaterial('tiles')).toBe('concrete_tile')
    expect(mapMaterial('fibro')).toBe('cement_sheet')
  })

  it('routes materials outside the priced vocabulary to inspection, never a guess', () => {
    // Slate and asphalt shingle are NOT in ROOF_MATERIALS. Guessing a
    // price for them would break the grounding discipline, so they must
    // read as unknown → on-site inspection.
    expect(mapMaterial('slate')).toBe('unknown')
    expect(mapMaterial('slate roof')).toBe('unknown')
    expect(mapMaterial('shingles')).toBe('unknown')
    expect(mapMaterial('asphalt shingle')).toBe('unknown')
  })

  it('maps a pitch given in degrees using the canonical buckets', () => {
    expect(mapPitch('15 degrees')).toBe('shallow')
    expect(mapPitch('about 22 degrees')).toBe('standard')
    expect(mapPitch('25 degrees')).toBe('standard')
    expect(mapPitch('30 degrees')).toBe('steep')
    expect(mapPitch('45 degrees')).toBe('very_steep')
    expect(mapPitch('22°')).toBe('standard')
    // Words still win where they already worked.
    expect(mapPitch('standard')).toBe('standard')
    expect(mapPitch('not sure')).toBe('unknown')
  })

  it('maps more ways of saying a full re-roof', () => {
    expect(mapIntent('replace it all')).toBe('full_reroof')
    expect(mapIntent('the lot')).toBe('full_reroof')
    expect(mapIntent('full re-roof')).toBe('full_reroof')
    expect(mapIntent('need a new roof')).toBe('full_reroof')
  })

  // ── The live failure, 2026-07-22 ──────────────────────────────────
  // Thread +61414530836: we asked "What do you need done?", the customer
  // answered "Roof replacement", and we sent the IDENTICAL question again.
  // Cause: the trailing \b in /\b(…|roof.*replace|…)\b/ cannot match the
  // "-ment" suffix, so the whole answer read as unrecognised.
  it('understands "Roof replacement" and its suffixed forms', () => {
    expect(mapIntent('Roof replacement')).toBe('full_reroof')
    expect(mapIntent('Roof replacement please')).toBe('full_reroof')
    expect(mapIntent('roof replacing')).toBe('full_reroof')
    expect(mapIntent('Replacing my roof')).toBe('full_reroof')
    expect(mapIntent('replacement')).toBe('full_reroof')
  })

  it('does not mistake a gutter job for a full re-roof', () => {
    expect(mapIntent('gutter replacement')).toBe('gutter_replace')
    expect(mapIntent('replace my gutters')).toBe('gutter_replace')
    expect(mapIntent('downpipes')).toBe('gutter_replace')
  })

  // Same thread: "A bit steeper than normal." mapped to 'standard',
  // because \bsteep\b misses "steeper" and the word "normal" then won —
  // a steep roof silently priced at the standard rate.
  it('reads a comparative "steeper than X" as steep, not standard', () => {
    expect(mapPitch('A bit steeper than normal.')).toBe('steep')
    expect(mapPitch('A little bit steeper than standard')).toBe('steep')
    expect(mapPitch('steeper than usual')).toBe('steep')
    expect(mapPitch('steeper')).toBe('steep')
    expect(mapPitch('quite steeply pitched')).toBe('steep')
  })

  it('reads a negated "not too steep" as standard, not steep', () => {
    expect(mapPitch('not too steep')).toBe('standard')
    expect(mapPitch('not very steep')).toBe('standard')
    expect(mapPitch('not steep')).toBe('standard')
  })
})

describe('roofing flow never stalls — bounded re-asks then inspection', () => {
  it('routes to inspection after repeated unrecognised PITCH answers', () => {
    const d = runTurns({ slots: { ...GATHERED, material: 'colorbond_trimdek' }, last_step: 'pitch' }, 'kind of pointy', 5)
    expect(d.action).toBe('inspection')
  })

  it('routes to inspection after repeated unrecognised MATERIAL answers', () => {
    const d = runTurns({ slots: GATHERED, last_step: 'material' }, 'the brown stuff', 5)
    expect(d.action).toBe('inspection')
  })

  it('routes to inspection after repeated unrecognised INTENT answers', () => {
    const d = runTurns(
      { slots: { address: GATHERED.address, address_confirmed: true }, last_step: 'intent' },
      'the usual thing',
      5,
    )
    expect(d.action).toBe('inspection')
  })

  it('terminates after repeated unparseable ADDRESS answers', () => {
    const d = runTurns({ slots: {}, last_step: 'address' }, 'somewhere around here', 6)
    expect(d.action).toBe('inspection')
  })

  it('terminates after repeated ambiguous ADDRESS CONFIRMATIONS', () => {
    const d = runTurns(
      { slots: { address: GATHERED.address, address_confirmed: false }, last_step: 'confirm_address' },
      'hmm',
      5,
    )
    expect(d.action).toBe('inspection')
  })

  it('still asks at least once before giving up (one bad answer is not enough)', () => {
    const d = advanceRoofing({ slots: { ...GATHERED, material: 'colorbond_trimdek' }, last_step: 'pitch' }, 'kind of pointy')
    expect(d.action).toBe('ask')
    expect(d.action === 'ask' && d.step).toBe('pitch')
  })

  it('a good answer clears the miss counter so misses never accumulate across steps', () => {
    // One bad material answer...
    const bad = advanceRoofing({ slots: GATHERED, last_step: 'material' }, 'the brown stuff')
    expect(bad.action).toBe('ask')
    // ...then a good one. The flow must move to pitch, not to inspection.
    const good = advanceRoofing({ slots: bad.slots, last_step: 'material' }, 'colorbond trimdek')
    expect(good.action).toBe('ask')
    expect(good.action === 'ask' && good.step).toBe('pitch')
    // And a single bad pitch answer must NOT immediately trip the guard,
    // which it would if the earlier material miss had leaked forward.
    const pitchMiss = advanceRoofing({ slots: good.slots, last_step: 'pitch' }, 'the brown stuff')
    expect(pitchMiss.action).toBe('ask')
  })

  it('the happy path is unchanged — good answers reach measure', () => {
    const d = advanceRoofing(
      { slots: { ...GATHERED, material: 'colorbond_trimdek' }, last_step: 'pitch' },
      'standard',
    )
    expect(d.action).toBe('measure')
  })
})

// Replay of the real stuck thread (+61414530836, 2026-07-22). Every reply
// below is verbatim from sms_messages. Before the fix this sequence sent
// the "What do you need done?" question TWICE and never reached the
// material step on the customer's own wording.
describe('live transcript replay — 2026-07-22 stuck roofing thread', () => {
  it('walks address → confirm → intent → material → pitch → measure without repeating a question', () => {
    const asked: string[] = []
    let state: RoofingConversationState = { slots: {}, last_step: 'address' }

    const say = (msg: string): RoofingTurnDecision => {
      const d = advanceRoofing(state, msg)
      if (d.action === 'ask') {
        asked.push(d.step)
        state = { slots: d.slots, last_step: d.step }
      }
      return d
    }

    expect(say('28 greens road coorparoo').action).toBe('ask')
    expect(say('yes').action).toBe('ask')
    // THE regression: this answer used to leave the step on 'intent'.
    const afterIntent = say('Roof replacement')
    expect(afterIntent.action).toBe('ask')
    expect(afterIntent.action === 'ask' && afterIntent.step).toBe('material')
    const afterMaterial = say('Tiles but I want colorbond corrugated iron')
    expect(afterMaterial.action === 'ask' && afterMaterial.step).toBe('pitch')
    expect(say('standard').action).toBe('measure')

    // confirm_address → intent → material → pitch, each asked exactly once.
    expect(asked).toEqual(['confirm_address', 'intent', 'material', 'pitch'])
  })

  it('the same thread\'s steep answer no longer reads as standard', () => {
    // Earlier in the same thread: "A bit steeper than normal." on a
    // 3-building, $73k job — priced at the standard rate before the fix.
    const d = advanceRoofing(
      { slots: { ...GATHERED, material: 'colorbond_trimdek' }, last_step: 'pitch' },
      'A bit steeper than normal.',
    )
    expect(d.action).toBe('measure')
    expect(d.action === 'measure' && d.slots.pitch).toBe('steep')
  })
})

// SMS bodies wrap. Live 2026-07-23: "15 schfofieod\nDrive" lost everything
// after the newline — the fragment was read back, confirmed, geocoded and
// stored as the job's address.
describe('extractStreetAddress across line breaks', () => {
  it('keeps the part of the address after a newline', () => {
    expect(extractStreetAddress('15 schfofieod\nDrive')).toBe('15 schfofieod Drive')
    expect(extractStreetAddress('15 Schofield Dr\nSafety Beach NSW 2456')).toBe(
      '15 Schofield Dr Safety Beach NSW 2456',
    )
  })
})

// The building list names each structure ("1) Main dwelling", "2) Secondary
// structure 1"), so customers answer with the NAME as readily as the number.
// Live thread 2026-07-22: "Main dwelling" was not understood and the whole
// 3-building list was re-sent verbatim.
describe('structure picks by name, not just number', () => {
  it('parses the labels we ourselves printed in the list', () => {
    expect(parseStructureChoice('Main dwelling', 3)).toBe(1)
    expect(parseStructureChoice('main house', 3)).toBe(1)
    expect(parseStructureChoice('the main one', 3)).toBe(1)
    expect(parseStructureChoice('Secondary structure 1', 3)).toBe(2)
    expect(parseStructureChoice('secondary structure 2', 3)).toBe(3)
    // Live 2026-07-23: a bare "Main" re-sent the identical list.
    expect(parseStructureChoice('Main', 3)).toBe(1)
    // …but "main" as a STREET name is an address, not a pick.
    expect(parseStructureChoice('the one on main road', 3)).toBeNull()
    expect(parseStructureChoice('14 Main St', 3)).toBeNull()
    // Numbers and ordinals must keep working exactly as before.
    expect(parseStructureChoice('1', 3)).toBe(1)
    expect(parseStructureChoice('the second', 3)).toBe(2)
    expect(parseStructureChoice('nothing relevant', 3)).toBeNull()
  })

  it('does not re-send the building list when the customer names a building', () => {
    const d = advanceRoofing(
      { slots: GATHERED, last_step: 'confirm_roof', pending_quote_token: 'tok', pending_structure_count: 3 },
      'Main dwelling',
    )
    expect(d.action).toBe('send_saved')
    expect(d.action === 'send_saved' && d.structureChoices).toEqual([1])
  })
})

// Live 2026-07-22, two tenants, same address, same code. Atomic Electrical's
// customer replied YES to 3 buildings: the SMS quoted 2 of them at $115,117
// while the linked page showed the main dwelling alone at $69,652. Sparky's
// customer picked building 1, so their page matched — by coincidence, because
// one-building IS the page's fallback. The SMS never persisted the confirmed
// set, and a ?s= link cannot supply it: the page only ever narrows.
describe('confirmed structure selection is persisted, not left to the link', () => {
  it('expands "all" to every structure index', () => {
    expect(confirmedIncludedIndices(null, 3)).toEqual([1, 2, 3])
    expect(confirmedIncludedIndices(null, 1)).toEqual([1])
    expect(confirmedIncludedIndices([], 3)).toEqual([1, 2, 3])
  })

  it('keeps an explicit pick verbatim', () => {
    expect(confirmedIncludedIndices([1], 3)).toEqual([1])
    expect(confirmedIncludedIndices([2, 3], 3)).toEqual([2, 3])
  })

  const quote = {
    structures: [
      { name: 'Main dwelling' },
      { name: 'Secondary structure 1' },
      { name: 'Secondary structure 2' },
    ],
  } as unknown as Parameters<typeof resolveEffectiveIndices>[1]

  it('a ?s= link alone CANNOT widen the page — this is why persisting is required', () => {
    // What Atomic actually got: nothing persisted, link carrying 1,2.
    expect(
      resolveEffectiveIndices({ included: null, confirmedStructure: null, paramIndices: [1, 2] }, quote),
    ).toEqual([1]) // ← the bug: narrowed to the main-dwelling default
  })

  it('persisting the confirmed set makes the page match the SMS', () => {
    expect(
      resolveEffectiveIndices(
        { included: confirmedIncludedIndices(null, 3), confirmedStructure: null, paramIndices: null },
        quote,
      ),
    ).toEqual([1, 2, 3])
    // A single pick still narrows exactly as before.
    expect(
      resolveEffectiveIndices(
        { included: confirmedIncludedIndices([1], 3), confirmedStructure: 1, paramIndices: [1] },
        quote,
      ),
    ).toEqual([1])
  })
})

// Live 2026-07-22, +61401460956. Four defects compounded into a dead lead:
// the read-back was junk ("Address above postcode 4151"), two replies that
// GAVE the real address at the confirm step read as neither yes nor no, a
// bare "4151" was discarded, and "Colorblind" (phone autocorrect) plus
// "Color bond" (spaced) both failed to map. Final state: address
// "Address is 31 greens rd coorparoo", postcode null, material unknown.
describe('address correction at the confirm step', () => {
  it('strips a label prefix and keeps only the street address', () => {
    expect(applyRoofingAnswer({}, 'address', 'Address is 31 greens rd coorparoo').address)
      .toBe('31 greens rd coorparoo')
    expect(applyRoofingAnswer({}, 'address', "it's 670 London Road, Chandler, QLD, 4155").address)
      .toBe('670 London Road, Chandler, QLD, 4155')
    // Plain addresses are untouched.
    expect(applyRoofingAnswer({}, 'address', '670 London Road, Chandler, QLD, 4155').address)
      .toBe('670 London Road, Chandler, QLD, 4155')
  })

  it('rejects a reply with a postcode but no street number', () => {
    // This is the one that poisoned the whole conversation.
    expect(applyRoofingAnswer({}, 'address', 'Address above postcode 4151').address).toBeUndefined()
    expect(applyRoofingAnswer({}, 'address', 'not sure sorry').address).toBeUndefined()
  })

  it('treats a new address at the confirm step as a correction, not a yes/no', () => {
    const before: RoofingSlots = { address: 'Address above postcode 4151', address_confirmed: false }
    const after = applyRoofingAnswer(before, 'confirm_address', 'Address is 31 greens rd coorparoo')
    expect(after.address).toBe('31 greens rd coorparoo')
    expect(after.address_confirmed).toBe(false)
  })

  it('attaches a bare postcode to the address we read back', () => {
    const before: RoofingSlots = { address: '31 greens rd coorparoo', address_confirmed: false }
    const after = applyRoofingAnswer(before, 'confirm_address', '4151')
    expect(after.postcode).toBe('4151')
    expect(after.address).toContain('4151')
  })

  it('still honours a plain yes / no', () => {
    const slots: RoofingSlots = { address: '31 greens rd coorparoo', address_confirmed: false }
    expect(applyRoofingAnswer(slots, 'confirm_address', 'Yes').address_confirmed).toBe(true)
    expect(applyRoofingAnswer(slots, 'confirm_address', 'No').address).toBeNull()
  })

  it('a correction counts as progress — it must not burn the miss budget', () => {
    const d = advanceRoofing(
      { slots: { address: 'Address above postcode 4151', address_confirmed: false }, last_step: 'confirm_address' },
      'Address is 31 greens rd coorparoo',
    )
    expect(d.action).toBe('ask')
    expect(d.action === 'ask' && d.step).toBe('confirm_address')
    // The read-back must quote the CORRECTED address, not the old junk.
    expect(d.action === 'ask' && d.reply).toContain('31 greens rd coorparoo')
    expect(d.slots.misses ?? 0).toBe(0)
  })
})

describe('Colorbond spelling variants', () => {
  it('recognises the autocorrect and spaced spellings as metal', () => {
    // Not a material on their own — they name no profile — so the receptionist
    // must ask "corrugated or Trimdek?" rather than treat them as unmapped.
    expect(isAmbiguousMetal('Colorblind')).toBe(true)
    expect(isAmbiguousMetal('Color bond')).toBe(true)
    expect(isAmbiguousMetal('colour bond')).toBe(true)
    expect(mapMaterial('Colorblind')).toBeNull()
    expect(mapMaterial('Color bond')).toBeNull()
  })

  it('asks the profile question instead of falling to inspection', () => {
    const d = advanceRoofing(
      { slots: { address: '31 greens rd coorparoo', address_confirmed: true, intent: 'full_reroof' }, last_step: 'material' },
      'Colorblind',
    )
    expect(d.action).toBe('ask')
    expect(d.action === 'ask' && d.step).toBe('material_profile')
  })

  it('a named profile still maps directly', () => {
    expect(mapMaterial('Colorbond corrugated')).toBe('colorbond_corrugated')
    expect(mapMaterial('trimdek')).toBe('colorbond_trimdek')
  })
})

// Verbatim replay of the +61401460956 thread. Previously this produced a
// junk address, a discarded postcode, an unmapped material, and a dead-end
// "we couldn't measure it" inspection. It must now reach a real measurement
// with a clean, geocodable address.
describe('live transcript replay — 2026-07-22 31 greens rd', () => {
  it('recovers from the mistyped address and the autocorrected material', () => {
    let state: RoofingConversationState = { slots: {}, last_step: 'address' }
    const say = (msg: string): RoofingTurnDecision => {
      const d = advanceRoofing(state, msg)
      if (d.action === 'ask') state = { slots: d.slots, last_step: d.step }
      return d
    }

    say('Address above postcode 4151')            // junk — must be rejected
    expect(state.last_step).toBe('address')

    say('Address is 31 greens rd coorparoo')      // now a real address
    expect(state.slots.address).toBe('31 greens rd coorparoo')
    expect(state.last_step).toBe('confirm_address')

    say('4151')                                    // bare postcode completes it
    expect(state.slots.postcode).toBe('4151')

    say('Yes')
    expect(state.slots.address_confirmed).toBe(true)

    say('full re-roof')
    const material = say('Colorblind')             // autocorrect of Colorbond
    expect(material.action).toBe('ask')
    expect(material.action === 'ask' && material.step).toBe('material_profile')

    say('Corrugated')
    expect(state.slots.material).toBe('colorbond_corrugated')

    const done = say('standard')
    expect(done.action).toBe('measure')
    // The address handed to the geocoder must be clean and complete.
    expect(done.action === 'measure' && done.slots.address).toBe('31 greens rd coorparoo 4151')
  })
})

// US-006 (audit 2026-07-23) — turning roofing OFF for a tenant while a
// conversation is parked mid-flow (confirm_roof, await_booking, gathering)
// orphaned the thread: the general dialog inherited a warm roofing_state it
// cannot speak to, and re-enabling roofing later resumed a zombie flow.
describe('closeStaleRoofingState — roofing disabled mid-thread', () => {
  it('closes an active flow (mid-gather, confirm, booking, warm-quoted)', () => {
    for (const step of ['address', 'material', 'confirm_roof', 'await_booking', 'quoted'] as const) {
      const closed = closeStaleRoofingState({ slots: { address: 'x' }, last_step: step })
      expect(closed, step).not.toBeNull()
      expect(closed!.last_step).toBe('closed')
      expect(closed!.pending_quote_token ?? null).toBeNull()
    }
  })

  it('nothing to do on closed/absent state', () => {
    expect(closeStaleRoofingState(null)).toBeNull()
    expect(closeStaleRoofingState(undefined)).toBeNull()
    expect(closeStaleRoofingState({ slots: {}, last_step: 'closed' })).toBeNull()
  })
})

describe('intent unknown is gated, not priced', () => {
  it('an unknown intent routes to inspection rather than falling through to pricing', () => {
    const step = nextRoofingStep({ ...GATHERED, intent: 'unknown', material: 'colorbond_trimdek', pitch: 'standard' })
    expect(step.step).toBe('inspection')
  })
})

// B1 (CRITICAL, live 2026-07-24 S7/S8): at the intent step, "ok now can you
// price 12 Smith Street Bondi NSW 2026" produced an estimate for the
// previously-confirmed 670 London Road, not 12 Smith Street. A DIFFERENT full
// address (street + postcode) mid-gather must re-confirm the NEW property,
// never let the old confirmed address be measured.
describe('B1 — a new full address mid-gather re-confirms the new property', () => {
  const atIntent = (addr = '670 London Rd, Chandler QLD 4155') =>
    ({ slots: { address: addr, address_confirmed: true }, last_step: 'intent' as const })

  it('a different street+postcode at the intent step folds and asks to confirm the NEW address', () => {
    const d = advanceRoofing(atIntent(), 'ok now can you price 12 Smith Street Bondi NSW 2026')
    expect(d.action).toBe('ask')
    expect(d.action === 'ask' && d.step).toBe('confirm_address')
    expect(d.slots.address).toBe('12 Smith Street Bondi NSW 2026')
    expect(d.slots.address_confirmed).toBe(false)
  })

  it('a bare restatement of the SAME confirmed address is not a change (parses the intent)', () => {
    const d = advanceRoofing(atIntent(), 'full reroof at 670 London Rd')
    expect(d.action === 'ask' && d.step === 'confirm_address').toBe(false)
    if (d.action === 'ask') expect(d.slots.intent ?? null).not.toBeNull()
  })

  it('a street WITHOUT a postcode never hijacks a confirmed address', () => {
    const d = advanceRoofing(
      { slots: { address: '670 London Rd, Chandler QLD 4155', address_confirmed: true }, last_step: 'material' },
      'its the one on 5 Random St',
    )
    const hijacked = d.action === 'ask' && d.step === 'confirm_address' && d.slots.address === '5 Random St'
    expect(hijacked).toBe(false)
  })

  // B9 (S2): after a mid-flow address change the asked STEP must be
  // confirm_address (not the pre-change gather step), so the customer's "yes"
  // confirms the new address instead of being parsed as a material answer.
  it('B9: a cued address change at the material step asks confirm_address, not material', () => {
    const d = advanceRoofing(
      { slots: { address: '670 London Rd, Chandler QLD 4155', address_confirmed: true, intent: 'full_reroof' }, last_step: 'material' },
      'actually make it 15 Schofield Drive Safety Beach NSW 2456',
    )
    expect(d.action).toBe('ask')
    expect(d.action === 'ask' && d.step).toBe('confirm_address')
  })

  // B4 (S9): a stray/junk answer at a gather step must never clear the
  // confirmed address or reset the gather to "what's the address?".
  it('B4: a junk answer at the pitch step keeps the confirmed address', () => {
    const d = advanceRoofing(
      { slots: { address: '670 London Rd, Chandler QLD 4155', address_confirmed: true, intent: 'full_reroof', material: 'colorbond_corrugated' }, last_step: 'pitch' },
      'asdfghjkl',
    )
    if (d.action === 'ask') {
      expect(d.slots.address).toBe('670 London Rd, Chandler QLD 4155')
      expect(d.slots.address_confirmed).toBe(true)
      expect(d.step).not.toBe('address')
    }
  })

  // B3 (S9): a self-correction with an interrupt word ("no wait yes") at the
  // address-confirm step must stay in the roofing flow, not bail to the general
  // LLM which then asks "quick one, what's your first name?".
  it('B3: "no wait yes" at confirm_address is not handed to the general dialog', () => {
    const d = advanceRoofing(
      { slots: { address: '670 London Rd, Chandler QLD 4155', address_confirmed: false }, last_step: 'confirm_address' },
      'no wait yes',
    )
    expect(d.action).not.toBe('passthrough')
  })
})

// P3 (live 2026-07-24): a rapid burst "can you do my roof" | "670 London Road
// Chandler QLD 4155" | "its colorbond" (debounce-coalesced) engaged the general
// LLM, not the roofing receptionist, because only the LAST line ("its
// colorbond") was tested for engagement. Coalesce the burst so the opener is
// visible.
describe('latestInboundBurst — a rapid burst is coalesced for engagement', () => {
  it('joins every inbound since the last outbound so the roofing opener is seen', () => {
    const burst = latestInboundBurst([
      { direction: 'outbound', body: 'What can I help with?' },
      { direction: 'inbound', body: 'can you do my roof' },
      { direction: 'inbound', body: '670 London Road Chandler QLD 4155' },
      { direction: 'inbound', body: 'its colorbond' },
    ])
    expect(burst).toContain('can you do my roof')
    expect(burst).toContain('670 London Road')
    // The whole burst engages roofing; the last line alone would not.
    expect(shouldEngageRoofing(null, burst, false, false)).toBe(true)
    expect(shouldEngageRoofing(null, 'its colorbond', false, false)).toBe(false)
  })
  it('a single message is returned unchanged', () => {
    expect(latestInboundBurst([{ direction: 'inbound', body: 'quote my roof' }])).toBe('quote my roof')
  })
  it('empty / no inbound is the empty string', () => {
    expect(latestInboundBurst([{ direction: 'outbound', body: 'hi' }])).toBe('')
    expect(latestInboundBurst([])).toBe('')
  })
})

// Review of the P3 diff (2026-07-24): feeding the coalesced burst to
// advanceRoofing on an ACTIVE flow let a stray digit in an earlier burst line
// hijack a structure pick (money bug) and a deny token flip a booking. The
// burst is for ENGAGEMENT + the COLD opener only; an active flow parses the
// newest line alone.
describe('roofingTurnInput — burst for engagement + cold opener, last line when active', () => {
  const turns = [
    { direction: 'outbound', body: 'Is this your roof? 1) Main 2) Shed 3) Garage' },
    { direction: 'inbound', body: '1 quick question how long does it take?' },
    { direction: 'inbound', body: 'yeah just do the garage' },
  ]
  it('a cold start harvests the WHOLE burst for both engagement and the decision', () => {
    const r = roofingTurnInput(null, turns)
    expect(r.engage).toContain('1 quick question')
    expect(r.decision).toContain('1 quick question')
    expect(r.decision).toContain('yeah just do the garage')
  })
  it('an active confirm_roof engages on the burst but decides on the newest line only', () => {
    const r = roofingTurnInput('confirm_roof', turns)
    expect(r.engage).toContain('1 quick question') // engagement still sees the whole burst
    expect(r.decision).toBe('yeah just do the garage') // no stray "1" to mis-pick
  })
  it('a closed flow counts as a cold start (fresh enquiry harvests the burst)', () => {
    expect(roofingTurnInput('closed', turns).decision).toContain('1 quick question')
  })
})

// U4 (2026-07-24) — determinism pin. Once the debounce window has captured the
// burst (turns hold every line), a cold-start decision must ALWAYS contain the
// address line regardless of where it sits in the burst — the coalescing layer
// is order-independent. The live scenario-runner S4/S11 proves the debounce
// window itself captured the burst end-to-end; this pins the pure layer.
describe('roofingTurnInput — cold-start burst always harvests the address (U4)', () => {
  const opener = { direction: 'inbound', body: 'can you do my roof' }
  const addr = { direction: 'inbound', body: '670 London Road Chandler QLD 4155' }
  const noise = { direction: 'inbound', body: 'thanks heaps mate' }
  for (const order of [
    [opener, addr, noise],
    [addr, opener, noise],
    [opener, noise, addr],
  ]) {
    it(`harvests the address from burst order [${order.map(t => t.body.slice(0, 10)).join(' | ')}]`, () => {
      expect(roofingTurnInput(null, order).decision).toContain('670 London Road')
    })
  }
})

// Live 2026-07-24 (QM Sparky): a confirm_roof parked on a measurement from a
// PREVIOUS session ("3 buildings at 670 London Road") was reused hours later
// and replayed that exact list on the next "Hi Mate", then again on a brand
// new address, then again on "Hey" — an agent stuck waiting, replaying stale
// data. A flow left idle beyond the threshold must be treated as stale.
describe('expireIdleRoofingState — a parked flow left idle is stale', () => {
  const HOUR = 60 * 60 * 1000
  // ONLY the steps that REPLAY a saved measurement on resume go stale:
  // confirm_roof ("is this your roof? 3 buildings…") and the warm 'quoted'
  // thread (a follow-up re-serves the saved quote).
  it('closes a stale-replay flow (confirm_roof, quoted) idle beyond the threshold', () => {
    for (const step of ['confirm_roof', 'quoted'] as const) {
      const expired = expireIdleRoofingState(
        { slots: { address: 'x' }, last_step: step, pending_quote_token: 't', pending_structure_count: 3 },
        3 * HOUR,
      )
      expect(expired, step).not.toBeNull()
      expect(expired!.last_step).toBe('closed')
      expect(expired!.pending_quote_token ?? null).toBeNull()
    }
  })
  // await_booking must SURVIVE idle: expiring it would drop a genuine late "yes
  // book it" (no booking, no tradie notify) — the exact lead-loss the 2026-07-23
  // hardening fixed.
  it('does NOT expire await_booking — a late "yes book it" must still book', () => {
    expect(
      expireIdleRoofingState({ slots: { address: 'x' }, last_step: 'await_booking' }, 3 * HOUR),
    ).toBeNull()
  })
  // F8 (live 2026-07-24): a mid-gather flow resumed hours later measured the
  // STALE address. A half-finished gather idle beyond the window is stale too.
  it('DOES expire a mid-gather step idle beyond the window (F8)', () => {
    for (const step of ['address', 'confirm_address', 'intent', 'material', 'pitch'] as const) {
      expect(
        expireIdleRoofingState({ slots: { address: 'x' }, last_step: step }, 3 * HOUR)?.last_step,
        step,
      ).toBe('closed')
    }
  })
  it('leaves a still-fresh confirm_roof untouched (idle under the threshold)', () => {
    expect(
      expireIdleRoofingState({ slots: { address: 'x' }, last_step: 'confirm_roof' }, 5 * 60 * 1000),
    ).toBeNull()
  })
  it('nothing to expire on a closed/absent flow', () => {
    expect(expireIdleRoofingState(null, 10 * HOUR)).toBeNull()
    expect(expireIdleRoofingState(undefined, 10 * HOUR)).toBeNull()
    expect(expireIdleRoofingState({ slots: {}, last_step: 'closed' }, 10 * HOUR)).toBeNull()
  })
})

// The other half of the same incident: WITHIN a live session, a fresh enquiry
// or a new address at confirm_roof must RESTART the gather, never re-send the
// old "is this your roof?" list. Bare picks / yes / no must still work.
describe('confirm_roof — fresh enquiry restarts, picks still serve', () => {
  const parked: RoofingConversationState = {
    slots: { address: '670 London Road' },
    last_step: 'confirm_roof',
    pending_quote_token: 't',
    pending_structure_count: 3,
  }

  it('a roofing keyword + new address restarts (asks the new address), never reconfirm', () => {
    const d = advanceRoofing(parked, 'I want to do a roofing my address is 223 Archer St, Chandler QLD 4154')
    expect(d.action).toBe('ask')
    expect(d.action === 'ask' && d.step).toBe('confirm_address')
    expect(d.slots.address).toBe('223 Archer St, Chandler QLD 4154')
  })

  it('a bare new address carrying a postcode restarts, even with no keyword', () => {
    const d = advanceRoofing(parked, '223 Archer St, Chandler QLD 4154')
    expect(d.action).toBe('ask')
    expect(d.action === 'ask' && d.step).toBe('confirm_address')
  })

  it('a bare structure pick still serves that structure (no false restart)', () => {
    const d = advanceRoofing(parked, '2')
    expect(d.action).toBe('send_saved')
    expect(d.action === 'send_saved' && d.structureChoices).toEqual([2])
  })

  it('a multi-pick "2 and 3" still serves both (not read as a new address)', () => {
    const d = advanceRoofing(parked, '2 and 3')
    expect(d.action).toBe('send_saved')
    expect(d.action === 'send_saved' && d.structureChoices).toEqual([2, 3])
  })

  it('plain yes serves all; plain no re-asks the address', () => {
    expect(advanceRoofing(parked, 'yes').action).toBe('send_saved')
    const no = advanceRoofing(parked, 'no')
    expect(no.action).toBe('ask')
    expect(no.action === 'ask' && no.step).toBe('address')
  })

  // An affirmation that happens to echo the job's roofing vocabulary, or that
  // carries a stray number (a build year), is still a YES — it must serve the
  // saved measurement, not wipe it and restart. The restart is gated on a REAL
  // new address (street + postcode), not any keyword or 4-digit token.
  it('an affirmation echoing roofing words / a stray year still serves the quote', () => {
    expect(advanceRoofing(parked, 'yeah do the re-roof').action).toBe('send_saved')
    expect(advanceRoofing(parked, 'yes new roof please').action).toBe('send_saved')
    expect(advanceRoofing(parked, 'yes it was built in 1990').action).toBe('send_saved')
  })
})

// Live 2026-07-24 (Atomic): after a 670 London Rd quote, the customer sent
// "Ok can you price 652 London Rd Chandler QLD 4155" — a DIFFERENT property.
// looksLikeRoofingEnquiry is false ("price", no roof keyword), so the warm
// 'quoted' thread passed it to the general LLM, which faked "pulling up the
// property details" and never measured 652; the customer still saw the old
// 670 buildings. A new address must reopen the roofing gather, same as the
// confirm_roof restart.
describe('quoted thread — a new address reopens roofing, not a hollow LLM handoff', () => {
  const quoted: RoofingConversationState = {
    slots: {},
    last_step: 'quoted',
    pending_quote_token: 't',
    pending_structure_count: 3,
    last_served_structures: [1],
  }
  it('a new address (street + postcode) reopens the gather for that property', () => {
    const d = advanceRoofing(quoted, 'Ok can you price 652 London Rd Chandler QLD 4155')
    expect(d.action).toBe('ask')
    expect(d.action === 'ask' && d.step).toBe('confirm_address')
    expect(d.slots.address).toBe('652 London Rd Chandler QLD 4155')
  })
  it('a structure follow-up still re-serves the saved measurement', () => {
    expect(advanceRoofing(quoted, '2 and 3').action).toBe('send_saved')
  })
  it('a keyword enquiry still reopens; an unrelated message still passes through', () => {
    expect(advanceRoofing(quoted, 'can you quote another re-roof').action).toBe('ask')
    expect(advanceRoofing(quoted, 'how much for 6 downlights?').action).toBe('passthrough')
  })
})

// F4 (live 2026-07-24): a burst "opener | 670 London Rd | thanks" while at the
// address step dropped the address (decision used only the last line "thanks").
describe('roofingTurnInput harvests the burst address at the address step (F4)', () => {
  const burst = [
    { direction: 'inbound', body: 'can you do my roof' },
    { direction: 'outbound', body: "What's the property address?" },
    { direction: 'inbound', body: '670 London Road Chandler QLD 4155' },
    { direction: 'inbound', body: 'thanks heaps mate' },
  ]
  it('the decision includes the address even when it is not the last line', () => {
    expect(roofingTurnInput('address', burst).decision).toContain('670 London Road')
    expect(roofingTurnInput('confirm_address', burst).decision).toContain('670 London Road')
  })
  it('a pick/booking step still uses the last line only (anti-hijack preserved)', () => {
    const pick = [
      { direction: 'outbound', body: 'which building? 1) main 2) shed' },
      { direction: 'inbound', body: '1 quick question' },
      { direction: 'inbound', body: 'just the shed thanks' },
    ]
    expect(roofingTurnInput('confirm_roof', pick).decision).toBe('just the shed thanks')
  })
})

// F8 (live 2026-07-24): a mid-gather flow idle 2h resumed and measured the stale
// address. Mid-gather steps must expire; await_booking must NOT (late yes books).
describe('expireIdleRoofingState covers mid-gather steps (F8)', () => {
  const twoH = 2 * 60 * 60 * 1000
  it('a mid-gather step idle beyond the window is expired to closed', () => {
    for (const step of ['address', 'confirm_address', 'intent', 'material', 'pitch'] as const) {
      const out = expireIdleRoofingState({ slots: { address: '670 London Rd' }, last_step: step }, twoH)
      expect(out?.last_step).toBe('closed')
    }
  })
  it('await_booking is NOT expired (a late "yes book it" must still book)', () => {
    expect(expireIdleRoofingState({ slots: {}, last_step: 'await_booking' }, twoH)).toBeNull()
  })
  it('within the idle window nothing expires', () => {
    expect(expireIdleRoofingState({ slots: {}, last_step: 'intent' }, 5 * 60 * 1000)).toBeNull()
  })
})

// F7/F13 (live 2026-07-24): at the intent step, answering with material/pitch
// looped "What do you need done?" forever because the out-of-order fold reset
// the intent miss counter, so the inspection fallback never fired.
describe('intent step does not loop forever on out-of-order answers (F7/F13)', () => {
  const start: RoofingConversationState = {
    slots: { address: '670 London Rd, Chandler QLD 4155', postcode: '4155', address_confirmed: true },
    last_step: 'intent',
  }
  it('material then pitch at the intent step terminates (not still asking intent)', () => {
    const d1 = advanceRoofing(start, 'colorbond corrugated')
    const next1: RoofingConversationState = { slots: d1.slots, last_step: 'intent' }
    const d2 = advanceRoofing(next1, 'standard')
    expect(d2.action === 'ask' && (d2 as { step?: string }).step === 'intent').toBe(false)
  })
  it('a valid intent still advances (no false inspection)', () => {
    const d = advanceRoofing(start, 'full reroof')
    expect(d.action).toBe('ask')
    expect((d as { step?: string }).step).not.toBe('intent')
  })
})

// F6 (live 2026-07-24): a topic switch bailed to the general LLM but left the
// roofing_state active, so the next message bounced back to the roofing intent.
describe('topic switch closes the roofing gather (F6)', () => {
  const gathering: RoofingConversationState = {
    slots: { address: '670 London Rd, Chandler QLD 4155', address_confirmed: true },
    last_step: 'intent',
  }
  it('a topic switch to another trade returns passthrough with close=true', () => {
    const d = advanceRoofing(gathering, 'also can you fix a leaking tap')
    expect(d.action).toBe('passthrough')
    expect((d as { close?: boolean }).close).toBe(true)
  })
  it('an interrupt/question bail does not close (customer may resume roofing)', () => {
    const d = advanceRoofing(gathering, 'wait what do you need from me?')
    if (d.action === 'passthrough') expect((d as { close?: boolean }).close).toBeFalsy()
  })
})
