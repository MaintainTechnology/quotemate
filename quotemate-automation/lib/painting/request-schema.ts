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
