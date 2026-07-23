// Voice → SMS-receptionist handover (2026-07-23).
//
// A roofing/painting voice call must land in the SAME deterministic SMS
// flow the SMS receptionist runs — same questions, same map-checked address
// confirm, same measure→confirm-roof→priced-quote chain, same messages.
// (Live incident: a roofing call went through the generic electrical/
// plumbing intake→estimate pipeline and produced a $99-inspection quote
// instead of the satellite-measured roofing quote.)
//
// The pure core tested here: map the call's spoken answers through the SMS
// machines' OWN parsers into slots, decide whether to hand over (never for
// electrical/plumbing — those keep the generic pipeline), and build the
// opening state + first SMS question from the machines' own step logic.

import { describe, expect, it } from 'vitest'
import {
  decideVoiceTradeHandover,
  mapVoiceAnswersToRoofingSlots,
  mapVoiceAnswersToPaintingSlots,
  buildRoofingHandoverOpening,
  buildPaintingHandoverOpening,
} from './trade-handover'

describe('decideVoiceTradeHandover', () => {
  it('roofing call + roofing tenant → roofing handover', () => {
    expect(decideVoiceTradeHandover('roofing', ['roofing'])).toBe('roofing')
    expect(decideVoiceTradeHandover('roofing', ['electrical', 'roofing'])).toBe('roofing')
  })
  it('painting call + painting tenant → painting handover', () => {
    expect(decideVoiceTradeHandover('painting', ['painting', 'electrical'])).toBe('painting')
  })
  it('never hands over when the tenant lacks the trade', () => {
    expect(decideVoiceTradeHandover('roofing', ['electrical', 'plumbing'])).toBeNull()
    expect(decideVoiceTradeHandover('painting', ['roofing'])).toBeNull()
  })
  it('electrical/plumbing/other always keep the generic pipeline', () => {
    expect(decideVoiceTradeHandover('other', ['roofing', 'painting'])).toBeNull()
    expect(decideVoiceTradeHandover('other', null)).toBeNull()
  })
})

describe('mapVoiceAnswersToRoofingSlots — SMS-parser parity', () => {
  it('maps a complete call through the SMS vocabulary', () => {
    const slots = mapVoiceAnswersToRoofingSlots({
      address: '670 London Road, Chandler QLD 4155',
      material: 'concrete tiles',
      pitch: 'pretty steep',
      intent: 'a full re-roof',
    })
    expect(slots.address).toBeTruthy()
    expect(slots.postcode).toBe('4155')
    expect(slots.state).toBe('QLD')
    expect(slots.material).toBe('concrete_tile')
    expect(slots.pitch).toBe('steep')
    expect(slots.intent).toBe('full_reroof')
    // The SMS flow must ALWAYS re-confirm the address by text (map check).
    expect(slots.address_confirmed).toBe(false)
  })

  it('bare "Colorbond" defaults to corrugated (voice never collects the profile)', () => {
    // The voice receptionist's script presents "Colorbond" as a COMPLETE
    // answer and never asks the corrugated/trimdek/kliplok profile. So a call
    // that said "Colorbond" must not be re-asked the profile by text — default
    // to the most common profile (corrugated); the tradie reviews every quote.
    const slots = mapVoiceAnswersToRoofingSlots({
      address: '31 Greens Road, Coorparoo QLD 4151',
      material: 'Colorbond',
      pitch: 'standard',
      intent: 're-roof',
    })
    expect(slots.material).toBe('colorbond_corrugated')
    expect(slots.metal_hint).toBeFalsy()
    expect(slots.intent).toBe('full_reroof')
  })

  it('unparseable answers leave the slot empty for the SMS machine to ask', () => {
    const slots = mapVoiceAnswersToRoofingSlots({
      address: '31 Greens Road, Coorparoo QLD 4151',
      material: 'the brown stuff',
      pitch: null,
      intent: 'gibberish answer xyzzy',
    })
    expect(slots.material ?? null).toBeNull()
    expect(slots.pitch ?? null).toBeNull()
    expect(slots.intent ?? null).toBeNull()
  })
})

describe('buildRoofingHandoverOpening', () => {
  it('full slots → the machine\'s own confirm_address read-back', () => {
    const slots = mapVoiceAnswersToRoofingSlots({
      address: '31 Greens Road, Coorparoo QLD 4151',
      material: 'concrete tiles',
      pitch: 'standard',
      intent: 'full re-roof',
    })
    const opening = buildRoofingHandoverOpening(slots)
    expect(opening).not.toBeNull()
    expect(opening!.state.last_step).toBe('confirm_address')
    expect(opening!.question).toContain(slots.address!)
    expect(opening!.state.slots).toEqual(slots)
  })

  it('no address captured → the machine asks for the address first', () => {
    const opening = buildRoofingHandoverOpening(
      mapVoiceAnswersToRoofingSlots({ material: 'concrete tiles' }),
    )
    expect(opening).not.toBeNull()
    expect(opening!.state.last_step).toBe('address')
  })
})

describe('painting mapping + opening', () => {
  it('maps painting answers through the SMS vocabulary', () => {
    const slots = mapVoiceAnswersToPaintingSlots({
      address: '12 Smith Street, Paddington QLD 4064',
      surfaces: 'walls and ceilings',
      coats: 'two coats',
      condition: 'sound',
      ceiling_height: 'standard',
      storeys: 'single storey',
      colour_change: 'no, same colour',
    })
    expect(slots.scopes).toEqual(expect.arrayContaining(['walls', 'ceilings']))
    expect(slots.coats).toBe(2)
    expect(slots.condition).toBe('sound')
    expect(slots.ceiling_height).toBe('standard')
    expect(slots.storeys).toBe(1)
    expect(slots.colour_change).toBe(false)
    expect(slots.address_confirmed).toBe(false)
  })

  it('opening lands on confirm_address with slots preserved', () => {
    const slots = mapVoiceAnswersToPaintingSlots({
      address: '12 Smith Street, Paddington QLD 4064',
      surfaces: 'walls',
    })
    const opening = buildPaintingHandoverOpening(slots)
    expect(opening).not.toBeNull()
    expect(opening!.state.last_step).toBe('confirm_address')
    expect(opening!.question).toContain(slots.address!)
  })
})
