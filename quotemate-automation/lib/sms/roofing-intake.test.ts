// SMS roofing receptionist — pure intake state machine tests.

import { describe, expect, it } from 'vitest'
import {
  applyRoofingAnswer,
  extractStreetAddress,
  isAffirmative,
  isNegative,
  isStopRequest,
  looksLikeRoofingEnquiry,
  isAmbiguousMetal,
  mapIntent,
  mapMaterial,
  mapPitch,
  nextRoofingStep,
  parseAuState,
  parsePostcode,
  parseYearBuilt,
  roofingReadiness,
  seedRoofingSlots,
  toRoofingRequest,
  type RoofingSlots,
} from './roofing-intake'

describe('isStopRequest', () => {
  it('catches explicit stop/cancel/opt-out and clear frustration', () => {
    for (const s of ['STOP PLEASE', 'cancel', "let's cancel now", 'unsubscribe', 'not interested', 'leave me alone', 'FUCK NO!', 'just stop this session', 'nevermind']) {
      expect(isStopRequest(s)).toBe(true)
    }
  })
  it('does NOT treat a bare yes/no or a normal address as a stop', () => {
    for (const s of ['yes', 'no', 'yeah thats right', '670 London Rd, Chandler QLD 4155', 'colorbond', 'standard']) {
      expect(isStopRequest(s)).toBe(false)
    }
  })
  // F11 (live 2026-07-24): "will the old roof stop leaking after this?" cancelled
  // the thread. "stop leaking"/"stop the leak" is a roofing outcome, not an opt-out.
  it('does NOT cancel when "stop" is asking to stop a roofing problem', () => {
    for (const s of [
      'will the old roof stop leaking after this?',
      'can you make it stop leaking',
      'how do we stop the leak',
      'stop the roof leaking please',
    ]) {
      expect(isStopRequest(s)).toBe(false)
    }
  })
  it('still catches genuine opt-outs incl. embedded cancel/stop', () => {
    for (const s of ['stop', 'STOP', 'stop please', 'please stop', "let's cancel now", 'just stop this session', 'unsubscribe', 'cancel']) {
      expect(isStopRequest(s)).toBe(true)
    }
  })
})

describe('applyRoofingAnswer address validation', () => {
  it('ignores a reply with no street number (does not store junk as address)', () => {
    expect(applyRoofingAnswer({}, 'address', 'somewhere in town').address).toBeUndefined()
    expect(applyRoofingAnswer({}, 'address', "let's cancel now").address).toBeUndefined()
  })
  it('accepts a real address with a street number', () => {
    expect(applyRoofingAnswer({}, 'address', '5 Smith St, Bondi NSW 2026').address).toBe('5 Smith St, Bondi NSW 2026')
  })
})

// G1 (live 2026-07-25): "$1 at 670 London Road…" made extraction grab
// "1 at 670…" because it started at the FIRST digit run.
describe('extractStreetAddress ignores a spurious leading number (G1)', () => {
  it('starts at the number that begins a plausible street', () => {
    expect(extractStreetAddress('$1 at 670 London Road Chandler QLD 4155')).toBe('670 London Road Chandler QLD 4155')
    expect(extractStreetAddress('call me on 0412 345 678, its 12 Smith St Bondi NSW 2026'))
      .toContain('12 Smith St')
  })
  // Live 2026-07-27 (G9): the raw payload was stored as the address and echoed
  // verbatim in a customer SMS ("inspection of 670 London Rd'; DROP TABLE
  // quotes;-- <script>alert(1)</script> Chandler QLD 4155"), which also carries
  // it into the tradie job sheet and dashboard. No real AU address contains
  // ; < or >, so the address stops there.
  it('truncates at characters no AU address contains (injection payload)', () => {
    const out = extractStreetAddress("670 London Rd'; DROP TABLE quotes;-- <script>alert(1)</script> Chandler QLD 4155")
    expect(out).toBe('670 London Rd')
    expect(out).not.toMatch(/[<>;]/)
    expect(extractStreetAddress('12 Smith St <b>bold</b> Bondi')).toBe('12 Smith St')
  })
  it('keeps punctuation that real addresses use', () => {
    expect(extractStreetAddress("5 O'Connor St, Bondi NSW 2026")).toBe("5 O'Connor St, Bondi NSW 2026")
    expect(extractStreetAddress('3/50 Connor St, Kangaroo Point QLD 4169')).toBe('3/50 Connor St, Kangaroo Point QLD 4169')
  })
  it('does not regress normal or unit addresses', () => {
    expect(extractStreetAddress('223 Archer St, Chandler')).toBe('223 Archer St, Chandler')
    expect(extractStreetAddress('3/50 Connor St Kangaroo Point QLD 4169')).toBe('3/50 Connor St Kangaroo Point QLD 4169')
    expect(extractStreetAddress('670 London Road Chandler QLD 4155')).toBe('670 London Road Chandler QLD 4155')
  })
})

