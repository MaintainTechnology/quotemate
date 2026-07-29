import { describe, it, expect } from 'vitest'
import { recipeSlotsFrom } from './recipe-slots'
import { JOB_FIELDS } from './job-fields'

describe('recipeSlotsFrom', () => {
  it('coerces a distance answer to a number', () => {
    expect(recipeSlotsFrom({ distance_to_existing_power: '8' })).toEqual({
      distance_to_existing_power: 8,
    })
    expect(recipeSlotsFrom({ distance_to_existing_power: ' 12.5 ' })).toEqual({
      distance_to_existing_power: 12.5,
    })
  })

  it('OMITS a blank distance rather than stamping 0', () => {
    // Number('') === 0, which is finite and >= 0. Stamping it would read as a
    // real "0 metres" answer and lock the cheapest band, instead of letting the
    // recipe apply its own default_when_unanswered.
    expect(recipeSlotsFrom({ distance_to_existing_power: '' })).toEqual({})
    expect(recipeSlotsFrom({ distance_to_existing_power: '   ' })).toEqual({})
    expect(recipeSlotsFrom({})).toEqual({})
    expect(recipeSlotsFrom(null)).toEqual({})
    expect(recipeSlotsFrom(undefined)).toEqual({})
  })

  it('omits a non-numeric or negative distance', () => {
    expect(recipeSlotsFrom({ distance_to_existing_power: 'about 10m' })).toEqual({})
    expect(recipeSlotsFrom({ distance_to_existing_power: '-3' })).toEqual({})
  })

  it('keeps 0 when the tradie genuinely typed it', () => {
    expect(recipeSlotsFrom({ distance_to_existing_power: '0' })).toEqual({
      distance_to_existing_power: 0,
    })
  })

  it('passes the circuit value through verbatim', () => {
    expect(recipeSlotsFrom({ circuit_required: '20A' })).toEqual({ circuit_required: '20A' })
    expect(recipeSlotsFrom({ circuit_required: 'three-phase' })).toEqual({
      circuit_required: 'three-phase',
    })
    expect(recipeSlotsFrom({ circuit_required: '' })).toEqual({})
  })

  it('ignores every other answer', () => {
    expect(recipeSlotsFrom({ room: 'kitchen', count: '4', colour: 'warm white' })).toEqual({})
  })

  it('carries both slots together', () => {
    expect(
      recipeSlotsFrom({ distance_to_existing_power: '7', circuit_required: '20A', room: 'shed' }),
    ).toEqual({ distance_to_existing_power: 7, circuit_required: '20A' })
  })
})

describe('power_points recipe field wiring', () => {
  const fields = JOB_FIELDS.power_points.fields

  it('asks both recipe questions', () => {
    const codes = fields.map((f) => f.code)
    expect(codes).toContain('distance_to_existing_power')
    expect(codes).toContain('circuit_required')
  })

  // applySelectBand (lib/estimate/price-bands.ts:230) matches on an exact
  // lowercased string against the recipe's band values. "20 amp" or
  // "single phase" would match nothing and silently price as 10A, losing the
  // assembly swap. These are the literal band values from the live recipe.
  it('offers circuit options that exactly match the live recipe band values', () => {
    const circuit = fields.find((f) => f.code === 'circuit_required')
    expect(circuit?.type).toBe('select')
    expect(circuit?.options).toEqual(['10A', '20A', 'three-phase'])
  })

  it('asks the distance as a number', () => {
    expect(fields.find((f) => f.code === 'distance_to_existing_power')?.type).toBe('number')
  })
})
