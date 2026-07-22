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
import { mapMaterial, mapPitch, mapIntent, nextRoofingStep, type RoofingSlots } from './roofing-intake'
import { advanceRoofing, type RoofingConversationState, type RoofingTurnDecision } from './roofing-receptionist'

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

describe('intent unknown is gated, not priced', () => {
  it('an unknown intent routes to inspection rather than falling through to pricing', () => {
    const step = nextRoofingStep({ ...GATHERED, intent: 'unknown', material: 'colorbond_trimdek', pitch: 'standard' })
    expect(step.step).toBe('inspection')
  })
})