// F15c (live 2026-07-24): at confirm_address "not quite right" CONFIRMED the
// address (bare "right" matched AFFIRM, no DENY token) and advanced to intent,
// measuring the wrong roof. A negation cue must block the confirm and re-ask.
describe('applyRoofingAnswer confirm_address is conservative on negation (F15c)', () => {
  const slots = { address: '12 Smith St, Surry Hills NSW 2010', postcode: '2010', address_confirmed: false }
  it('a negated affirm re-asks the address, never confirms', () => {
    for (const neg of ['not quite right', 'not correct', "isn't right", 'not sure', "that's not the right one"]) {
      const out = applyRoofingAnswer(slots, 'confirm_address', neg)
      expect(out.address_confirmed).not.toBe(true)
      expect(out.address).toBeNull()
    }
  })
  it('a plain affirm still confirms', () => {
    for (const yes of ['yes', 'yep thats right', 'correct', 'ok']) {
      const out = applyRoofingAnswer(slots, 'confirm_address', yes)
      expect(out.address_confirmed).toBe(true)
      expect(out.address).toBe('12 Smith St, Surry Hills NSW 2010')
    }
  })
  // Review: NEGATION_CUE must not trip on the trailing "nt" of ordinary
  // address-confirm words (apartment/front/point) — only real negations.
  it('confirms an affirm containing an "nt"-ending word (apartment/front)', () => {
    for (const yes of ["yep that's the apartment", "yes it's the one out the front", 'yes at that point']) {
      const out = applyRoofingAnswer(slots, 'confirm_address', yes)
      expect(out.address_confirmed).toBe(true)
    }
  })
  it('an explicit deny still clears (F15a/F15b unchanged)', () => {
    for (const no of ['no that isn\'t correct', "that's wrong yeah", 'no']) {
      const out = applyRoofingAnswer(slots, 'confirm_address', no)
      expect(out.address).toBeNull()
    }
  })
})

