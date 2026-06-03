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

export const PaintInputsSchema = z.object({
  scopes: z
    .array(z.enum(['walls', 'ceilings', 'trim', 'exterior']))
    .min(1, 'Pick at least one surface to paint'),
  coats: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  condition: z.enum(['sound', 'minor', 'bare', 'poor']),
  ceiling_height: z.enum(['standard', 'high', 'raked']),
  colour_change: z.boolean(),
  storeys: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  manual_floor_area_m2: z.number().positive().max(2000).optional().nullable(),
})

export const EstimateRequestSchema = z.object({
  address: PaintAddressSchema,
  inputs: PaintInputsSchema,
  /** Which dashboard tab issued the request. */
  source: z.enum(['rea', 'auto']).optional(),
  /** Demo toggle — flips the orchestrator to the deterministic mock. */
  use_mock_provider: z.boolean().optional(),
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
