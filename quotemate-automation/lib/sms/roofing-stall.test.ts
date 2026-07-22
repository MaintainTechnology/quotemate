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
  isAmbiguousMetal,
  mapMaterial,
  mapPitch,
  mapIntent,
  nextRoofingStep,
  type RoofingSlots,
} from './roofing-intake'
import {
  advanceRoofing,
  confirmedIncludedIndices,
  parseStructureChoice,
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

describe('intent unknown is gated, not priced', () => {
  it('an unknown intent routes to inspection rather than falling through to pricing', () => {
    const step = nextRoofingStep({ ...GATHERED, intent: 'unknown', material: 'colorbond_trimdek', pitch: 'standard' })
    expect(step.step).toBe('inspection')
  })
})
