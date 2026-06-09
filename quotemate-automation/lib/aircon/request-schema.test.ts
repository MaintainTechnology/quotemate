import { describe, expect, it } from 'vitest'
import { RecommendRequestSchema } from './request-schema'

const valid = {
  address: { address: '12 Smith St, Brisbane', postcode: '4000', state: 'QLD' },
  inputs: {
    bedrooms: 3,
    bathrooms: 2,
    living_spaces: 2,
    floor_area_m2: 180,
    ceiling_height: 'standard',
    insulation: 'average',
    current_situation: 'replacing',
    budget: 12000,
  },
}

describe('RecommendRequestSchema', () => {
  it('accepts a well-formed request', () => {
    expect(RecommendRequestSchema.safeParse(valid).success).toBe(true)
  })
  it('rejects a non-4-digit postcode', () => {
    const bad = { ...valid, address: { ...valid.address, postcode: '40' } }
    expect(RecommendRequestSchema.safeParse(bad).success).toBe(false)
  })
  it('rejects a home with no bedrooms and no living spaces', () => {
    const bad = { ...valid, inputs: { ...valid.inputs, bedrooms: 0, living_spaces: 0 } }
    expect(RecommendRequestSchema.safeParse(bad).success).toBe(false)
  })
  it('accepts omitted optional floor area and budget', () => {
    const { floor_area_m2, budget, ...rest } = valid.inputs
    const ok = { ...valid, inputs: rest }
    expect(RecommendRequestSchema.safeParse(ok).success).toBe(true)
  })
})
