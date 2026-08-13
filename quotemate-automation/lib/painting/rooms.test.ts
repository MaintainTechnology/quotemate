import { describe, expect, it } from 'vitest'
import {
  ARCHITRAVE_LM_PER_ROOM,
  measureFromRooms,
  parseRoomDimensions,
  roomPerimeterM,
  ROOM_OPENING_DEDUCTION,
  SKIRTING_RUN_FACTOR,
} from './rooms'
import { parseDimensionText } from '@/lib/aircon/plan-scale'
import type { PaintRoom } from './types'

function room(overrides: Partial<PaintRoom> = {}): PaintRoom {
  return {
    id: 'room-1',
    name: 'Room',
    room_type: 'other',
    width_m: null,
    length_m: null,
    floor_area_m2: null,
    included: true,
    source: 'plan',
    confidence: 'high',
    ...overrides,
  }
}

describe('parseRoomDimensions', () => {
  it('parses "3.6 x 4.2"', () => {
    expect(parseRoomDimensions('3.6 x 4.2')).toEqual({ width_m: 3.6, length_m: 4.2 })
  })

  it('parses "3600 × 4200" as millimetres', () => {
    expect(parseRoomDimensions('3600 × 4200')).toEqual({ width_m: 3.6, length_m: 4.2 })
  })

  it('parses "3.6m x 4.2m"', () => {
    expect(parseRoomDimensions('3.6m x 4.2m')).toEqual({ width_m: 3.6, length_m: 4.2 })
  })

  it('parses "3,600 x 4,200"', () => {
    expect(parseRoomDimensions('3,600 x 4,200')).toEqual({ width_m: 3.6, length_m: 4.2 })
  })

  it.each([undefined, null, '', 'no dimensions here', '0 x 4', '4 x'])(
    'returns null for %p',
    (input) => {
      expect(parseRoomDimensions(input as string | null | undefined)).toBeNull()
    },
  )

  it('agrees with the aircon parser on the area implied by each string', () => {
    const cases = ['3.6 x 4.2', '3600 × 4200', '3.6m x 4.2m', '3,600 x 4,200']
    for (const text of cases) {
      const parsed = parseRoomDimensions(text)
      const acArea = parseDimensionText(text)
      expect(parsed).not.toBeNull()
      expect(acArea).not.toBeNull()
      expect(parsed!.width_m * parsed!.length_m).toBeCloseTo(acArea as number, 2)
    }
  })
})

describe('roomPerimeterM', () => {
  it('uses 2×(width+length) when both dims are known', () => {
    expect(roomPerimeterM(room({ width_m: 4.0, length_m: 3.0 }))).toBe(14.0)
  })

  it('falls back to the shape-factor formula from floor area', () => {
    const p = roomPerimeterM(room({ floor_area_m2: 16.0 }))
    expect(p).toBeCloseTo(1.08 * 4 * Math.sqrt(16.0), 10)
  })

  it('returns null when neither dims nor area are known', () => {
    expect(roomPerimeterM(room())).toBeNull()
  })
})

describe('measureFromRooms', () => {
  it('worked example: two dimensioned rooms in, one excluded garage out', () => {
    const rooms: PaintRoom[] = [
      room({
        id: 'bedroom-1',
        name: 'Bedroom',
        room_type: 'bedroom',
        width_m: 4.0,
        length_m: 3.0,
        included: true,
      }),
      room({
        id: 'living-2',
        name: 'Living',
        room_type: 'living',
        width_m: 6.0,
        length_m: 4.0,
        included: true,
      }),
      room({
        id: 'garage-3',
        name: 'Garage',
        room_type: 'garage',
        width_m: 6.0,
        length_m: 6.0,
        included: false,
      }),
    ]

    const result = measureFromRooms(rooms, { ceilingHeightM: 2.4 })

    expect(result).not.toBeNull()
    expect(result!.floor_area_m2).toBe(36.0)
    expect(result!.wall_area_m2).toBe(71.8)
    expect(result!.ceiling_area_m2).toBe(36.0)
    expect(result!.trim_lm).toBe(40.6)
    expect(result!.rooms_used.length).toBe(2)
    expect(result!.rooms_without_dimensions).toBe(0)
    expect(result!.all_dimensioned).toBe(true)
  })

  it('sizes an undimensioned room from floor area and flags it', () => {
    const rooms: PaintRoom[] = [room({ width_m: null, length_m: null, floor_area_m2: 16.0 })]
    const result = measureFromRooms(rooms, { ceilingHeightM: 2.4 })
    expect(result).not.toBeNull()
    expect(result!.rooms_without_dimensions).toBe(1)
    expect(result!.all_dimensioned).toBe(false)
  })

  it('returns null for an empty room list', () => {
    expect(measureFromRooms([], { ceilingHeightM: 2.4 })).toBeNull()
  })

  it('returns null when every room is excluded', () => {
    const rooms: PaintRoom[] = [room({ width_m: 4, length_m: 3, included: false })]
    expect(measureFromRooms(rooms, { ceilingHeightM: 2.4 })).toBeNull()
  })

  it('returns null when every included room has no dims and no area', () => {
    const rooms: PaintRoom[] = [room({ included: true })]
    expect(measureFromRooms(rooms, { ceilingHeightM: 2.4 })).toBeNull()
  })

  it('diverges from the whole-house heuristic: more trim, less wall area', () => {
    const rooms: PaintRoom[] = Array.from({ length: 12 }, (_, i) =>
      room({ id: `room-${i}`, width_m: 4.0, length_m: 3.0, included: true }),
    )
    const result = measureFromRooms(rooms, { ceilingHeightM: 2.4 })!
    expect(result.floor_area_m2).toBe(144.0)

    // The heuristic lib/painting/area.ts:measurePaintableArea currently
    // applies to the same 144 m² whole-house floor area.
    const heuristicWalls = 144 * 2.8
    const heuristicTrim = 1.08 * 4 * Math.sqrt(144) * 1.6

    expect(result.trim_lm).toBeGreaterThan(heuristicTrim)
    expect(result.wall_area_m2).toBeLessThan(heuristicWalls)
  })

  it('rounds once at the end, not per room (pins the accumulation rule)', () => {
    // perimeters: room A 2×(1+1)=4.0, room B 2×(1+1.23)=4.46.
    // Rounding each perimeter to 1dp before summing (4.0 + 4.5 = 8.5) gives
    // trim = round(8.5×0.9 + 2×5, 1) = 17.7 — the WRONG, intermediate-rounded
    // answer. Accumulating at full precision (4.0 + 4.46 = 8.46) then
    // rounding once gives trim = round(8.46×0.9 + 2×5, 1) = 17.6.
    const rooms: PaintRoom[] = [
      room({ id: 'a', width_m: 1, length_m: 1 }),
      room({ id: 'b', width_m: 1, length_m: 1.23 }),
    ]
    const result = measureFromRooms(rooms, { ceilingHeightM: 2.4 })!
    expect(result.trim_lm).toBe(17.6)
    expect(result.trim_lm).not.toBe(17.7)
  })
})

describe('exported constants', () => {
  it('document their values', () => {
    expect(ROOM_OPENING_DEDUCTION).toBe(0.12)
    expect(SKIRTING_RUN_FACTOR).toBe(0.9)
    expect(ARCHITRAVE_LM_PER_ROOM).toBe(5.0)
  })
})
