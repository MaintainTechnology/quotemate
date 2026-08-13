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

describe('PaintInputsSchema — room schedule', () => {
  const ROOM = {
    id: 'bedroom-1',
    name: 'BEDROOM 2',
    room_type: 'bedroom',
    width_m: 4.35,
    length_m: 3.6,
    floor_area_m2: 15.66,
    included: true,
    source: 'plan',
    confidence: 'high',
  }

  it('accepts and round-trips a room schedule', () => {
    const parsed = PaintInputsSchema.safeParse({ ...INPUTS, rooms: [ROOM] })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.rooms).toEqual([ROOM])
  })

  it('carries rooms through the whole estimate request', () => {
    const parsed = EstimateRequestSchema.safeParse({
      address: { address: '670 London Road, Chandler', postcode: '4155', state: 'QLD' },
      inputs: { ...INPUTS, rooms: [ROOM] },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.inputs.rooms?.[0].id).toBe('bedroom-1')
  })

  it('accepts a room with no printed dimensions', () => {
    const parsed = PaintInputsSchema.safeParse({
      ...INPUTS,
      rooms: [{ ...ROOM, width_m: null, length_m: null, floor_area_m2: 16 }],
    })
    expect(parsed.success).toBe(true)
  })

  it('rooms is optional (the no-schedule path is unchanged)', () => {
    const parsed = PaintInputsSchema.safeParse(INPUTS)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.rooms).toBeUndefined()
  })

  it('rejects an implausible room dimension', () => {
    const parsed = PaintInputsSchema.safeParse({ ...INPUTS, rooms: [{ ...ROOM, width_m: 500 }] })
    expect(parsed.success).toBe(false)
  })

  it('rejects an unknown room type', () => {
    const parsed = PaintInputsSchema.safeParse({
      ...INPUTS,
      rooms: [{ ...ROOM, room_type: 'ballroom' }],
    })
    expect(parsed.success).toBe(false)
  })
})
