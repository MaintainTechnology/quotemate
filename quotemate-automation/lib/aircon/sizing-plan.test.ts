// Floor-plan path of the sizing engine — real rooms replace the
// synthetic mix, confidence follows whether the plan was dimensioned.

import { describe, expect, it } from 'vitest'
import { sizeAircon } from './sizing'
import type { AcPlanAreaEvidence, AcPropertyInputs } from './types'

const INPUTS: AcPropertyInputs = {
  bedrooms: 3,
  bathrooms: 2,
  living_spaces: 1,
  storeys: 1,
  floor_area_m2: null,
  ceiling_height: 'standard',
  insulation: 'average',
  current_situation: 'replacing',
  budget: null,
}

const PLAN: AcPlanAreaEvidence = {
  rooms: [
    { name: 'BED 1', room_type: 'bedroom', area_m2: 16 },
    { name: 'BED 2', room_type: 'bedroom', area_m2: 12 },
    { name: 'FAMILY', room_type: 'living', area_m2: 38 },
  ],
  dimensioned: true,
  capture_note: '3 conditioned rooms from a dimensioned builder plan.',
}

describe('sizeAircon with floor-plan rooms', () => {
  it('uses the real rooms, named, with floor_plan as the area source', () => {
    const sizing = sizeAircon('temperate', INPUTS, null, PLAN)
    expect(sizing.floor_area_source).toBe('floor_plan')
    expect(sizing.conditioned_zones).toBe(3)
    expect(sizing.rooms.map((r) => r.name)).toEqual(['BED 1', 'BED 2', 'FAMILY'])
    expect(sizing.rooms.map((r) => r.area_m2)).toEqual([16, 12, 38])
    expect(sizing.total_floor_area_m2).toBe(66)
  })

  it('computes per-room volumetric loads from the real areas', () => {
    const sizing = sizeAircon('temperate', INPUTS, null, PLAN)
    // BED 1: 16 m² × 2.4 m = 38.4 m³ × 0.0625 × 0.7 (bedroom) = 1.68 kW
    expect(sizing.rooms[0].volume_m3).toBeCloseTo(38.4, 1)
    expect(sizing.rooms[0].kw).toBeCloseTo(1.68, 2)
    // FAMILY: 38 m² × 2.4 m = 91.2 m³ × 0.0625 × 1.0 (living) = 5.7 kW
    expect(sizing.rooms[2].kw).toBeCloseTo(5.7, 2)
  })

  it('pins confidence high (±10%) for a dimensioned plan', () => {
    const sizing = sizeAircon('temperate', INPUTS, null, PLAN)
    expect(sizing.confidence).toBe('high')
    expect(sizing.connected_kw_low).toBeCloseTo(sizing.connected_kw * 0.9, 1)
    expect(sizing.connected_kw_high).toBeCloseTo(sizing.connected_kw * 1.1, 1)
  })

  it('caps confidence at medium for an undimensioned plan', () => {
    const sizing = sizeAircon('temperate', INPUTS, null, { ...PLAN, dimensioned: false })
    expect(sizing.confidence).toBe('medium')
    expect(sizing.notes.join(' ')).toMatch(/no printed dimensions/)
  })

  it('notes when the plan room count disagrees with the form counts', () => {
    // Form declares 3 bed + 1 living = 4; plan has 3 conditioned rooms.
    const sizing = sizeAircon('temperate', INPUTS, null, PLAN)
    expect(sizing.notes.join(' ')).toMatch(/the plan wins/)
  })

  it('ignores an empty plan and keeps the existing behaviour', () => {
    const withEmptyPlan = sizeAircon('temperate', INPUTS, null, {
      rooms: [],
      dimensioned: false,
      capture_note: 'nothing extracted',
    })
    const without = sizeAircon('temperate', INPUTS, null)
    expect(withEmptyPlan).toEqual(without)
    expect(withEmptyPlan.floor_area_source).toBe('typical_room_mix')
  })

  it('leaves the form-only path byte-identical when no plan is passed', () => {
    const a = sizeAircon('subtropical', { ...INPUTS, floor_area_m2: 140 })
    expect(a.floor_area_source).toBe('entered')
    expect(a.confidence).toBe('high')
    expect(a.conditioned_zones).toBe(4)
    // synthetic rooms: 3 bedrooms + 1 living scaled to 140 m² (typical 61)
    expect(a.total_floor_area_m2).toBe(140)
  })

  it('applies insulation/storey factors to plan rooms too', () => {
    const sizing = sizeAircon(
      'temperate',
      { ...INPUTS, insulation: 'poor', storeys: 2 },
      null,
      PLAN,
    )
    // BED 1: 38.4 m³ × 0.0625 × 0.7 × 1.15 (poor) × 1.06 (2 storeys) ≈ 2.05
    expect(sizing.rooms[0].kw).toBeCloseTo(2.05, 2)
  })
})
