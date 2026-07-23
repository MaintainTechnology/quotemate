// SMS painting receptionist — pure per-turn decision tests.

import { describe, expect, it } from 'vitest'
import {
  advancePainting,
  customerWantsForm,
  expireIdlePaintingState,
  isActivePaintingFlow,
  nextPaintingConversationState,
  shouldEngagePainting,
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
    // Same single-shot drop the roofing receptionist had (audit 2026-07-23):
    // a question or a proposed time is a LIVE LEAD, not a decline.
    expect(advancePainting(parked, 'what does it cost?')).toMatchObject({ action: 'booking', confirmed: true })
    expect(advancePainting(parked, 'Tuesday works for me')).toMatchObject({ action: 'booking', confirmed: true })
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

// Same idle-session incident as roofing (live 2026-07-24): a painting flow
// parked at await_form / quoted / await_booking and reused hours later must be
// treated as stale, not resumed. Mirrors expireIdleRoofingState.
describe('expireIdlePaintingState — a parked flow left idle is stale', () => {
  const HOUR = 60 * 60 * 1000
  it('closes any active flow idle beyond the threshold', () => {
    for (const step of ['scopes', 'await_form', 'quoted', 'await_booking'] as const) {
      const expired = expireIdlePaintingState(
        { slots: { address: 'x' }, last_step: step, pending_form_token: 'f', pending_quote_token: 'q' },
        3 * HOUR,
      )
      expect(expired, step).not.toBeNull()
      expect(expired!.last_step).toBe('closed')
      expect(expired!.pending_form_token ?? null).toBeNull()
      expect(expired!.pending_quote_token ?? null).toBeNull()
    }
  })
  it('leaves a still-fresh flow untouched, and nothing to do on closed/absent', () => {
    expect(expireIdlePaintingState({ slots: {}, last_step: 'scopes' }, 5 * 60 * 1000)).toBeNull()
    expect(expireIdlePaintingState(null, 10 * HOUR)).toBeNull()
    expect(expireIdlePaintingState({ slots: {}, last_step: 'closed' }, 10 * HOUR)).toBeNull()
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

describe('shouldEngagePainting — follow-up pin guard (spec 2026-07-05 Part A2)', () => {
  // A mid-gather painting flow still parked on the thread (awaiting scopes).
  const activePainting: PaintingConversationState = { slots: {}, last_step: 'scopes' }
  const closedPainting: PaintingConversationState = { slots: {}, last_step: 'closed' }

  it('R-A3: stale active painting state + active pin + affirmative reply → does NOT engage (falls through to the general dialog)', () => {
    expect(shouldEngagePainting(activePainting, 'Yes', true)).toBe(false)
    expect(shouldEngagePainting(activePainting, 'yeah go for it', true)).toBe(false)
  })

  it('R-A4: active pin + a genuinely NEW painting enquiry → still engages', () => {
    expect(shouldEngagePainting(activePainting, 'I want the house painted', true)).toBe(true)
    expect(shouldEngagePainting(null, 'can you quote a repaint of the interior', true)).toBe(true)
  })

  it('no pin → behaviour is unchanged: active flow resumes, fresh enquiry engages, anything else passes through', () => {
    expect(shouldEngagePainting(activePainting, 'Yes', false)).toBe(true) // resume active flow
    expect(shouldEngagePainting(null, 'I want the house painted', false)).toBe(true) // fresh enquiry
    expect(shouldEngagePainting(null, 'Yes', false)).toBe(false) // neither
    expect(shouldEngagePainting(closedPainting, 'Yes', false)).toBe(false) // closed flow
  })
})
