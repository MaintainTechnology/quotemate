import { describe, expect, it } from 'vitest'
import { sizeAircon, roundUpToUnit, roundUpHalf, CONFIDENCE_BAND } from './sizing'
import type { AcPropertyInputs } from './types'

function baseInputs(overrides: Partial<AcPropertyInputs> = {}): AcPropertyInputs {
  return {
    bedrooms: 3,
    bathrooms: 2,
    living_spaces: 2,
    ceiling_height: 'standard',
    insulation: 'average',
    current_situation: 'replacing',
    ...overrides,
  }
}

describe('sizeAircon', () => {
  it('counts conditioned zones as bedrooms + living spaces (bathrooms excluded)', () => {
    const s = sizeAircon('temperate', baseInputs())
    expect(s.conditioned_zones).toBe(5) // 3 + 2
    expect(s.rooms).toHaveLength(5)
  })

  it('pins confidence high and uses the supplied floor area', () => {
    const s = sizeAircon('temperate', baseInputs({ floor_area_m2: 180 }))
    expect(s.confidence).toBe('high')
    expect(s.total_floor_area_m2).toBe(180)
  })

  it('uses medium confidence for counts-only with both beds and living', () => {
    const s = sizeAircon('temperate', baseInputs({ floor_area_m2: null }))
    expect(s.confidence).toBe('medium')
  })

  it('drops to low confidence when only one of beds/living is given', () => {
    const s = sizeAircon('temperate', baseInputs({ bedrooms: 3, living_spaces: 0 }))
    expect(s.confidence).toBe('low')
  })

  it('computes volume as floor area × ceiling height', () => {
    const s = sizeAircon('temperate', baseInputs({ floor_area_m2: 100, ceiling_height: 'standard' }))
    expect(s.total_volume_m3).toBe(240) // 100 × 2.4
  })

  it('ducted size is connected × 0.8 diversity', () => {
    const s = sizeAircon('temperate', baseInputs({ floor_area_m2: 180 }))
    expect(s.ducted_kw).toBeCloseTo(s.connected_kw * 0.8, 2)
  })

  it('hotter climate yields more kW than cooler for the same home', () => {
    const cool = sizeAircon('cool', baseInputs({ floor_area_m2: 150 }))
    const tropical = sizeAircon('tropical', baseInputs({ floor_area_m2: 150 }))
    expect(tropical.connected_kw).toBeGreaterThan(cool.connected_kw)
  })

  it('applies the confidence band to the connected-kW range', () => {
    const s = sizeAircon('temperate', baseInputs({ floor_area_m2: 150 }))
    const band = CONFIDENCE_BAND[s.confidence]
    expect(s.connected_kw_low).toBeCloseTo(s.connected_kw * (1 - band), 2)
    expect(s.connected_kw_high).toBeCloseTo(s.connected_kw * (1 + band), 2)
  })
})

describe('roundUpToUnit', () => {
  it('rounds up to the next common AU split size', () => {
    expect(roundUpToUnit(1.2)).toBe(2.5)
    expect(roundUpToUnit(2.6)).toBe(3.5)
    expect(roundUpToUnit(4.9)).toBe(5)
  })
  it('caps at the largest single-head size', () => {
    expect(roundUpToUnit(12)).toBe(8)
  })
})

describe('roundUpHalf', () => {
  it('rounds up to the nearest 0.5 kW', () => {
    expect(roundUpHalf(9.1)).toBe(9.5)
    expect(roundUpHalf(10)).toBe(10)
  })
})
