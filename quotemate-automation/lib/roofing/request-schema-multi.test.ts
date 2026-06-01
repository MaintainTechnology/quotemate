// Multi-structure request + save schemas.

import { describe, expect, it } from 'vitest'
import {
  MeasureAllRequestSchema,
  SaveRoofMeasurementSchema,
} from './request-schema'

const ADDR = { address: '670 London Rd', postcode: '4155', state: 'QLD' as const }
const INPUTS = { material: 'colorbond_trimdek', pitch: 'standard', intent: 'full_reroof' } as const

describe('MeasureAllRequestSchema', () => {
  it('accepts a shared-inputs request with no per-building overrides', () => {
    const r = MeasureAllRequestSchema.safeParse({ address: ADDR, inputs: INPUTS })
    expect(r.success).toBe(true)
  })

  it('accepts per-building partial overrides keyed by buildingId', () => {
    const r = MeasureAllRequestSchema.safeParse({
      address: ADDR,
      inputs: INPUTS,
      perBuilding: { 'bld-shed': { material: 'terracotta_tile' } },
      use_mock_provider: true,
    })
    expect(r.success).toBe(true)
  })

  it('rejects a malformed postcode', () => {
    const r = MeasureAllRequestSchema.safeParse({
      address: { ...ADDR, postcode: '41' },
      inputs: INPUTS,
    })
    expect(r.success).toBe(false)
  })

  it('rejects an invalid material in a per-building override', () => {
    const r = MeasureAllRequestSchema.safeParse({
      address: ADDR,
      inputs: INPUTS,
      perBuilding: { 'bld-shed': { material: 'thatch' } },
    })
    expect(r.success).toBe(false)
  })
})

describe('SaveRoofMeasurementSchema', () => {
  const structure = {
    buildingId: 'bld-house',
    role: 'primary' as const,
    label: 'Main dwelling',
    inputs: INPUTS,
  }

  it('accepts a valid save with one or more structures', () => {
    const r = SaveRoofMeasurementSchema.safeParse({
      address: ADDR,
      provider: 'geoscape',
      structures: [structure, { ...structure, buildingId: 'bld-shed', role: 'secondary', label: 'Secondary structure 1' }],
      quote: { combined: { area_m2: 270 } },
    })
    expect(r.success).toBe(true)
  })

  it('rejects an empty structures array', () => {
    const r = SaveRoofMeasurementSchema.safeParse({
      address: ADDR,
      provider: 'geoscape',
      structures: [],
    })
    expect(r.success).toBe(false)
  })

  it('allows a null buildingId (manual / sub-polygon structure)', () => {
    const r = SaveRoofMeasurementSchema.safeParse({
      address: ADDR,
      provider: 'mock',
      structures: [{ ...structure, buildingId: null }],
    })
    expect(r.success).toBe(true)
  })
})
