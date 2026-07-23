// What happens the moment a roofing CALL ends (2026-07-23, second pass).
//
// v1 of the handover always texted the confirm-address question — the caller
// had already agreed the address on the call, so being asked it again by SMS
// read as the AI forgetting the conversation. The measurement must run on the
// call's data and the FIRST text must be the buildings/confirm-roof message
// with the /q/roof/<token> link — exactly what the SMS receptionist sends.
//
// This pins the decision only. The measure I/O is the shared
// lib/sms/roofing-measure-dispatch.ts both channels call.

import { describe, expect, it } from 'vitest'
import { decidePostCallRoofingAction } from './post-call-roofing'
import { mapVoiceAnswersToRoofingSlots } from './trade-handover'

const complete = () =>
  mapVoiceAnswersToRoofingSlots({
    address: '670 London Road, Chandler QLD 4155',
    material: 'concrete tiles',
    pitch: 'standard',
    intent: 'full re-roof',
  })

describe('decidePostCallRoofingAction', () => {
  it('complete brief + address agreed on the call → measure immediately', () => {
    const d = decidePostCallRoofingAction(complete(), true)
    expect(d.action).toBe('measure')
    if (d.action !== 'measure') return
    expect(d.isInspection).toBe(false)
    // The address must be marked confirmed so the SMS machine never re-asks.
    expect(d.slots.address_confirmed).toBe(true)
  })

  it('complete brief but the caller never confirmed the address → ask by text', () => {
    const d = decidePostCallRoofingAction(complete(), false)
    expect(d.action).toBe('ask')
    if (d.action !== 'ask') return
    expect(d.step).toBe('confirm_address')
  })

  it('asbestos-suspect material → inspection reason, never a measure', () => {
    const slots = mapVoiceAnswersToRoofingSlots({
      address: '670 London Road, Chandler QLD 4155',
      material: 'fibro',
      intent: 'full re-roof',
    })
    const d = decidePostCallRoofingAction(slots, true)
    expect(d.action).toBe('inspection_reason')
    if (d.action !== 'inspection_reason') return
    expect(d.reason).toMatch(/asbestos|cement/i)
  })

  it('steep pitch on a COMPLETE brief → still measured, flagged inspection', () => {
    // Parity with the SMS route: it only takes the say-why path when the
    // brief is too thin to measure (`!toRoofingRequest`). A complete brief
    // is measured so the saved job + roof page exist, with the routing
    // forced to inspection_required.
    const slots = mapVoiceAnswersToRoofingSlots({
      address: '670 London Road, Chandler QLD 4155',
      material: 'colorbond corrugated',
      pitch: 'very steep',
      intent: 'full re-roof',
    })
    const d = decidePostCallRoofingAction(slots, true)
    expect(d.action).toBe('measure')
    if (d.action !== 'measure') return
    expect(d.isInspection).toBe(true)
    expect(d.reason).toMatch(/steep/i)
  })

  it('missing material → ask that question by text, not the address again', () => {
    const slots = mapVoiceAnswersToRoofingSlots({
      address: '670 London Road, Chandler QLD 4155',
      intent: 'full re-roof',
    })
    const d = decidePostCallRoofingAction(slots, true)
    expect(d.action).toBe('ask')
    if (d.action !== 'ask') return
    expect(d.step).toBe('material')
  })

  it('no address at all → ask for the address', () => {
    const d = decidePostCallRoofingAction(mapVoiceAnswersToRoofingSlots({}), true)
    expect(d.action).toBe('ask')
    if (d.action !== 'ask') return
    expect(d.step).toBe('address')
  })
})
