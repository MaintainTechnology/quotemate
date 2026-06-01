// SMS roofing receptionist — per-turn decision tests, including the
// "is this your roof?" confirmation gate and structure picking.

import { describe, expect, it } from 'vitest'
import {
  advanceRoofing,
  nextRoofingConversationState,
  parseStructureChoice,
  type RoofingConversationState,
} from './roofing-receptionist'

/** Simulate the route loop up to the first non-ask outcome. */
function runConversation(messages: string[]) {
  let state: RoofingConversationState | null = null
  const decisions = []
  for (const m of messages) {
    const decision = advanceRoofing(state, m)
    decisions.push(decision)
    state = nextRoofingConversationState(decision)
    if (decision.action !== 'ask') break
  }
  return { decisions, state }
}

describe('advanceRoofing — gather then measure', () => {
  it('gathers all inputs across turns then signals measure', () => {
    const { decisions } = runConversation([
      'Hi, I need a re-roof quote',
      '670 London Rd, Chandler QLD 4155',
      'yes',
      'full re-roof',
      'colorbond',
      'standard',
    ])
    const steps = decisions.map((d) => (d.action === 'ask' ? d.step : d.action))
    expect(steps[0]).toBe('address')
    expect(steps).toContain('confirm_address')
    expect(steps).toContain('material')
    expect(steps).toContain('pitch')
    expect(steps[steps.length - 1]).toBe('measure')
  })

  it('opener gleans intent so it is not asked again', () => {
    const d = advanceRoofing(null, 'my roof is leaking badly')
    expect(d.slots.intent).toBe('leak_trace')
    expect(d.action).toBe('ask')
    if (d.action === 'ask') expect(d.step).toBe('address')
  })
})

describe('advanceRoofing — inspection fallback', () => {
  it('routes fibro/asbestos to inspection', () => {
    const { decisions } = runConversation([
      'need a roof repair quote',
      '12 Smith St, Bondi NSW 2026',
      'yes',
      'repair a few spots',
      'fibro',
    ])
    const last = decisions[decisions.length - 1]
    expect(last.action).toBe('inspection')
    if (last.action === 'inspection') expect(last.reason).toMatch(/asbestos/i)
  })
})

describe('parseStructureChoice', () => {
  it('reads a bare number, #n, "number n", and ordinals within range', () => {
    expect(parseStructureChoice('2', 3)).toBe(2)
    expect(parseStructureChoice('#1', 3)).toBe(1)
    expect(parseStructureChoice('number 3', 3)).toBe(3)
    expect(parseStructureChoice('the second one', 3)).toBe(2)
  })
  it('returns null out of range or when no number', () => {
    expect(parseStructureChoice('5', 2)).toBeNull()
    expect(parseStructureChoice('yes please', 2)).toBeNull()
  })
})

describe('advanceRoofing — confirm_roof gate', () => {
  const measured: RoofingConversationState = {
    slots: { address: '1 A St', address_confirmed: true, intent: 'full_reroof', material: 'colorbond_trimdek', pitch: 'standard' },
    last_step: 'confirm_roof',
    pending_quote_token: 'tok123',
    pending_structure_count: 2,
  }

  it('YES → send_saved (all structures)', () => {
    const d = advanceRoofing(measured, 'yes thats my roof')
    expect(d.action).toBe('send_saved')
    if (d.action === 'send_saved') expect(d.structureChoice).toBeNull()
  })

  it('a number → send_saved for that structure (multi-building)', () => {
    const d = advanceRoofing(measured, '2')
    expect(d.action).toBe('send_saved')
    if (d.action === 'send_saved') expect(d.structureChoice).toBe(2)
  })

  it('NO → re-ask the address and reset it', () => {
    const d = advanceRoofing(measured, 'no thats the wrong building')
    expect(d.action).toBe('ask')
    if (d.action === 'ask') {
      expect(d.step).toBe('address')
      expect(d.slots.address).toBeNull()
      expect(d.slots.address_confirmed).toBe(false)
    }
  })

  it('unclear reply → reconfirm', () => {
    const d = advanceRoofing(measured, 'hmm maybe')
    expect(d.action).toBe('reconfirm')
  })

  it('single-building YES still sends all', () => {
    const single = { ...measured, pending_structure_count: 1 }
    const d = advanceRoofing(single, 'yes')
    expect(d.action).toBe('send_saved')
    if (d.action === 'send_saved') expect(d.structureChoice).toBeNull()
  })
})

describe('nextRoofingConversationState', () => {
  it('ask keeps step; measure parks at confirm_roof; send_saved is terminal', () => {
    const ask = advanceRoofing(null, 'hello')
    expect(nextRoofingConversationState(ask).last_step).toBe('address')
    expect(nextRoofingConversationState({ action: 'measure', slots: {} }).last_step).toBe('confirm_roof')
    expect(nextRoofingConversationState({ action: 'send_saved', slots: {}, structureChoice: null }).last_step).toBeNull()
  })
})
