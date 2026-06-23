import { describe, expect, it } from 'vitest'
import { MeasureRequestSchema } from './request-schema'

const VALID = {
  address: { address: '12 Test St', postcode: '2750', state: 'NSW' },
  inputs: {
    material: 'colorbond_trimdek',
    pitch: 'standard',
    building_year_built: 2005,
    intent: 'full_reroof',
  },
}

describe('MeasureRequestSchema', () => {
  it('accepts a well-formed request', () => {
    expect(() => MeasureRequestSchema.parse(VALID)).not.toThrow()
  })

  it('rejects non-AU postcode formats', () => {
    expect(() =>
      MeasureRequestSchema.parse({ ...VALID, address: { ...VALID.address, postcode: '12345' } }),
    ).toThrow()
    expect(() =>
      MeasureRequestSchema.parse({ ...VALID, address: { ...VALID.address, postcode: 'abcd' } }),
    ).toThrow()
  })

  it('rejects unknown material values', () => {
    expect(() =>
      MeasureRequestSchema.parse({
        ...VALID,
        inputs: { ...VALID.inputs, material: 'slate' as unknown as 'unknown' },
      }),
    ).toThrow()
  })

  it('accepts the new Corrugated and Spandek COLORBOND materials', () => {
    for (const material of ['colorbond_corrugated', 'colorbond_spandek'] as const) {
      expect(() =>
        MeasureRequestSchema.parse({ ...VALID, inputs: { ...VALID.inputs, material } }),
      ).not.toThrow()
    }
  })

  it('rejects unknown state codes', () => {
    expect(() =>
      MeasureRequestSchema.parse({
        ...VALID,
        address: { ...VALID.address, state: 'XX' as unknown as 'NSW' },
      }),
    ).toThrow()
  })

  it('rejects building_year_built outside the sane range', () => {
    expect(() =>
      MeasureRequestSchema.parse({
        ...VALID,
        inputs: { ...VALID.inputs, building_year_built: 1700 },
      }),
    ).toThrow()
  })

  it('accepts a null building_year_built', () => {
    expect(() =>
      MeasureRequestSchema.parse({
        ...VALID,
        inputs: { ...VALID.inputs, building_year_built: null },
      }),
    ).not.toThrow()
  })

  it('accepts use_mock_provider when present', () => {
    const parsed = MeasureRequestSchema.parse({ ...VALID, use_mock_provider: true })
    expect(parsed.use_mock_provider).toBe(true)
  })
})