describe('looksLikeRoofingEnquiry', () => {
  it('matches clear roofing terms', () => {
    expect(looksLikeRoofingEnquiry('I need a re-roof quote')).toBe(true)
    expect(looksLikeRoofingEnquiry('my gutter is falling off')).toBe(true)
    expect(looksLikeRoofingEnquiry('leaking roof after the storm')).toBe(true)
    expect(looksLikeRoofingEnquiry('need the ridge caps repointed')).toBe(true)
    expect(looksLikeRoofingEnquiry('quote to replace my roof')).toBe(true)
  })
  // Live 2026-07-22: this exact message went to the ELECTRICAL dialog,
  // which then asked for the address, hallucinated a suburb correction,
  // and only handed over to roofing three turns later — where the whole
  // intake restarted. Root cause was `\bquote\b` failing to match
  // "quoted": the verb list held exact words, not stems.
  it('matches inflected work verbs (the 2026-07-22 production miss)', () => {
    expect(looksLikeRoofingEnquiry('Can you quoted my roof.')).toBe(true)
    expect(looksLikeRoofingEnquiry('quoting my roof')).toBe(true)
    expect(looksLikeRoofingEnquiry('replacing the roof')).toBe(true)
    expect(looksLikeRoofingEnquiry('estimating a roof job')).toBe(true)
    expect(looksLikeRoofingEnquiry('how much to do my roof')).toBe(true)
    expect(looksLikeRoofingEnquiry('what would my roof cost')).toBe(true)
    expect(looksLikeRoofingEnquiry('i need my roof done')).toBe(true)
  })
  // "roofer" is a tradesperson noun — never incidental, so no work verb
  // is required alongside it.
  it('matches the bare tradesperson noun', () => {
    expect(looksLikeRoofingEnquiry('need a roofer')).toBe(true)
    expect(looksLikeRoofingEnquiry('roofer?')).toBe(true)
    expect(looksLikeRoofingEnquiry('do you have roofers')).toBe(true)
  })
  // G6 (live 2026-07-25): "MY ROOF IS COLLAPSING RIGHT NOW" fell to the general
  // electrical dialog because the emergency/damage vocabulary was missing.
  it('engages on a roof emergency / storm damage', () => {
    expect(looksLikeRoofingEnquiry('MY ROOF IS COLLAPSING RIGHT NOW help me')).toBe(true)
    expect(looksLikeRoofingEnquiry('my roof is caving in')).toBe(true)
    expect(looksLikeRoofingEnquiry('theres a hole in my roof')).toBe(true)
    expect(looksLikeRoofingEnquiry('roof blew off in the storm')).toBe(true)
    expect(looksLikeRoofingEnquiry('tree came through the roof')).toBe(true)
    expect(looksLikeRoofingEnquiry('my roof is sagging')).toBe(true)
  })
  it('does not trip on incidental "roof" in an electrical context', () => {
    expect(looksLikeRoofingEnquiry('the downlight near the roof cavity flickers')).toBe(false)
    expect(looksLikeRoofingEnquiry('I need 6 downlights')).toBe(false)
  })
  // F14 (live 2026-07-24): "quote painting my gutters, eaves and fascia" engaged
  // roofing via the gutter/eaves/fascia keywords. An explicit paint job with no
  // strong roofing-replacement term is NOT a roofing enquiry.
  it('does not hijack an explicit painting enquiry', () => {
    expect(looksLikeRoofingEnquiry('hi can you quote painting my gutters, eaves and fascia')).toBe(false)
    expect(looksLikeRoofingEnquiry('paint my fascia and gutters')).toBe(false)
    expect(looksLikeRoofingEnquiry('repaint the eaves')).toBe(false)
  })
  it('keeps a roofing job that merely mentions paint', () => {
    expect(looksLikeRoofingEnquiry('reroof, no paint needed')).toBe(true)
    expect(looksLikeRoofingEnquiry('new roof and paint the gutters after')).toBe(true)
  })
  // F14 review: a roofing repair/restoration lead that co-mentions paint must
  // NOT be dropped to painting when a roof-specific term is present.
  it('keeps a roof repair/restoration lead that co-mentions paint', () => {
    expect(looksLikeRoofingEnquiry('my roof needs repainting and the gutters are rusted')).toBe(true)
    expect(looksLikeRoofingEnquiry("roof leaking, fix it don't repaint")).toBe(true)
    expect(looksLikeRoofingEnquiry('roof restoration and repaint the eaves')).toBe(true)
  })
  // The broadened verb list must not leak into other trades: these all
  // carry a work word AND the token "roof", but the roof is a LOCATION.
  it('does not trip when the roof is a location, not the job', () => {
    expect(looksLikeRoofingEnquiry('need a new light in the roof')).toBe(false)
    expect(looksLikeRoofingEnquiry('replace the old wiring in the roof space')).toBe(false)
    expect(looksLikeRoofingEnquiry('fix the pipe under the roof')).toBe(false)
    expect(looksLikeRoofingEnquiry('the fan in the roof cavity needs replacing')).toBe(false)
  })
  it('is empty-safe', () => {
    expect(looksLikeRoofingEnquiry('')).toBe(false)
  })
})

