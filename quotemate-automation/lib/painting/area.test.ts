import { describe, expect, it } from 'vitest'
import {
  measurePaintableArea,
  resolveFloorArea,
  __test_only__,
} from './area'
import type { PaintMeasurement, PaintRoom, PaintUserInputs, PropertyFacts } from './types'
import { customerMeasurementNotes } from './customer-notes'

function baseFacts(overrides: Partial<PropertyFacts> = {}): PropertyFacts {
  return {
    floor_area_m2: 150,
    floor_area_source: 'listing',
    footprint_m2: 160,
    storeys: 1,
    bedrooms: 3,
    bathrooms: 2,
    year_built: 2005,
    property_type: 'House',
    land_size_m2: 450,
    has_floor_plan: true,
    source: 'mock',
    capture_note: null,
    ...overrides,
  }
}

function baseInputs(overrides: Partial<PaintUserInputs> = {}): PaintUserInputs {
  return {
    scopes: ['walls', 'ceilings'],
    coats: 2,
    condition: 'sound',
    ceiling_height: 'standard',
    colour_change: false,
    ...overrides,
  }
}

describe('resolveFloorArea', () => {
  it('prefers a hand-entered floor area and pins confidence high', () => {
    const r = resolveFloorArea(baseFacts(), baseInputs({ manual_floor_area_m2: 220 }))
    expect(r?.floor_area_m2).toBe(220)
    expect(r?.source).toBe('manual')
    expect(r?.confidence).toBe('high')
  })

  it('uses a listing building size at high confidence', () => {
    const r = resolveFloorArea(baseFacts(), baseInputs())
    expect(r?.floor_area_m2).toBe(150)
    expect(r?.source).toBe('listing')
    expect(r?.confidence).toBe('high')
  })

  it('falls back to footprint × storeys × eaves correction at medium confidence', () => {
    const r = resolveFloorArea(
      baseFacts({ floor_area_m2: null, footprint_m2: 160, storeys: 2 }),
      baseInputs(),
    )
    // 160 × 2 × 0.9 = 288
    expect(r?.floor_area_m2).toBe(288)
    expect(r?.source).toBe('footprint')
    expect(r?.confidence).toBe('medium')
  })

  it('falls back to a bedroom estimate at low confidence', () => {
    const r = resolveFloorArea(
      baseFacts({ floor_area_m2: null, footprint_m2: null, bedrooms: 3 }),
      baseInputs(),
    )
    expect(r?.floor_area_m2).toBe(3 * __test_only__.FLOOR_AREA_PER_BEDROOM)
    expect(r?.source).toBe('beds_estimate')
    expect(r?.confidence).toBe('low')
  })

  it('returns null when nothing usable is available', () => {
    const r = resolveFloorArea(
      baseFacts({ floor_area_m2: null, footprint_m2: null, bedrooms: null }),
      baseInputs(),
    )
    expect(r).toBeNull()
  })
})

describe('measurePaintableArea', () => {
  it('derives walls = floor × 2.8 and ceilings = floor at 2.4 m', () => {
    const m = measurePaintableArea(baseFacts(), baseInputs({ scopes: ['walls', 'ceilings'] }))
    expect(m).not.toBeNull()
    const walls = m!.surfaces.find((s) => s.scope === 'walls')
    const ceilings = m!.surfaces.find((s) => s.scope === 'ceilings')
    expect(walls?.quantity).toBe(420) // 150 × 2.8
    expect(walls?.unit).toBe('m2')
    expect(ceilings?.quantity).toBe(150) // 150 × 1.0
  })

  it('applies the high-confidence ±12% band to each quantity', () => {
    const m = measurePaintableArea(baseFacts(), baseInputs({ scopes: ['walls'] }))
    const walls = m!.surfaces.find((s) => s.scope === 'walls')!
    expect(walls.quantity_low).toBeCloseTo(420 * 0.88, 1) // 369.6
    expect(walls.quantity_high).toBeCloseTo(420 * 1.12, 1) // 470.4
    expect(m!.confidence).toBe('high')
  })

  it('uses the taller 3.2 multiplier for high ceilings', () => {
    const m = measurePaintableArea(baseFacts(), baseInputs({ scopes: ['walls'], ceiling_height: 'high' }))
    const walls = m!.surfaces.find((s) => s.scope === 'walls')!
    expect(walls.quantity).toBe(480) // 150 × 3.2
    expect(m!.ceiling_height_m).toBe(2.7)
  })

  it('emits trim as linear metres, not m²', () => {
    const m = measurePaintableArea(baseFacts(), baseInputs({ scopes: ['trim'] }))
    const trim = m!.surfaces.find((s) => s.scope === 'trim')!
    expect(trim.unit).toBe('lm')
    expect(trim.quantity).toBeGreaterThan(0)
  })

  it('derives a positive exterior façade and scales with storeys', () => {
    const single = measurePaintableArea(baseFacts({ storeys: 1 }), baseInputs({ scopes: ['exterior'] }))
    const double = measurePaintableArea(baseFacts({ storeys: 2 }), baseInputs({ scopes: ['exterior'] }))
    const facadeSingle = single!.surfaces.find((s) => s.scope === 'exterior')!.quantity
    const facadeDouble = double!.surfaces.find((s) => s.scope === 'exterior')!.quantity
    expect(facadeSingle).toBeGreaterThan(0)
    expect(facadeDouble).toBeGreaterThan(facadeSingle)
  })

  it('returns null when there is no usable floor area', () => {
    const m = measurePaintableArea(
      baseFacts({ floor_area_m2: null, footprint_m2: null, bedrooms: null }),
      baseInputs(),
    )
    expect(m).toBeNull()
  })
})

