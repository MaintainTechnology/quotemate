// ════════════════════════════════════════════════════════════════════
// Roofing — HTTP request validation schema.
//
// Splits validation away from the route file so we can unit-test the
// parser without spinning up Next.js handlers.
// ════════════════════════════════════════════════════════════════════

import { z } from 'zod'

export const MeasureRequestSchema = z.object({
  address: z.object({
    address: z.string().min(3).max(300),
    postcode: z.string().regex(/^\d{4}$/, 'AU postcode is 4 digits'),
    state: z.enum(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']),
  }),
  inputs: z.object({
    material: z.enum([
      'colorbond_trimdek',
      'colorbond_kliplok',
      'concrete_tile',
      'terracotta_tile',
      'cement_sheet',
      'unknown',
    ]),
    pitch: z.enum(['shallow', 'standard', 'steep', 'very_steep', 'unknown']),
    building_year_built: z.number().int().min(1850).max(2100).optional().nullable(),
    intent: z.enum([
      'full_reroof',
      'patch_repair',
      'leak_trace',
      'gutter_replace',
      'ridge_cap',
      'flashing_repair',
      'unknown',
    ]),
  }),
  /** Optional `?mock=1` style override — flips orchestrator to the
   *  deterministic mock provider regardless of env. */
  use_mock_provider: z.boolean().optional(),
})

export type MeasureRequest = z.infer<typeof MeasureRequestSchema>