// Live 2026-07-22: the customer gave "1434 NUMINBAH Road Chillingham NSW
// 2484" to the general dialog and confirmed it, then roofing engaged a
// couple of turns later, started from empty slots, and asked for the same
// address again — and made them confirm it a second time.
describe('seedRoofingSlots', () => {
  const general = { address: '1434 Numinbah Road', suburb: 'Chillingham NSW 2484' }

  it('carries a dialog-collected address into a cold roofing flow', () => {
    const s = seedRoofingSlots({}, general)
    expect(s.address).toContain('1434 Numinbah Road')
    expect(s.postcode).toBe('2484')
    expect(s.state).toBe('NSW')
  })

  // Confirmed to the DIALOG, not to us. Read it back exactly once.
  it('leaves the address unconfirmed so exactly one read-back happens', () => {
    const s = seedRoofingSlots({}, general)
    expect(s.address_confirmed).toBe(false)
    const step = nextRoofingStep(s)
    expect(step.step).toBe('confirm_address')
    expect(step.question).toContain('1434 Numinbah Road')
  })

  it('never overwrites an address the roofing flow already owns', () => {
    const existing: RoofingSlots = { address: '670 London Rd, Chandler QLD 4155', address_confirmed: true }
    expect(seedRoofingSlots(existing, general)).toEqual(existing)
  })

  it('is a no-op when there is nothing addressable', () => {
    expect(seedRoofingSlots({}, null)).toEqual({})
    expect(seedRoofingSlots({}, {})).toEqual({})
    // A suburb with no street number cannot be measured — ask properly.
    expect(seedRoofingSlots({}, { suburb: 'Chillingham NSW 2484' }).address).toBeUndefined()
  })
})

