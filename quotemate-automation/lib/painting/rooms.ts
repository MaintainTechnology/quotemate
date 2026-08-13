// ════════════════════════════════════════════════════════════════════
// Painting — per-room geometry engine.
//
// PaintRoom[] (a dimensioned floor-plan schedule) → real trim/wall/
// ceiling totals, built room-by-room instead of the whole-house
// heuristic in lib/painting/area.ts. That heuristic treats a house as
// one empty box (perimeter from √floor_area) and under/over-counts
// skirting and wall area on anything but a single-room footprint —
// this module fixes that by summing each room's own perimeter.
//
// Wiring into area.ts (choosing rooms-basis vs whole-house) is NOT
// this module's job — it is consumed elsewhere. This file is PURE:
// no I/O, no Date, no Math.random. Fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import { K_SHAPE_INTERIOR, roundTo } from './geometry'
import type { PaintRoom, PaintRoomType } from './types'

// ── Constants ────────────────────────────────────────────────────────

/** Doors/windows removed from gross wall area — mid of the 10–15% band
 *  lib/painting/area.ts already documents for WALL_MULTIPLIER. */
export const ROOM_OPENING_DEDUCTION = 0.12

/** Share of a room's perimeter that actually carries skirting, after
 *  doorways and fitted joinery (wardrobes, kitchen runs) are removed. */
export const SKIRTING_RUN_FACTOR = 0.9

/** One standard 2040×820 door architrave set per room, in linear metres.
 *  Flat per room: over-counts an open-plan space, under-counts a hall
 *  with four openings. Named so a tenant override can refine it later. */
export const ARCHITRAVE_LM_PER_ROOM = 5.0

/** Room types excluded from a schedule by default — painters quote the
 *  garage separately when they quote it at all. */
export const DEFAULT_EXCLUDED_ROOM_TYPES: PaintRoomType[] = ['garage']

// ── Dimension parsing ───────────────────────────────────────────────

/**
 * PURE — parse a printed "width x length" string into a metres pair.
 * Mirrors lib/aircon/plan-scale.ts parseDimensionText's parsing rules
 * exactly (strip commas, lowercase, same regex, mm≥100 heuristic) but
 * returns the width/length PAIR instead of collapsing to an area, and
 * applies no area sanity bounds — a painting room list may legitimately
 * contain a 288 m² garage.
 */
export function parseRoomDimensions(
  text: string | null | undefined,
): { width_m: number; length_m: number } | null {
  if (!text) return null
  const cleaned = text.replace(/,/g, '').toLowerCase()
  const m = cleaned.match(/(\d+(?:\.\d+)?)\s*m?m?\s*[x×]\s*(\d+(?:\.\d+)?)/)
  if (!m) return null
  let width = Number(m[1])
  let length = Number(m[2])
  if (!Number.isFinite(width) || !Number.isFinite(length) || width <= 0 || length <= 0) {
    return null
  }
  if (width >= 100) width /= 1000
  if (length >= 100) length /= 1000
  return { width_m: width, length_m: length }
}

// ── Per-room geometry ────────────────────────────────────────────────

/**
 * PURE — a room's internal perimeter in metres. Prefers real dims
 * (2×(width+length)); falls back to the whole-house shape-factor
 * formula applied to just this room's own floor area. Null when
 * neither is known.
 */
export function roomPerimeterM(room: PaintRoom): number | null {
  if (
    room.width_m != null &&
    room.length_m != null &&
    room.width_m > 0 &&
    room.length_m > 0
  ) {
    return 2 * (room.width_m + room.length_m)
  }
  if (room.floor_area_m2 != null && room.floor_area_m2 > 0) {
    return K_SHAPE_INTERIOR * 4 * Math.sqrt(room.floor_area_m2)
  }
  return null
}

// ── Whole-schedule totals ───────────────────────────────────────────

export type RoomMeasurementTotals = {
  floor_area_m2: number
  wall_area_m2: number
  ceiling_area_m2: number
  trim_lm: number
  rooms_used: PaintRoom[]
  rooms_without_dimensions: number
  all_dimensioned: boolean
}

/**
 * PURE — sum per-room geometry into wall/ceiling/trim totals. Only
 * `included` rooms are considered; a considered room contributes only
 * when it has a resolvable perimeter AND a known (>0) floor area.
 * Accumulates at full precision and rounds once at the end.
 */
export function measureFromRooms(
  rooms: PaintRoom[],
  opts: { ceilingHeightM: number },
): RoomMeasurementTotals | null {
  let floorArea = 0
  let perimeterSum = 0
  const roomsUsed: PaintRoom[] = []
  let roomsWithoutDimensions = 0

  for (const room of rooms) {
    if (!room.included) continue

    const perimeter = roomPerimeterM(room)
    if (perimeter == null) continue

    const hasDims =
      room.width_m != null && room.length_m != null && room.width_m > 0 && room.length_m > 0
    const area = hasDims ? (room.width_m as number) * (room.length_m as number) : room.floor_area_m2
    if (area == null || area <= 0) continue

    floorArea += area
    perimeterSum += perimeter
    roomsUsed.push(room)
    if (!hasDims) roomsWithoutDimensions++
  }

  if (roomsUsed.length === 0) return null

  const wallArea = perimeterSum * opts.ceilingHeightM * (1 - ROOM_OPENING_DEDUCTION)
  const trimLm = perimeterSum * SKIRTING_RUN_FACTOR + roomsUsed.length * ARCHITRAVE_LM_PER_ROOM

  return {
    floor_area_m2: roundTo(floorArea, 1),
    wall_area_m2: roundTo(wallArea, 1),
    ceiling_area_m2: roundTo(floorArea, 1),
    trim_lm: roundTo(trimLm, 1),
    rooms_used: roomsUsed,
    rooms_without_dimensions: roomsWithoutDimensions,
    all_dimensioned: roomsWithoutDimensions === 0,
  }
}
