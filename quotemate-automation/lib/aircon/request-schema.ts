// ════════════════════════════════════════════════════════════════════
// Air-conditioning — HTTP request validation. Mirrors
// lib/painting/request-schema.ts. Kept separate from the route so it is
// unit-testable without a Next handler.
// ════════════════════════════════════════════════════════════════════

import { z } from 'zod'

export const AcAddressSchema = z.object({
  address: z.string().min(3).max(300),
  postcode: z.string().regex(/^\d{4}$/, 'AU postcode is 4 digits'),
  state: z.enum(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']),
})

export const AcInputsSchema = z
  .object({
    bedrooms: z.number().int().min(0).max(20),
    bathrooms: z.number().int().min(0).max(20),
    living_spaces: z.number().int().min(0).max(20),
    /** 1, 2, or 3 (3 = "3 or more"). Optional for older clients. */
    storeys: z.number().int().min(1).max(3).optional(),
    floor_area_m2: z.number().positive().max(2000).optional().nullable(),
    ceiling_height: z.enum(['standard', 'high', 'raked']),
    insulation: z.enum(['good', 'average', 'poor', 'unknown']),
    current_situation: z.enum(['none', 'replacing', 'adding']),
    budget: z.number().positive().max(200000).optional().nullable(),
  })
  .refine((d) => d.bedrooms + d.living_spaces >= 1, {
    message: 'Enter at least one bedroom or living space',
    path: ['living_spaces'],
  })

export const RecommendRequestSchema = z.object({
  address: AcAddressSchema,
  inputs: AcInputsSchema,
})

export type RecommendRequest = z.infer<typeof RecommendRequestSchema>
