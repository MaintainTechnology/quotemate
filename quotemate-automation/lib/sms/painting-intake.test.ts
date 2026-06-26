// SMS painting receptionist — pure intake state machine tests.

import { describe, expect, it } from 'vitest'
import {
  applyPaintingAnswer,
  isAffirmative,
  isNegative,
  isStopRequest,
  looksLikePaintingEnquiry,
  mapCeilingHeight,
  mapCoats,
  mapColourChange,
  mapCondition,
  mapScopes,
  mapStoreys,
  nextPaintingStep,
  paintingReadiness,
  parseAuState,
  parsePostcode,
  toPaintingRequest,
  type PaintingSlots,
} from './painting-intake'

describe('looksLikePaintingEnquiry', () => {
  it('matches clear painting terms', () => {
    expect(looksLikePaintingEnquiry('I need a painting quote')).toBe(true)
    expect(looksLikePaintingEnquiry('can you repaint my house')).toBe(true)
    expect(looksLikePaintingEnquiry('paint the bedroom please')).toBe(true)
    expect(looksLikePaintingEnquiry('after a painter for the exterior')).toBe(true)
    expect(looksLikePaintingEnquiry('quote to paint my interior walls')).toBe(true)
    expect(looksLikePaintingEnquiry('the paintwork is looking tired')).toBe(true)
  })
  it('leaves roof work to the roofing slice (does not poach)', () => {
    expect(looksLikePaintingEnquiry('repaint the roof')).toBe(false)
    expect(looksLikePaintingEnquiry('paint my roof restoration')).toBe(false)
  })
  it('does not trip on electrical/plumbing messages', () => {
    expect(looksLikePaintingEnquiry('I need 6 downlights')).toBe(false)
    expect(looksLikePaintingEnquiry('my hot water system is leaking')).toBe(false)
    expect(looksLikePaintingEnquiry('a complaint about the power points')).toBe(false)
  })
  it('is empty-safe', () => {
    expect(looksLikePaintingEnquiry('')).toBe(false)
  })
})

describe('isStopRequest', () => {
  it('catches explicit stop/cancel/opt-out and clear frustration', () => {
    for (const s of ['STOP PLEASE', 'cancel', "let's cancel now", 'unsubscribe', 'not interested', 'leave me alone', 'FUCK NO!', 'just stop this session', 'nevermind']) {
      expect(isStopRequest(s)).toBe(true)
    }
  })
  it('does NOT treat a bare yes/no or a normal address as a stop', () => {
    for (const s of ['yes', 'no', 'yeah thats right', '5 Smith St, Bondi NSW 2026', 'walls and ceilings', 'standard']) {
      expect(isStopRequest(s)).toBe(false)
    }
  })
})

describe('applyPaintingAnswer address validation', () => {
  it('ignores a reply with no street number (does not store junk as address)', () => {
    expect(applyPaintingAnswer({}, 'address', 'somewhere in town').address).toBeUndefined()
  })
  it('ignores a stop sentence even when it contains a digit', () => {
    expect(applyPaintingAnswer({}, 'address', 'cancel my 2 quotes please').address).toBeUndefined()
  })
  it('accepts a real address with a street number and lifts postcode + state', () => {
    const s = applyPaintingAnswer({}, 'address', '5 Smith St, Bondi NSW 2026')
    expect(s.address).toBe('5 Smith St, Bondi NSW 2026')
    expect(s.postcode).toBe('2026')
    expect(s.state).toBe('NSW')
    expect(s.address_confirmed).toBe(false)
  })
})

