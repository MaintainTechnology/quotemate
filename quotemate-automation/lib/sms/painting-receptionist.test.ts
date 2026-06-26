// SMS painting receptionist — pure per-turn decision tests.

import { describe, expect, it } from 'vitest'
import {
  advancePainting,
  customerWantsForm,
  isActivePaintingFlow,
  nextPaintingConversationState,
  type PaintingConversationState,
  type PaintingTurnDecision,
} from './painting-receptionist'
import { toPaintingRequest } from './painting-intake'

function drive(messages: Array<string>): {
  decisions: PaintingTurnDecision[]
  finalState: PaintingConversationState
} {
  let state: PaintingConversationState | null = null
  const decisions: PaintingTurnDecision[] = []
  for (const m of messages) {
    const d = advancePainting(state, m)
    decisions.push(d)
    state = nextPaintingConversationState(d)
  }
  return { decisions, finalState: state as PaintingConversationState }
}

describe('advancePainting — opener offers the form first', () => {
  it('offers the form on a fresh painting enquiry', () => {
    const d = advancePainting(null, 'I want to paint my house')
    expect(d.action).toBe('offer_form')
  })
  it('passes through a non-painting opener (route should not have called us)', () => {
    const d = advancePainting(null, 'I need 6 downlights')
    expect(d.action).toBe('passthrough')
  })
})

describe('advancePainting — replying to the form offer', () => {
  const offered: PaintingConversationState = { slots: {}, last_step: 'offer_form' }

  it('acknowledges + waits when the customer chooses the form', () => {
    const d = advancePainting(offered, 'send me the form link')
    expect(d.action).toBe('await_form')
  })
  it('starts the questions when the customer declines the link', () => {
    const d = advancePainting(offered, 'just ask me here')
    expect(d).toMatchObject({ action: 'ask', step: 'address' })
  })
  it('captures an address volunteered with the decline (jumps to confirm)', () => {
    const d = advancePainting(offered, "nah it's 5 Smith St, Bondi NSW 2026")
    expect(d).toMatchObject({ action: 'ask', step: 'confirm_address' })
    if (d.action === 'ask') expect(d.reply).toMatch(/Smith St/)
  })
})

describe('advancePainting — switching from await_form to questions', () => {
  it('starts Q&A when a form-waiting customer texts back', () => {
    const d = advancePainting({ slots: {}, last_step: 'await_form' }, 'actually can we just do it here')
    expect(d).toMatchObject({ action: 'ask', step: 'address' })
  })
})

describe('advancePainting — stop is honoured first', () => {
  it('cancels from any step', () => {
    expect(advancePainting({ slots: {}, last_step: 'coats' }, 'stop').action).toBe('cancel')
    expect(advancePainting({ slots: {}, last_step: 'offer_form' }, 'not interested').action).toBe('cancel')
  })
})

describe('advancePainting — full Q&A path to an estimate', () => {
  it('gathers every field then asks the route to run the estimate', () => {
    const { decisions, finalState } = drive([
      'paint my house',
      'just ask me',
      '5 Smith St, Bondi NSW 2026',
      'yes',
      'walls and ceilings',
      '2 coats',
      'already painted',
      'standard',
      'single storey',
      'no',
    ])
    const steps = decisions.map((d) => d.action)
    expect(steps[0]).toBe('offer_form')
    expect(steps[steps.length - 1]).toBe('estimate')
    const last = decisions[decisions.length - 1]
    if (last.action === 'estimate') {
      const req = toPaintingRequest(last.slots)
      expect(req).not.toBeNull()
      expect(req!.inputs.scopes).toEqual(['walls', 'ceilings'])
      expect(req!.source).toBe('auto')
    }
    expect(finalState.last_step).toBe('quoted')
  })
})

describe('advancePainting — inspection + booking', () => {
  it('routes a poor-condition job to inspection, then handles the booking reply', () => {
    const insp = advancePainting(
      {
        slots: { address: '1 A St', address_confirmed: true, postcode: '4000', state: 'QLD', scopes: ['walls'], coats: 2 },
        last_step: 'condition',
      },
      'the walls are flaking and peeling',
    )
    expect(insp).toMatchObject({ action: 'inspection', reason: expect.stringMatching(/flaking|damaged/i) })
    const parked = nextPaintingConversationState(insp)
    expect(parked.last_step).toBe('await_booking')

    expect(advancePainting(parked, 'yes please book it').action).toBe('booking')
    expect(advancePainting(parked, 'yes please book it')).toMatchObject({ action: 'booking', confirmed: true })
    expect(advancePainting(parked, 'no thanks')).toMatchObject({ action: 'booking', confirmed: false })
  })
})

describe('advancePainting — re-asks on junk', () => {
  it('re-asks the address when the reply has no street number', () => {
    const d = advancePainting({ slots: {}, last_step: 'address' }, 'somewhere in town')
    expect(d).toMatchObject({ action: 'ask', step: 'address' })
    if (d.action === 'ask') expect(d.reply).toMatch(/didn't catch/i)
  })
})

describe('advancePainting — warm quoted thread', () => {
  const quoted: PaintingConversationState = { slots: {}, last_step: 'quoted' }
  it('hands an unrelated message back to the general dialog', () => {
    expect(advancePainting(quoted, 'how much for some downlights?').action).toBe('passthrough')
  })
  it('reopens (re-offers the form) on a fresh painting enquiry', () => {
    expect(advancePainting(quoted, 'can you also repaint the back deck?').action).toBe('offer_form')
  })
})

describe('customerWantsForm', () => {
  it('is true only on an explicit form cue', () => {
    expect(customerWantsForm('send me the form')).toBe(true)
    expect(customerWantsForm('the link please')).toBe(true)
    expect(customerWantsForm("i'll fill it out")).toBe(true)
  })
  it('is false on a decline, a bare yes, or empty', () => {
    expect(customerWantsForm('just ask me here')).toBe(false)
    expect(customerWantsForm('no thanks')).toBe(false)
    expect(customerWantsForm('yes')).toBe(false)
    expect(customerWantsForm('')).toBe(false)
  })
})

describe('isActivePaintingFlow', () => {
  it('is true mid-flow, false when empty or closed', () => {
    expect(isActivePaintingFlow(null)).toBe(false)
    expect(isActivePaintingFlow({ slots: {}, last_step: 'offer_form' })).toBe(true)
    expect(isActivePaintingFlow({ slots: {}, last_step: 'scopes' })).toBe(true)
    expect(isActivePaintingFlow({ slots: {}, last_step: 'closed' })).toBe(false)
    expect(isActivePaintingFlow({ slots: {}, last_step: null })).toBe(false)
  })
})

describe('nextPaintingConversationState', () => {
  it('maps each decision to the right parked step', () => {
    expect(nextPaintingConversationState({ action: 'offer_form', slots: {} }).last_step).toBe('offer_form')
    expect(nextPaintingConversationState({ action: 'await_form', slots: {}, reply: 'x' }).last_step).toBe('await_form')
    expect(nextPaintingConversationState({ action: 'ask', slots: {}, step: 'coats', reply: 'x' }).last_step).toBe('coats')
    expect(nextPaintingConversationState({ action: 'estimate', slots: {} }).last_step).toBe('quoted')
    expect(nextPaintingConversationState({ action: 'inspection', slots: {}, reason: 'x' }).last_step).toBe('await_booking')
    expect(nextPaintingConversationState({ action: 'cancel', slots: {} }).last_step).toBe('closed')
    expect(nextPaintingConversationState({ action: 'booking', slots: {}, confirmed: true }).last_step).toBe('closed')
  })
})
