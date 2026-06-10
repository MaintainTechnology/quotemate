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

  it('computes per-room volume as area × ceiling height (the load basis)', () => {
    const s = sizeAircon('temperate', baseInputs({ floor_area_m2: 100, ceiling_height: 'standard' }))
    for (const room of s.rooms) {
      expect(room.volume_m3).toBeCloseTo(room.area_m2 * 2.4, 1)
    }
    // total volume ≈ floor area × ceiling (per-room rounding drift < 1 m³)
    expect(s.total_volume_m3).toBeCloseTo(240, 0)
  })

  it('a high ceiling raises the load through the larger volume', () => {
    const std = sizeAircon('temperate', baseInputs({ floor_area_m2: 150 }))
    const high = sizeAircon('temperate', baseInputs({ floor_area_m2: 150, ceiling_height: 'high' }))
    expect(high.total_volume_m3).toBeGreaterThan(std.total_volume_m3)
    expect(high.connected_kw).toBeGreaterThan(std.connected_kw)
  })

  it('more storeys raise the load (roof heat gain + stair leakage)', () => {
    const one = sizeAircon('temperate', baseInputs({ floor_area_m2: 150, storeys: 1 }))
    const two = sizeAircon('temperate', baseInputs({ floor_area_m2: 150, storeys: 2 }))
    const three = sizeAircon('temperate', baseInputs({ floor_area_m2: 150, storeys: 3 }))
    expect(two.connected_kw).toBeGreaterThan(one.connected_kw)
    expect(three.connected_kw).toBeGreaterThan(two.connected_kw)
    expect(two.storeys).toBe(2)
  })

  it('clamps storeys to the modelled 1..3 range and defaults to 1', () => {
    expect(sizeAircon('temperate', baseInputs()).storeys).toBe(1)
    expect(sizeAircon('temperate', baseInputs({ storeys: 7 })).storeys).toBe(3)
    expect(sizeAircon('temperate', baseInputs({ storeys: 0 })).storeys).toBe(1)
  })

  it('uses a satellite floor area when none is entered (solar_footprint source)', () => {
    const s = sizeAircon('temperate', baseInputs(), {
      solar_floor_area_m2: 120,
      capture_note: '141 m2 roof footprint × 1 storey × 0.85.',
    })
    expect(s.floor_area_source).toBe('solar_footprint')
    expect(s.total_floor_area_m2).toBe(120)
    expect(s.confidence).toBe('medium')
  })

  it('an entered floor area beats the satellite evidence', () => {
    const s = sizeAircon('temperate', baseInputs({ floor_area_m2: 100 }), {
      solar_floor_area_m2: 150,
      capture_note: 'note',
    })
    expect(s.floor_area_source).toBe('entered')
    expect(s.total_floor_area_m2).toBe(100)
  })

  it('falls back to the room mix when the satellite area is implausible', () => {
    const s = sizeAircon('temperate', baseInputs(), {
      solar_floor_area_m2: 900, // 86 m² typical mix → 900 is way outside the band
      capture_note: 'note',
    })
    expect(s.floor_area_source).toBe('typical_room_mix')
    expect(s.warnings.some((w) => w.toLowerCase().includes('satellite'))).toBe(true)
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
