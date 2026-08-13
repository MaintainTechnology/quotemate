import { describe, expect, it } from 'vitest'
import { paintRoomsFromPlanExtraction } from './plan-rooms'
import { measureFromRooms } from './rooms'
import type { AcExtractedRoom, AcPlanExtraction } from '@/lib/aircon/types'

function extractedRoom(overrides: Partial<AcExtractedRoom> = {}): AcExtractedRoom {
  return {
    name: 'Room',
    room_type: 'other',
    polygon: [],
    confidence: 'high',
    ...overrides,
  }
}

function extraction(rooms: AcExtractedRoom[], overrides: Partial<AcPlanExtraction> = {}): AcPlanExtraction {
  return {
    page: 1,
    rooms,
    stated_total_area_m2: null,
    overall_note: '',
    ...overrides,
  }
}

describe('paintRoomsFromPlanExtraction — edge inputs', () => {
  it('returns [] for null', () => {
    expect(paintRoomsFromPlanExtraction(null)).toEqual([])
  })

  it('returns [] for undefined', () => {
    expect(paintRoomsFromPlanExtraction(undefined)).toEqual([])
  })

  it('returns [] for an empty rooms array', () => {
    expect(paintRoomsFromPlanExtraction(extraction([]))).toEqual([])
  })

  it('returns [] for a missing/non-array rooms field', () => {
    const bad = { page: 1, stated_total_area_m2: null, overall_note: '' } as unknown as AcPlanExtraction
    expect(paintRoomsFromPlanExtraction(bad)).toEqual([])
  })
})

describe('paintRoomsFromPlanExtraction — field mapping', () => {
  it('maps a dimensioned room fully', () => {
    const rooms = paintRoomsFromPlanExtraction(
      extraction([
        extractedRoom({
          name: 'BEDROOM 2',
          room_type: 'bedroom',
          dimensions_text: '4.35 x 3.60',
          confidence: 'high',
        }),
      ]),
    )
    expect(rooms).toHaveLength(1)
    const r = rooms[0]
    expect(r.name).toBe('BEDROOM 2')
    expect(r.room_type).toBe('bedroom')
    expect(r.width_m).toBe(4.35)
    expect(r.length_m).toBe(3.6)
    expect(r.floor_area_m2).toBeCloseTo(15.66, 5)
    expect(r.included).toBe(true)
    expect(r.source).toBe('plan')
    expect(r.confidence).toBe('high')
  })

  it('parses millimetre dimensions through the adapter', () => {
    const rooms = paintRoomsFromPlanExtraction(
      extraction([extractedRoom({ dimensions_text: '3600 × 4200' })]),
    )
    expect(rooms[0].width_m).toBe(3.6)
    expect(rooms[0].length_m).toBe(4.2)
  })

  it('falls back to area_m2 when there is no dimensions_text', () => {
    const rooms = paintRoomsFromPlanExtraction(extraction([extractedRoom({ area_m2: 16 })]))
    expect(rooms[0].width_m).toBeNull()
    expect(rooms[0].length_m).toBeNull()
    expect(rooms[0].floor_area_m2).toBe(16)
  })

  it('still returns a room with neither dimensions nor area, with floor_area_m2 null', () => {
    const rooms = paintRoomsFromPlanExtraction(extraction([extractedRoom()]))
    expect(rooms).toHaveLength(1)
    expect(rooms[0].width_m).toBeNull()
    expect(rooms[0].length_m).toBeNull()
    expect(rooms[0].floor_area_m2).toBeNull()
  })

  it('treats area_m2: 0 as no area', () => {
    const rooms = paintRoomsFromPlanExtraction(extraction([extractedRoom({ area_m2: 0 })]))
    expect(rooms[0].floor_area_m2).toBeNull()
  })

  it('treats area_m2: null as no area', () => {
    const rooms = paintRoomsFromPlanExtraction(extraction([extractedRoom({ area_m2: null })]))
    expect(rooms[0].floor_area_m2).toBeNull()
  })

  it('printed dimensions win over a conflicting area_m2', () => {
    const rooms = paintRoomsFromPlanExtraction(
      extraction([extractedRoom({ dimensions_text: '4 x 3', area_m2: 999 })]),
    )
    expect(rooms[0].floor_area_m2).toBe(12)
  })
})