describe('mapScopes', () => {
  it('maps single and multiple surfaces, in stable order', () => {
    expect(mapScopes('walls')).toEqual(['walls'])
    expect(mapScopes('walls and ceilings')).toEqual(['walls', 'ceilings'])
    expect(mapScopes('exterior and walls')).toEqual(['walls', 'exterior'])
    expect(mapScopes('just the trim')).toEqual(['trim'])
  })
  it('maps trim synonyms', () => {
    expect(mapScopes('skirting and architraves')).toEqual(['trim'])
    expect(mapScopes('the doors and door frames')).toEqual(['trim'])
  })
  it('maps "everything" to all four surfaces', () => {
    expect(mapScopes('everything')).toEqual(['walls', 'ceilings', 'trim', 'exterior'])
  })
  it('maps a bare "inside" / "interior" to walls + ceilings', () => {
    expect(mapScopes('inside')).toEqual(['walls', 'ceilings'])
    expect(mapScopes('just the interior')).toEqual(['walls', 'ceilings'])
  })
  it('returns null when no surface is recognised (re-ask)', () => {
    expect(mapScopes('the back garden')).toBeNull()
    expect(mapScopes('')).toBeNull()
  })
})

describe('mapCoats', () => {
  it('maps coat counts and synonyms', () => {
    expect(mapCoats('1 coat')).toBe(1)
    expect(mapCoats('just one')).toBe(1)
    expect(mapCoats('a refresh')).toBe(1)
    expect(mapCoats('2 coats')).toBe(2)
    expect(mapCoats('two')).toBe(2)
    expect(mapCoats('standard')).toBe(2)
    expect(mapCoats('3 coats')).toBe(3)
    expect(mapCoats('premium')).toBe(3)
  })
  it('maps an unsure answer to 2 (the AU default)', () => {
    expect(mapCoats('not sure, whatever you reckon')).toBe(2)
  })
  it('returns null on an unrecognised answer (re-ask)', () => {
    expect(mapCoats('purple')).toBeNull()
    expect(mapCoats('')).toBeNull()
  })
})

describe('mapCondition', () => {
  it('maps the four conditions', () => {
    expect(mapCondition('already painted, just tired')).toBe('sound')
    expect(mapCondition('a few nail holes to fill')).toBe('minor')
    expect(mapCondition('bare plaster, never painted')).toBe('bare')
    expect(mapCondition('flaking and peeling badly')).toBe('poor')
  })
  it('lets poor (inspection trigger) win over any other token', () => {
    expect(mapCondition('previously painted but flaking now')).toBe('poor')
  })
  it('returns null on unsure / unrecognised (never guesses the prep lever)', () => {
    expect(mapCondition('not sure really')).toBeNull()
    expect(mapCondition('it is blue')).toBeNull()
  })
})

describe('mapCeilingHeight', () => {
  it('maps the buckets', () => {
    expect(mapCeilingHeight('standard')).toBe('standard')
    expect(mapCeilingHeight('about 2.4m')).toBe('standard')
    expect(mapCeilingHeight('high ceilings, a Queenslander')).toBe('high')
    expect(mapCeilingHeight('cathedral ceilings')).toBe('raked')
    expect(mapCeilingHeight('raked / vaulted')).toBe('raked')
  })
  it('maps unsure to standard, gibberish to null', () => {
    expect(mapCeilingHeight('no idea')).toBe('standard')
    expect(mapCeilingHeight('orange')).toBeNull()
  })
})

describe('mapStoreys', () => {
  it('maps the storey counts', () => {
    expect(mapStoreys('single storey')).toBe(1)
    expect(mapStoreys('one level')).toBe(1)
    expect(mapStoreys('double storey')).toBe(2)
    expect(mapStoreys('two')).toBe(2)
    expect(mapStoreys('3 storeys')).toBe(3)
    expect(mapStoreys('triple storey')).toBe(3)
  })
  it('maps unsure to 1, gibberish to null', () => {
    expect(mapStoreys('not sure')).toBe(1)
    expect(mapStoreys('banana')).toBeNull()
  })
})