// ── Per-room basis (spec painting-room-schedule §C) ──────────────────

function room(overrides: Partial<PaintRoom> = {}): PaintRoom {
  return {
    id: 'r-1',
    name: 'Bedroom 1',
    room_type: 'bedroom',
    width_m: 4,
    length_m: 3,
    floor_area_m2: 12,
    included: true,
    source: 'plan',
    confidence: 'high',
    ...overrides,
  }
}

/** The spec's worked example: 4×3 bedroom + 6×4 living, garage excluded. */
function workedRooms(): PaintRoom[] {
  return [
    room({ id: 'bedroom-1' }),
    room({
      id: 'living-2',
      name: 'Living',
      room_type: 'living',
      width_m: 6,
      length_m: 4,
      floor_area_m2: 24,
    }),
    room({
      id: 'garage-3',
      name: 'Garage',
      room_type: 'garage',
      width_m: 6,
      length_m: 6,
      floor_area_m2: 36,
      included: false,
    }),
  ]
}

const ROOM_SCOPES: PaintUserInputs['scopes'] = ['walls', 'ceilings', 'trim']

describe('measurePaintableArea — per-room basis', () => {
  it('measures walls, ceilings and trim from the room schedule', () => {
    const m = measurePaintableArea(
      baseFacts(),
      baseInputs({ scopes: ROOM_SCOPES, rooms: workedRooms() }),
    )
    expect(m?.basis).toBe('rooms')
    expect(m?.floor_area_m2).toBe(36)
    expect(m?.floor_area_source).toBe('floor_plan')
    expect(m?.confidence).toBe('high')
    expect(m?.surfaces.find((s) => s.scope === 'walls')?.quantity).toBe(71.8)
    expect(m?.surfaces.find((s) => s.scope === 'ceilings')?.quantity).toBe(36)
    expect(m?.surfaces.find((s) => s.scope === 'trim')?.quantity).toBe(40.6)
  })

  it('echoes only the included rooms that contributed geometry', () => {
    const m = measurePaintableArea(
      baseFacts(),
      baseInputs({ scopes: ROOM_SCOPES, rooms: workedRooms() }),
    )
    expect(m?.rooms?.map((r) => r.id)).toEqual(['bedroom-1', 'living-2'])
  })

  it('drops confidence to medium when a room had no printed dimensions', () => {
    const rooms = [
      room({ id: 'a' }),
      room({ id: 'b', width_m: null, length_m: null, floor_area_m2: 16 }),
    ]
    const m = measurePaintableArea(baseFacts(), baseInputs({ scopes: ROOM_SCOPES, rooms }))
    expect(m?.confidence).toBe('medium')
  })

  it('leaves the exterior derivation on the footprint, not the rooms', () => {
    const withRooms = measurePaintableArea(
      baseFacts(),
      baseInputs({ scopes: ['exterior'], rooms: workedRooms() }),
    )
    const without = measurePaintableArea(baseFacts(), baseInputs({ scopes: ['exterior'] }))
    const ext = (m: PaintMeasurement | null) =>
      m?.surfaces.find((s) => s.scope === 'exterior')?.quantity
    expect(ext(withRooms)).toBe(ext(without))
  })

  it('keeps the exterior identical even when there is no footprint to fall back on', () => {
    // The fallback is floor / storeys — it must use the whole-house floor
    // area, never the (much smaller) room-schedule total. Spec item 19.
    const facts = baseFacts({ footprint_m2: null })
    const withRooms = measurePaintableArea(
      facts,
      baseInputs({ scopes: ['exterior'], rooms: workedRooms() }),
    )
    const without = measurePaintableArea(facts, baseInputs({ scopes: ['exterior'] }))
    const ext = (m: PaintMeasurement | null) =>
      m?.surfaces.find((s) => s.scope === 'exterior')?.quantity
    expect(ext(without)).toBeGreaterThan(0)
    expect(ext(withRooms)).toBe(ext(without))
  })

  it('ignores the room schedule when the tradie targeted one building', () => {
    // A plan's rooms cover the whole property; a targeted structure is one
    // building of several. Measuring every room would quote the wrong one.
    const m = measurePaintableArea(
      baseFacts(),
      baseInputs({
        scopes: ROOM_SCOPES,
        rooms: workedRooms(),
        structure: { building_id: 'bld-2', role: 'secondary' },
      }),
    )
    expect(m?.basis).toBe('whole_house')
    const note = m!.notes.find((n) => /selected building/i.test(n))
    expect(note).toBeDefined()
    // It reaches the customer page and the customer PDF, so it must read
    // to a homeowner — no internal jargon, and it survives the filter.
    expect(note).not.toMatch(/room schedule|was not used/i)
    expect(customerMeasurementNotes([note!])).toEqual([note])
  })

  it('lets a hand-entered floor area beat the room schedule', () => {
    const m = measurePaintableArea(
      baseFacts(),
      baseInputs({ scopes: ROOM_SCOPES, rooms: workedRooms(), manual_floor_area_m2: 220 }),
    )
    expect(m?.basis).toBe('whole_house')
    expect(m?.floor_area_m2).toBe(220)
    expect(m?.floor_area_source).toBe('manual')
  })

  it('writes room notes that survive the customer-safe note filter', () => {
    const m = measurePaintableArea(
      baseFacts(),
      baseInputs({ scopes: ROOM_SCOPES, rooms: workedRooms() }),
    )
    const roomNotes = m!.notes.filter((n) => /room/i.test(n))
    expect(roomNotes.length).toBeGreaterThan(0)
    expect(customerMeasurementNotes(roomNotes)).toEqual(roomNotes)
  })

  it('corrects both directions of the defect on a 12-room house', () => {
    const rooms = Array.from({ length: 12 }, (_, i) => room({ id: `r-${i}` }))
    const m = measurePaintableArea(baseFacts(), baseInputs({ scopes: ROOM_SCOPES, rooms }))
    const floor = m!.floor_area_m2 // 12 rooms × 12 m² = 144
    const heuristicWalls = floor * __test_only__.WALL_MULTIPLIER.standard
    const heuristicTrim = 1.08 * 4 * Math.sqrt(floor) * 1.6
    const walls = m!.surfaces.find((s) => s.scope === 'walls')!.quantity
    const trim = m!.surfaces.find((s) => s.scope === 'trim')!.quantity
    expect(trim).toBeGreaterThan(heuristicTrim)
    expect(walls).toBeLessThan(heuristicWalls)
  })
})