describe('mapMaterial', () => {
  // A bare "Colorbond"/"metal" names no profile. Guessing one quoted a roof
  // the customer never described — the SMS twin of the dashboard bug where a
  // tradie's Corrugated came back as Trimdek. Unresolved → ask which profile.
  it('does not guess a profile from a generic metal answer', () => {
    for (const s of ['colorbond', 'metal roof', 'tin', 'zincalume', 'colourbond']) {
      expect(mapMaterial(s)).toBeNull()
      expect(isAmbiguousMetal(s)).toBe(true)
    }
  })
  it('still maps an explicitly named profile', () => {
    expect(mapMaterial('trimdek')).toBe('colorbond_trimdek')
    expect(mapMaterial('colorbond trimdek')).toBe('colorbond_trimdek')
  })
  // Live 2026-07-22: the customer answered the profile question with
  // "Classic" — the very word that question uses for Corrugated ("the
  // classic wavy sheets") — and got material='unknown', which forced an
  // on-site inspection for an ordinary Colorbond roof. Any word the
  // QUESTION teaches must map, or we punish the customer for using it.
  it('maps the vocabulary our own profile question teaches', () => {
    for (const s of ['classic', 'Classic', 'the classic wavy sheets', 'wavy', 'wavy ones', 'ripple']) {
      expect(mapMaterial(s)).toBe('colorbond_corrugated')
    }
    for (const s of ['flat panels', 'square ribs', 'flat panel with square rib']) {
      expect(mapMaterial(s)).toBe('colorbond_trimdek')
    }
  })
  it('treats the question\'s own profile words as unambiguous', () => {
    for (const s of ['classic', 'wavy', 'flat panels', 'square ribs']) {
      expect(isAmbiguousMetal(s)).toBe(false)
    }
    // ...and still resolves when prefixed with the generic brand name.
    expect(mapMaterial('colorbond classic')).toBe('colorbond_corrugated')
    expect(isAmbiguousMetal('colorbond classic')).toBe(false)
  })
  it('does not treat a named profile or a tile answer as ambiguous', () => {
    for (const s of ['corrugated', 'trimdek', 'spandek', 'klip-lok', 'terracotta tiles', 'fibro']) {
      expect(isAmbiguousMetal(s)).toBe(false)
    }
  })
  it('asks which profile after a generic metal answer, then prices it', () => {
    const base: RoofingSlots = {
      address: '670 London Rd, Chandler QLD 4155',
      address_confirmed: true,
      intent: 'full_reroof',
    }
    // "Colorbond" alone → we understood it's metal, but not which profile.
    const asked = applyRoofingAnswer(base, 'material', 'colorbond')
    expect(asked.material).toBeFalsy()
    expect(asked.metal_hint).toBe(true)

    const step = nextRoofingStep(asked)
    expect(step.step).toBe('material_profile')
    expect(step.question).toMatch(/corrugated/i)
    expect(step.question).toMatch(/trimdek/i)

    // Their answer to THAT question resolves the profile.
    const resolved = applyRoofingAnswer(asked, 'material_profile', 'corrugated')
    expect(resolved.material).toBe('colorbond_corrugated')
    expect(nextRoofingStep(resolved).step).toBe('pitch')
  })
  it('routes to inspection rather than guessing when the profile stays unclear', () => {
    const asked: RoofingSlots = {
      address: '670 London Rd, Chandler QLD 4155',
      address_confirmed: true,
      intent: 'full_reroof',
      metal_hint: true,
    }
    // Still no profile named on the second go — never guess, look on site.
    const stuck = applyRoofingAnswer(asked, 'material_profile', 'colorbond')
    expect(stuck.material).toBe('unknown')
    expect(nextRoofingStep(stuck).step).toBe('inspection')
    expect(roofingReadiness({ ...stuck, pitch: 'standard' })).toBe('inspection')
  })
  it('maps corrugated synonyms to colorbond_corrugated', () => {
    for (const s of ['corrugated', 'corro', 'custom orb', 'corrugated iron']) {
      expect(mapMaterial(s)).toBe('colorbond_corrugated')
    }
  })
  it('maps spandek to colorbond_spandek', () => {
    expect(mapMaterial('spandek')).toBe('colorbond_spandek')
    expect(mapMaterial('span deck roof')).toBe('colorbond_spandek')
  })
  it('maps klip-lok / standing seam to colorbond_kliplok', () => {
    expect(mapMaterial('klip-lok')).toBe('colorbond_kliplok')
    expect(mapMaterial('standing seam metal')).toBe('colorbond_kliplok')
  })
  it('maps terracotta and concrete tiles distinctly', () => {
    expect(mapMaterial('terracotta tiles')).toBe('terracotta_tile')
    expect(mapMaterial('concrete tile')).toBe('concrete_tile')
  })
  it('maps generic "tiles" to concrete_tile (AU default)', () => {
    expect(mapMaterial('just tiles')).toBe('concrete_tile')
  })
  it('flags asbestos/fibro/cement sheet — safety wins over any metal token', () => {
    expect(mapMaterial('fibro')).toBe('cement_sheet')
    expect(mapMaterial('asbestos cement sheet')).toBe('cement_sheet')
    expect(mapMaterial('super six')).toBe('cement_sheet')
  })
  it("returns 'unknown' when the customer can't tell", () => {
    expect(mapMaterial('not sure')).toBe('unknown')
    expect(mapMaterial("dunno really")).toBe('unknown')
  })
  it('returns null on an unrecognised answer (re-ask)', () => {
    expect(mapMaterial('it is blue')).toBeNull()
    expect(mapMaterial('')).toBeNull()
  })
})

describe('mapPitch', () => {
  it('maps the buckets', () => {
    expect(mapPitch('pretty flat')).toBe('shallow')
    expect(mapPitch('standard')).toBe('standard')
    expect(mapPitch('average really')).toBe('standard')
    expect(mapPitch('quite steep')).toBe('steep')
    expect(mapPitch('very steep')).toBe('very_steep')
  })
  it("returns 'unknown' on unsure, null on gibberish", () => {
    expect(mapPitch('no idea')).toBe('unknown')
    expect(mapPitch('purple')).toBeNull()
  })
})

