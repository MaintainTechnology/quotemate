// ════════════════════════════════════════════════════════════════════
// Painting — floor-plan extraction adapter.
//
// Adapts the aircon trade's `AcPlanExtraction` (a vision model's read
// of an uploaded dimensioned floor plan, lib/aircon/types.ts) into a
// `PaintRoom[]` schedule that lib/painting/rooms.ts's per-room geometry
// engine already knows how to total. The aircon plan extractor is the
// upstream producer of the input; nothing here calls a model or does
// any I/O.
//
// PURE: no I/O, no Date, no Math.random. Fully deterministic — the
// same extraction always produces the same PaintRoom[], ids included.
// ════════════════════════════════════════════════════════════════════

import { DEFAULT_EXCLUDED_ROOM_TYPES, parseRoomDimensions } from './rooms'
import type { PaintRoom, PaintRoomType } from './types'
import type { AcExtractedRoom, AcPlanExtraction } from '@/lib/aircon/types'

/**
 * Deterministic slug of a room name for use in an id: lowercase,
 * non-alphanumeric runs collapse to a single "-", leading/trailing
 * "-" trimmed. A name with no alphanumerics (e.g. "---", "") slugs to "".
 */
function slugifyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * PURE — `AcExtractedRoom` -> `PaintRoom`, one per input room in order.
 * `id` is `<slug-of-name>-<1-based-index>` (e.g. "BEDROOM 2" at index 3
 * -> "bedroom-2-4"); a name that slugs to empty falls back to "room" as
 * the base, so the id is still unique (the index is unique per call)
 * and non-empty.
 */
export function paintRoomsFromPlanExtraction(
  extraction: AcPlanExtraction | null | undefined,
  opts?: { excludeTypes?: PaintRoomType[] },
): PaintRoom[] {
  if (!extraction || !Array.isArray(extraction.rooms)) return []

  const excludeTypes = opts?.excludeTypes ?? DEFAULT_EXCLUDED_ROOM_TYPES

  return extraction.rooms.map((room: AcExtractedRoom, index: number) => {
    const dims = parseRoomDimensions(room.dimensions_text)
    const floorArea = dims
      ? dims.width_m * dims.length_m
      : Number.isFinite(room.area_m2) && (room.area_m2 as number) > 0
        ? (room.area_m2 as number)
        : null

    const base = slugifyName(room.name) || 'room'
    const id = `${base}-${index + 1}`

    const paintRoom: PaintRoom = {
      id,
      name: room.name,
      room_type: room.room_type,
      width_m: dims ? dims.width_m : null,
      length_m: dims ? dims.length_m : null,
      floor_area_m2: floorArea,
      included: !excludeTypes.includes(room.room_type),
      source: 'plan',
      confidence: room.confidence,
    }
    return paintRoom
  })
}
