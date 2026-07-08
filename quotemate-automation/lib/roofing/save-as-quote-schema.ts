// The POST /api/roofing/save-as-quote request contract (spec
// tradie-onsite-quote-editing R6b/R6c). Extracted from the route so
// buildSaveAsQuoteRequest (lib/roofing/save-as-quote-helpers.ts) and its
// tests can validate against the ONE schema the route actually enforces.
//
// `measure_token` is the optional promotion handle: when present the route
// links the created quote back onto the roofing_measurements row and a
// second call returns the existing quote instead of duplicating.

import { z } from 'zod'

export const SaveAsQuoteRequestSchema = z.object({
  measure_token: z.string().optional(),
  address: z.object({
    address: z.string().min(3),
    postcode: z.string(),
    state: z.string(),
  }),
  inputs: z.object({
    material: z.string(),
    pitch: z.string(),
    intent: z.string(),
    building_year_built: z.number().int().nullable().optional(),
  }),
  metrics: z.object({
    footprint_m2: z.number(),
    sloped_area_m2: z.number().nullable(),
    storeys: z.number().nullable(),
    form: z.string(),
    hips: z.number().nullable(),
    valleys: z.number().nullable(),
    ridge_lm: z.number().nullable().optional(),
    polygon_geojson: z.unknown().nullable().optional(),
    capture_date: z.string().nullable().optional(),
  }),
  price: z.object({
    area_m2: z.number(),
    effective_rate_per_m2: z.number(),
    tiers: z.array(
      z.object({
        tier: z.enum(['good', 'better', 'best']),
        label: z.string(),
        ex_gst: z.number(),
        inc_gst: z.number(),
        scope: z.string(),
        line_items: z
          .array(
            z.object({
              unit: z.string(),
              quantity: z.number(),
              description: z.string(),
              unit_price_ex_gst: z.number(),
              total_ex_gst: z.number(),
              source: z.string(),
            }),
          )
          .optional(),
      }),
    ).length(3),
    loadings_applied: z.array(
      z.object({ code: z.string(), pct: z.number(), detail: z.string() }),
    ),
    routing: z.object({
      decision: z.enum(['auto_quote', 'tradie_review', 'inspection_required']),
      reason: z.string(),
    }),
  }),
  customer: z
    .object({
      name: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
})

export type SaveAsQuoteRequest = z.infer<typeof SaveAsQuoteRequestSchema>
