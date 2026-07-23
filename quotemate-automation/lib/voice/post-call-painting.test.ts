// Painting's twin of post-call-roofing: a call that gathered the whole
// painting brief must run the estimate, not re-ask it by text.
//
// Before this, a COMPLETE painting call produced no opening question
// (nextPaintingStep → 'ready'), the handover returned false, and the call
// fell through to the generic electrical/plumbing pipeline — the same class
// of bug reported for roofing on 2026-07-23.

import { describe, expect, it } from 'vitest'
import { decidePostCallPaintingAction } from './post-call-painting'
import { mapVoiceAnswersToPaintingSlots } from './trade-handover'

const complete = () =>
  mapVoiceAnswersToPaintingSlots({
    address: '12 Smith Street, Paddington QLD 4064',
    surfaces: 'walls and ceilings',
    coats: 'two coats',
    condition: 'sound',
    ceiling_height: 'standard',
    storeys: 'single storey',
    colour_change: 'no',
  })

describe('decidePostCallPaintingAction', () => {
  it('complete brief + address agreed on the call → estimate immediately', () => {
    const d = decidePostCallPaintingAction(complete(), true)
    expect(d.action).toBe('estimate')
    if (d.action !== 'estimate') return
    expect(d.slots.address_confirmed).toBe(true)
  })

  it('address never confirmed on the call → read it back by text first', () => {
    const d = decidePostCallPaintingAction(complete(), false)
    expect(d.action).toBe('ask')
    if (d.action !== 'ask') return
    expect(d.step).toBe('confirm_address')
  })

  it('flaking surfaces → inspection reason, never an estimate', () => {
    const slots = mapVoiceAnswersToPaintingSlots({
      address: '12 Smith Street, Paddington QLD 4064',
      surfaces: 'walls',
      coats: 'two',
      condition: 'flaking and water damaged',
    })
    const d = decidePostCallPaintingAction(slots, true)
    expect(d.action).toBe('inspection_reason')
    if (d.action !== 'inspection_reason') return
    expect(d.reason).toMatch(/flaking|damaged|prep/i)
  })

  it('missing coats → ask that question, not the address again', () => {
    const slots = mapVoiceAnswersToPaintingSlots({
      address: '12 Smith Street, Paddington QLD 4064',
      surfaces: 'walls',
    })
    const d = decidePostCallPaintingAction(slots, true)
    expect(d.action).toBe('ask')
    if (d.action !== 'ask') return
    expect(d.step).toBe('coats')
  })
})
