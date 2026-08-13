// ════════════════════════════════════════════════════════════════════
// Painting — HTTP request validation schema.
//
// Splits validation away from the route file so we can unit-test the
// parser without spinning up Next.js handlers. Mirrors
// lib/roofing/request-schema.ts.
// ════════════════════════════════════════════════════════════════════

import { z } from 'zod'

export const PaintAddressSchema = z.object({
  address: z.string().min(3).max(300),
  postcode: z.string().regex(/^\d{4}$/, 'AU postcode is 4 digits'),
  state: z.enum(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']),
})

/** One room in the interior schedule. Mirrors PaintRoom in ./types.
 *  Bounds are sanity limits, not business rules — a 288 m² garage is a
 *  legitimate room, a 500 m wall is not. */
export const PaintRoomSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  room_type: z.enum([
    'bedroom',
    'living',
    'kitchen',
    'bathroom',
    'laundry',
    'study',
    'hall',
    'garage',
    'other',
  ]),
  width_m: z.number().positive().max(100).nullable(),
  length_m: z.number().positive().max(100).nullable(),
  floor_area_m2: z.number().positive().max(5000).nullable(),
  included: z.boolean(),
  source: z.enum(['plan', 'manual']),
  confidence: z.enum(['high', 'medium', 'low']),
})

export const PaintInputsSchema = z.object({
  scopes: z
    .array(z.enum(['walls', 'ceilings', 'trim', 'exterior']))
    .min(1, 'Pick at least one surface to paint'),
  coats: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  condition: z.enum(['sound', 'minor', 'bare', 'poor']),
  ceiling_height: z.enum(['standard', 'high', 'extra_high', 'raked']),
  colour_change: z.boolean(),
  storeys: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  manual_floor_area_m2: z.number().positive().max(2000).optional().nullable(),
  /** Per-room schedule for the interior. Absent ⇒ the whole-house
   *  heuristic, byte-identical to the pre-room-schedule behaviour. */
  rooms: z.array(PaintRoomSchema).max(200).optional(),
  /** Which structure at the address to measure (Geoscape building id from
   *  /api/painting/structures). Optional — absent ⇒ single-building path. */
  structure: z
    .object({
      building_id: z.string().min(1).max(80),
      label: z.string().max(80).optional(),
      role: z.enum(['primary', 'secondary']).optional(),
    })
    .optional(),
})

export const EstimateRequestSchema = z.object({
  address: PaintAddressSchema,
  inputs: PaintInputsSchema,
})

export type EstimateRequest = z.infer<typeof EstimateRequestSchema>

/** Persist a confirmed painting estimate as a saved job. The full
 *  PaintingEstimate is stored verbatim in `estimate`; the route derives
 *  the denormalised summary columns from it. */
export const SavePaintingSchema = z.object({
  address: PaintAddressSchema,
  /** The data source the estimate came from. */
  source: z.enum(['rea', 'domain', 'solar', 'geoscape', 'mock', 'manual']),
  inputs: PaintInputsSchema,
  /** The whole PaintingEstimate object, stored as-is. */
  estimate: z.unknown(),
  customer_name: z.string().max(160).optional().nullable(),
  customer_phone: z.string().max(40).optional().nullable(),
})

export type SavePaintingRequest = z.infer<typeof SavePaintingSchema>
