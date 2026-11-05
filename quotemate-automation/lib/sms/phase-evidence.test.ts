import { describe, expect, it } from 'vitest'
import { customerPropertyPhase, normaliseCustomerPhase } from './phase-evidence'

const ask = { direction: 'outbound' as const, body: 'Is the property single-phase or three-phase, and any spare switchboard capacity?' }
const inbound = (body: string) => ({ direction: 'inbound' as const, body })

describe('customer property phase', () => {
  it.each(['three', 'three-phase', 'three phase', '3phase', '3 phase', '3-phase', '3φ', '３-phase'])('normalizes %s', (answer) => {
    expect(normaliseCustomerPhase(answer)).toBe('three')
  })

  it.each(['phase', 'supply_type', 'supply_phase', 'property_phase', 'electrical_phase'])('uses %s with customer evidence from EST-0018', (key) => {
    expect(customerPropertyPhase({ requestedSpecs: { [key]: 'three-phase' },
      history: [ask, inbound('Three-phase,l'), inbound('Yes spare capacity')] })).toBe('three')
  })

  it('lets the latest explicit correction supersede a stale three-phase slot', () => {
    expect(customerPropertyPhase({ requestedSpecs: { supply_type: 'three-phase' }, history: [ask,
      inbound('Three phase'), inbound('Actually the house is single-phase')] })).toBe('single')
  })

  it('preserves the customer answer when a legacy outbound lacks accepted delivery metadata', () => {
    expect(customerPropertyPhase({ requestedSpecs: { supply_type: 'three-phase' },
      history: [inbound('Can you supply?'), inbound('6m'), inbound('Three-phase,l'), inbound('Yes spare capacity')] })).toBe('three')
  })

  it.each(['Three-phase, no spare capacity', 'Three-phase, not sure about capacity', 'No spare capacity, the house has three-phase supply'])('preserves three-phase separately from capacity: %s', (body) => {
    expect(customerPropertyPhase({ requestedSpecs: { supply_type: 'three-phase' }, history: [ask, inbound(body)] })).toBe('three')
  })

  it('preserves combined phase/capacity evidence when legacy outbound metadata is absent', () => {
    expect(customerPropertyPhase({ requestedSpecs: { supply_type: 'three-phase' }, history: [inbound('Three-phase, no spare capacity')] })).toBe('three')
  })

  it.each([
    [],
    [inbound('My Tesla Wall Connector is 7kW')],
    [inbound('My workshop has three phase')],
    [{ direction: 'outbound' as const, body: "We'll supply a three-phase charger. Sound right?" }, inbound('Sounds right')],
    [ask, inbound('No three phase')],
    [ask, inbound('Is three phase better?')],
    [ask, inbound('I think three phase')],
  ].map((history) => ({ history })))('does not create customer property evidence from $history', ({ history }) => {
    expect(customerPropertyPhase({ requestedSpecs: { supply_type: 'three-phase' }, history })).toBeNull()
  })
})