describe('mapColourChange', () => {
  it('reads yes/no and synonyms, defaulting ambiguous to false', () => {
    expect(mapColourChange('yes, going darker')).toBe(true)
    expect(mapColourChange('different colour')).toBe(true)
    expect(mapColourChange('no')).toBe(false)
    expect(mapColourChange('same colour')).toBe(false)
    expect(mapColourChange('not changing it')).toBe(false)
    expect(mapColourChange('hmm')).toBe(false)
  })
})

describe('parsePostcode / parseAuState', () => {
  it('extracts postcode + state', () => {
    expect(parsePostcode('5 Smith St, Bondi NSW 2026')).toBe('2026')
    expect(parseAuState('5 Smith St, Bondi NSW 2026')).toBe('NSW')
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

function freshThrough(messages: Array<string>): PaintingSlots {
  // Drive the machine: at each turn, ask nextPaintingStep, apply the answer.
  let slots: PaintingSlots = {}
  for (const m of messages) {
    const { step } = nextPaintingStep(slots)
    if (step === 'ready' || step === 'inspection') break
    slots = applyPaintingAnswer(slots, step, m)
  }
  return slots
}

describe('nextPaintingStep — gathering order', () => {
  it('asks address → confirm → scopes → coats → condition → ceiling → storeys → colour → ready', () => {
    let slots: PaintingSlots = {}
    expect(nextPaintingStep(slots).step).toBe('address')

    slots = applyPaintingAnswer(slots, 'address', '5 Smith St, Bondi NSW 2026')
    expect(nextPaintingStep(slots).step).toBe('confirm_address')
    expect(nextPaintingStep(slots).question).toMatch(/5 Smith St/)

    slots = applyPaintingAnswer(slots, 'confirm_address', 'yes')
    expect(nextPaintingStep(slots).step).toBe('scopes')

    slots = applyPaintingAnswer(slots, 'scopes', 'walls and ceilings')
    expect(nextPaintingStep(slots).step).toBe('coats')

    slots = applyPaintingAnswer(slots, 'coats', '2 coats')
    expect(nextPaintingStep(slots).step).toBe('condition')

    slots = applyPaintingAnswer(slots, 'condition', 'already painted')
    expect(nextPaintingStep(slots).step).toBe('ceiling_height')

    slots = applyPaintingAnswer(slots, 'ceiling_height', 'standard')
    expect(nextPaintingStep(slots).step).toBe('storeys')

    slots = applyPaintingAnswer(slots, 'storeys', 'single storey')
    expect(nextPaintingStep(slots).step).toBe('colour_change')

    slots = applyPaintingAnswer(slots, 'colour_change', 'no')
    expect(nextPaintingStep(slots).step).toBe('ready')
  })

  it('asks for postcode + state when the address line did not include them', () => {
    let slots: PaintingSlots = {}
    slots = applyPaintingAnswer(slots, 'address', '12 Smith Street')
    slots = applyPaintingAnswer(slots, 'confirm_address', 'yes')
    expect(nextPaintingStep(slots).step).toBe('location')

    slots = applyPaintingAnswer(slots, 'location', '4151 QLD')
    expect(slots.postcode).toBe('4151')
    expect(slots.state).toBe('QLD')
    expect(nextPaintingStep(slots).step).toBe('scopes')
  })

  it('re-asks the address when the customer says the read-back is wrong', () => {
    let slots: PaintingSlots = {}
    slots = applyPaintingAnswer(slots, 'address', '12 Wrong St, Bondi NSW 2026')
    slots = applyPaintingAnswer(slots, 'confirm_address', 'no')
    expect(nextPaintingStep(slots).step).toBe('address')
  })

  it('re-asks scopes / coats on an unrecognised answer (does not advance)', () => {
    let slots: PaintingSlots = { address: '1 A St', address_confirmed: true, postcode: '4000', state: 'QLD' }
    slots = applyPaintingAnswer(slots, 'scopes', 'the garden')
    expect(nextPaintingStep(slots).step).toBe('scopes')

    slots = { ...slots, scopes: ['walls'] }
    slots = applyPaintingAnswer(slots, 'coats', 'purple')
    expect(nextPaintingStep(slots).step).toBe('coats')
  })
})

describe('nextPaintingStep — inspection short-circuits', () => {
  const partial: PaintingSlots = {
    address: '1 A St', address_confirmed: true, postcode: '4000', state: 'QLD',
    scopes: ['walls'], coats: 2,
  }
  it('routes poor condition straight to inspection (skips ceiling/storeys)', () => {
    const s = { ...partial, condition: 'poor' as const }
    expect(nextPaintingStep(s)).toMatchObject({ step: 'inspection', reason: expect.stringMatching(/flaking|damaged/i) })
  })
  it('routes raked ceilings to inspection', () => {
    const s = { ...partial, condition: 'sound' as const, ceiling_height: 'raked' as const }
    expect(nextPaintingStep(s)).toMatchObject({ step: 'inspection', reason: expect.stringMatching(/raked|cathedral/i) })
  })
  it('routes 3+ storeys to inspection', () => {
    const s = { ...partial, condition: 'sound' as const, ceiling_height: 'standard' as const, storeys: 3 as const }
    expect(nextPaintingStep(s)).toMatchObject({ step: 'inspection', reason: expect.stringMatching(/storeys|access/i) })
  })
})

describe('paintingReadiness + inspection fallback', () => {
  const base: PaintingSlots = {
    address: '1 A St', address_confirmed: true, postcode: '4000', state: 'QLD',
    scopes: ['walls', 'ceilings'], coats: 2, condition: 'sound',
    ceiling_height: 'standard', storeys: 1, colour_change: false,
  }
  it('ready on a clean job', () => {
    expect(paintingReadiness(base)).toBe('ready')
    expect(nextPaintingStep(base).step).toBe('ready')
  })
  it('routes poor condition to inspection', () => {
    expect(paintingReadiness({ ...base, condition: 'poor' })).toBe('inspection')
  })
  it('routes raked ceiling to inspection', () => {
    expect(paintingReadiness({ ...base, ceiling_height: 'raked' })).toBe('inspection')
  })
  it('routes 3+ storeys to inspection', () => {
    expect(paintingReadiness({ ...base, storeys: 3 })).toBe('inspection')
  })
  it('need_more until the address is confirmed', () => {
    expect(paintingReadiness({ ...base, address_confirmed: false })).toBe('need_more')
  })
  it('need_more until postcode + state are known', () => {
    expect(paintingReadiness({ ...base, postcode: null })).toBe('need_more')
  })
  it('need_more until the colour-change question is answered', () => {
    expect(paintingReadiness({ ...base, colour_change: undefined })).toBe('need_more')
  })
})

describe('toPaintingRequest', () => {
  it('builds the estimate request from gathered slots, defaulting to the Other-tools path', () => {
    const slots = freshThrough([
      '5 Smith St, Bondi NSW 2026',
      'yes',
      'walls and ceilings',
      '2 coats',
      'already painted',
      'standard',
      'single storey',
      'no',
    ])
    const req = toPaintingRequest(slots)
    expect(req).not.toBeNull()
    expect(req!.address).toEqual({ address: '5 Smith St, Bondi NSW 2026', postcode: '2026', state: 'NSW' })
    expect(req!.inputs).toEqual({
      scopes: ['walls', 'ceilings'],
      coats: 2,
      condition: 'sound',
      ceiling_height: 'standard',
      colour_change: false,
      storeys: 1,
      manual_floor_area_m2: null,
    })
    // Defaults to the "Other tools" (footprint / Geoscape / floor plan)
    // path — never the demo provider.
    expect(req!.source).toBe('auto')
    expect(req!.use_mock_provider).toBe(false)
  })
  it('returns null when not enough is gathered', () => {
    expect(toPaintingRequest({ address: '1 A St' })).toBeNull()
  })
})