describe('paintRoomsFromPlanExtraction — include/exclude', () => {
  it('excludes garage by default; includes every other type', () => {
    const rooms = paintRoomsFromPlanExtraction(
      extraction([
        extractedRoom({ name: 'Garage', room_type: 'garage' }),
        extractedRoom({ name: 'Bed 1', room_type: 'bedroom' }),
        extractedRoom({ name: 'Bath', room_type: 'bathroom' }),
      ]),
    )
    expect(rooms.find((r) => r.room_type === 'garage')!.included).toBe(false)
    expect(rooms.find((r) => r.room_type === 'bedroom')!.included).toBe(true)
    expect(rooms.find((r) => r.room_type === 'bathroom')!.included).toBe(true)
  })

  it('opts.excludeTypes overrides the default — garage included, listed types excluded', () => {
    const rooms = paintRoomsFromPlanExtraction(
      extraction([
        extractedRoom({ name: 'Garage', room_type: 'garage' }),
        extractedRoom({ name: 'Bath', room_type: 'bathroom' }),
        extractedRoom({ name: 'Laundry', room_type: 'laundry' }),
      ]),
      { excludeTypes: ['bathroom', 'laundry'] },
    )
    expect(rooms.find((r) => r.room_type === 'garage')!.included).toBe(true)
    expect(rooms.find((r) => r.room_type === 'bathroom')!.included).toBe(false)
    expect(rooms.find((r) => r.room_type === 'laundry')!.included).toBe(false)
  })

  it('opts.excludeTypes: [] includes everything, garage included', () => {
    const rooms = paintRoomsFromPlanExtraction(
      extraction([extractedRoom({ room_type: 'garage' })]),
      { excludeTypes: [] },
    )
    expect(rooms[0].included).toBe(true)
  })
})

describe('paintRoomsFromPlanExtraction — ids', () => {
  it('generates unique ids for three rooms all named "ROBE"', () => {
    const rooms = paintRoomsFromPlanExtraction(
      extraction([extractedRoom({ name: 'ROBE' }), extractedRoom({ name: 'ROBE' }), extractedRoom({ name: 'ROBE' })]),
    )
    const ids = rooms.map((r) => r.id)
    expect(new Set(ids).size).toBe(3)
  })

  it('is deterministic across repeated calls on the same input', () => {
    const input = extraction([
      extractedRoom({ name: 'BEDROOM 2', dimensions_text: '4 x 3' }),
      extractedRoom({ name: 'Living', area_m2: 20 }),
    ])
    expect(paintRoomsFromPlanExtraction(input)).toEqual(paintRoomsFromPlanExtraction(input))
  })

  it('names that slug to empty still get a non-empty, unique id', () => {
    const rooms = paintRoomsFromPlanExtraction(
      extraction([extractedRoom({ name: '---' }), extractedRoom({ name: '' })]),
    )
    expect(rooms[0].id.length).toBeGreaterThan(0)
    expect(rooms[1].id.length).toBeGreaterThan(0)
    expect(new Set(rooms.map((r) => r.id)).size).toBe(2)
  })

  it('builds a stable slug-plus-1-based-index id, e.g. "BEDROOM 2" at position 4 -> bedroom-2-4', () => {
    const rooms = paintRoomsFromPlanExtraction(
      extraction([
        extractedRoom({ name: 'A' }),
        extractedRoom({ name: 'B' }),
        extractedRoom({ name: 'C' }),
        extractedRoom({ name: 'BEDROOM 2' }),
      ]),
    )
    expect(rooms[3].id).toBe('bedroom-2-4')
  })
})

describe('paintRoomsFromPlanExtraction — order', () => {
  it('preserves input order', () => {
    const rooms = paintRoomsFromPlanExtraction(
      extraction([
        extractedRoom({ name: 'First' }),
        extractedRoom({ name: 'Second' }),
        extractedRoom({ name: 'Third' }),
      ]),
    )
    expect(rooms.map((r) => r.name)).toEqual(['First', 'Second', 'Third'])
  })
})

describe('paintRoomsFromPlanExtraction — composes with measureFromRooms', () => {
  it('adapts a worked plan extraction straight into the geometry engine', () => {
    const rooms = paintRoomsFromPlanExtraction(
      extraction([
        extractedRoom({ name: 'Bedroom', room_type: 'bedroom', dimensions_text: '4.0 x 3.0' }),
        extractedRoom({ name: 'Living', room_type: 'living', dimensions_text: '6.0 x 4.0' }),
        extractedRoom({ name: 'Garage', room_type: 'garage', dimensions_text: '6.0 x 6.0' }),
      ]),
    )
    const result = measureFromRooms(rooms, { ceilingHeightM: 2.4 })
    expect(result).not.toBeNull()
    expect(result!.floor_area_m2).toBe(36)
    expect(result!.wall_area_m2).toBe(71.8)
    expect(result!.ceiling_area_m2).toBe(36)
    expect(result!.trim_lm).toBe(40.6)
    expect(result!.rooms_used.length).toBe(2)
  })
})