describe('mapIntent', () => {
  it('maps the job intents', () => {
    expect(mapIntent('whole roof needs doing')).toBe('full_reroof')
    expect(mapIntent('replace the roof')).toBe('full_reroof')
    expect(mapIntent("it's leaking")).toBe('leak_trace')
    expect(mapIntent('new gutters')).toBe('gutter_replace')
    expect(mapIntent('ridge caps need repointing')).toBe('ridge_cap')
    expect(mapIntent('flashing repair')).toBe('flashing_repair')
    expect(mapIntent('a few broken tiles to fix')).toBe('patch_repair')
  })
  it('maps "re roof" / "re-roof" / "reroof" incl. space-separated (voice STT)', () => {
    // Speech-to-text transcribes "re-roof" as "re roof" with a space; the
    // regex used to require the hyphen/joined form, so a full-re-roof call
    // dropped its intent and got re-asked by text.
    expect(mapIntent('full re roof')).toBe('full_reroof')
    expect(mapIntent('re roof')).toBe('full_reroof')
    expect(mapIntent('re-roof')).toBe('full_reroof')
    expect(mapIntent('reroof')).toBe('full_reroof')
  })
  it('returns null when nothing matches', () => {
    expect(mapIntent('hello there')).toBeNull()
  })
})

describe('parseYearBuilt / parsePostcode / parseAuState', () => {
  it('extracts explicit years and decades, ignores relative ages', () => {
    expect(parseYearBuilt('built in 1985')).toBe(1985)
    expect(parseYearBuilt('1970s home')).toBe(1970)
    expect(parseYearBuilt('about 30 years old')).toBeNull()
    expect(parseYearBuilt('3012')).toBeNull() // out of range
  })
  it('extracts postcode + state', () => {
    expect(parsePostcode('670 London Rd, Chandler QLD 4155')).toBe('4155')
    expect(parseAuState('670 London Rd, Chandler QLD 4155')).toBe('QLD')
    expect(parseAuState('no state here')).toBeNull()
  })
})

describe('isAffirmative / isNegative', () => {
  it('reads yes/no', () => {
    expect(isAffirmative('yes thats right')).toBe(true)
    expect(isNegative('no thats wrong')).toBe(true)
    expect(isAffirmative('maybe')).toBe(false)
  })
})

function freshThrough(messages: Array<string>): RoofingSlots {
  // Drive the machine: at each turn, ask nextRoofingStep, apply the answer.
  let slots: RoofingSlots = {}
  for (const m of messages) {
    const { step } = nextRoofingStep(slots)
    if (step === 'ready' || step === 'inspection') break
    slots = applyRoofingAnswer(slots, step, m)
  }
  return slots
}

