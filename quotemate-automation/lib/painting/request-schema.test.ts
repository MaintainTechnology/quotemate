import { describe, expect, it } from 'vitest'
import { EstimateRequestSchema, PaintInputsSchema } from './request-schema'

const INPUTS = {
  scopes: ['walls'],
  coats: 2,
  condition: 'sound',
  ceiling_height: 'standard',
  colour_change: false,
}

describe('PaintInputsSchema — structure selection', () => {
  it('accepts and round-trips a chosen structure', () => {
    const parsed = PaintInputsSchema.safeParse({
      ...INPUTS,
      structure: { building_id: 'bldshed222', label: 'Secondary building 1', role: 'secondary' },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.structure).toEqual({
        building_id: 'bldshed222',
        label: 'Secondary building 1',
        role: 'secondary',
      })
    }
  })

  it('structure is optional (the no-selection path is unchanged)', () => {
    const parsed = PaintInputsSchema.safeParse(INPUTS)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.structure).toBeUndefined()
  })

  it('rejects a structure without a building_id and an invalid role', () => {
    expect(PaintInputsSchema.safeParse({ ...INPUTS, structure: { label: 'x' } }).success).toBe(false)
    expect(
      PaintInputsSchema.safeParse({ ...INPUTS, structure: { building_id: 'b0', role: 'tertiary' } }).success,
    ).toBe(false)
  })

  it('flows through the estimate request schema', () => {
    const parsed = EstimateRequestSchema.safeParse({
      address: { address: '21 Greens Rd, Coorparoo', postcode: '4151', state: 'QLD' },
      inputs: { ...INPUTS, structure: { building_id: 'b0' } },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.inputs.structure?.building_id).toBe('b0')
  })
})