describe('measurePaintableArea — whole-house fallback is unchanged', () => {
  const scopes: PaintUserInputs['scopes'] = ['walls', 'ceilings', 'trim', 'exterior']

  function expectIdenticalToBare(rooms: PaintRoom[] | undefined) {
    const withRooms = measurePaintableArea(baseFacts(), baseInputs({ scopes, rooms }))
    const bare = measurePaintableArea(baseFacts(), baseInputs({ scopes }))
    // Everything but the new `basis` marker must match exactly.
    expect({ ...withRooms, basis: undefined }).toEqual({ ...bare, basis: undefined })
    expect(withRooms?.basis).toBe('whole_house')
    expect(withRooms?.rooms).toBeUndefined()
  }

  it('is byte-identical when rooms are absent', () => expectIdenticalToBare(undefined))
  it('is byte-identical when rooms is empty', () => expectIdenticalToBare([]))
  it('is byte-identical when every room is excluded', () =>
    expectIdenticalToBare(workedRooms().map((r) => ({ ...r, included: false }))))
  it('is byte-identical when no room yields geometry', () =>
    expectIdenticalToBare([room({ width_m: null, length_m: null, floor_area_m2: null })]))
})

describe('resolveFloorArea — floor_plan source', () => {
  it('treats a floor-plan-sourced area as high confidence', () => {
    const r = resolveFloorArea(
      baseFacts({ floor_area_m2: 180, floor_area_source: 'floor_plan' }),
      baseInputs(),
    )
    expect(r?.source).toBe('floor_plan')
    expect(r?.confidence).toBe('high')
  })
})