describe('nextRoofingStep — gathering order', () => {
  it('asks address → confirm → intent → material → pitch → ready', () => {
    let slots: RoofingSlots = {}
    expect(nextRoofingStep(slots).step).toBe('address')

    slots = applyRoofingAnswer(slots, 'address', '670 London Rd, Chandler QLD 4155')
    expect(nextRoofingStep(slots).step).toBe('confirm_address')
    expect(nextRoofingStep(slots).question).toMatch(/670 London Rd/)

    slots = applyRoofingAnswer(slots, 'confirm_address', 'yes')
    expect(nextRoofingStep(slots).step).toBe('intent')

    slots = applyRoofingAnswer(slots, 'intent', 'full re-roof')
    expect(nextRoofingStep(slots).step).toBe('material')

    // Bare "colorbond" names no profile → one targeted follow-up first.
    slots = applyRoofingAnswer(slots, 'material', 'colorbond')
    expect(nextRoofingStep(slots).step).toBe('material_profile')

    slots = applyRoofingAnswer(slots, 'material_profile', 'corrugated')
    expect(nextRoofingStep(slots).step).toBe('pitch')

    slots = applyRoofingAnswer(slots, 'pitch', 'standard')
    expect(nextRoofingStep(slots).step).toBe('ready')
  })

  it('goes straight to pitch when the material answer already names a profile', () => {
    let slots: RoofingSlots = {}
    slots = applyRoofingAnswer(slots, 'address', '670 London Rd, Chandler QLD 4155')
    slots = applyRoofingAnswer(slots, 'confirm_address', 'yes')
    slots = applyRoofingAnswer(slots, 'intent', 'full re-roof')
    slots = applyRoofingAnswer(slots, 'material', 'corrugated iron')
    expect(slots.material).toBe('colorbond_corrugated')
    expect(nextRoofingStep(slots).step).toBe('pitch')
  })

  it('re-asks the address when the customer says the read-back is wrong', () => {
    let slots: RoofingSlots = {}
    slots = applyRoofingAnswer(slots, 'address', '12 Wrong St, Bondi NSW 2026')
    slots = applyRoofingAnswer(slots, 'confirm_address', 'no')
    expect(nextRoofingStep(slots).step).toBe('address')
  })

  it('re-asks material on an unrecognised answer (does not advance)', () => {
    let slots: RoofingSlots = { address: '1 A St', address_confirmed: true, intent: 'full_reroof' }
    slots = applyRoofingAnswer(slots, 'material', 'it is greenish')
    expect(nextRoofingStep(slots).step).toBe('material')
  })
})

describe('roofingReadiness + inspection fallback', () => {
  const base: RoofingSlots = {
    address: '1 A St', address_confirmed: true, intent: 'full_reroof',
    material: 'colorbond_trimdek', pitch: 'standard',
  }
  it('ready on a clean metal/standard job', () => {
    expect(roofingReadiness(base)).toBe('ready')
    expect(nextRoofingStep(base).step).toBe('ready')
  })
  it('routes cement_sheet to inspection (asbestos)', () => {
    const s = { ...base, material: 'cement_sheet' as const }
    expect(roofingReadiness(s)).toBe('inspection')
    expect(nextRoofingStep(s)).toMatchObject({ step: 'inspection', reason: expect.stringMatching(/asbestos/i) })
  })
  it('routes unknown material to inspection', () => {
    const s = { ...base, material: 'unknown' as const }
    expect(roofingReadiness(s)).toBe('inspection')
  })
  it('routes very_steep / unknown pitch to inspection', () => {
    expect(roofingReadiness({ ...base, pitch: 'very_steep' })).toBe('inspection')
    expect(roofingReadiness({ ...base, pitch: 'unknown' })).toBe('inspection')
  })
  it('need_more until the address is confirmed', () => {
    expect(roofingReadiness({ ...base, address_confirmed: false })).toBe('need_more')
  })
})

describe('applyRoofingAnswer — opportunistic year capture', () => {
  it('captures a year mentioned during any step', () => {
    const s = applyRoofingAnswer({}, 'address', '5 Old Rd, built 1965, Perth WA 6000')
    expect(s.year_built).toBe(1965)
    expect(s.postcode).toBe('6000')
    expect(s.state).toBe('WA')
  })
})

describe('toRoofingRequest', () => {
  it('builds the pipeline request from gathered slots', () => {
    const slots = freshThrough([
      '670 London Rd, Chandler QLD 4155',
      'yes',
      'full re-roof',
      'colorbond trimdek',
      'standard',
    ])
    const req = toRoofingRequest(slots)
    expect(req).not.toBeNull()
    expect(req!.address).toEqual({ address: '670 London Rd, Chandler QLD 4155', postcode: '4155', state: 'QLD' })
    expect(req!.inputs).toEqual({ material: 'colorbond_trimdek', pitch: 'standard', intent: 'full_reroof', building_year_built: null })
  })
  it('returns null when not enough gathered', () => {
    expect(toRoofingRequest({ address: '1 A St' })).toBeNull()
  })
})
