import { describe, it, expect } from 'vitest'
import { SolarEstimateRequestSchema } from './request-schema'

describe('SolarEstimateRequestSchema', () => {
  it('accepts a minimal address-only body', () => {
    const r = SolarEstimateRequestSchema.safeParse({
      address: { address: '1 Test St, Sydney', postcode: '2000', state: 'NSW' },
    })
    expect(r.success).toBe(true)
  })

  it('accepts an optional manual-roof block', () => {
    const r = SolarEstimateRequestSchema.safeParse({
      address: { address: '1 Test St', postcode: '4000', state: 'QLD' },
      manual: { orientation: 'north', roof_size: 'medium', storeys: 1 },
      panel_type: 'premium_panels',
    })
    expect(r.success).toBe(true)
  })

  it('rejects a too-short address', () => {
    const r = SolarEstimateRequestSchema.safeParse({
      address: { address: 'x', postcode: '2000', state: 'NSW' },
    })
    expect(r.success).toBe(false)
  })

  it('rejects an out-of-enum state', () => {
    const r = SolarEstimateRequestSchema.safeParse({
      address: { address: '1 Test St', postcode: '2000', state: 'ZZ' },
    })
    expect(r.success).toBe(false)
  })

  it('rejects an out-of-enum manual orientation', () => {
    const r = SolarEstimateRequestSchema.safeParse({
      address: { address: '1 Test St', postcode: '2000', state: 'NSW' },
      manual: { orientation: 'sideways', roof_size: 'small', storeys: 1 },
    })
    expect(r.success).toBe(false)
  })

  it('rejects an out-of-range storeys', () => {
    const r = SolarEstimateRequestSchema.safeParse({
      address: { address: '1 Test St', postcode: '2000', state: 'NSW' },
      manual: { orientation: 'north', roof_size: 'small', storeys: 9 },
    })
    expect(r.success).toBe(false)
  })

  it('accepts a 40 kW preferred system size', () => {
    const r = SolarEstimateRequestSchema.safeParse({
      address: { address: '1 Test St', postcode: '2000', state: 'NSW' },
      requested_size_kw: 40,
    })
    expect(r.success).toBe(true)
  })
})
