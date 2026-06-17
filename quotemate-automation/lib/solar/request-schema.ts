// Zod request schema for POST /api/solar/[tenantSlug]/estimate.
// The body is customer-supplied from the public entry page, so it is
// validated strictly. The `manual` block is only present when the
// address was uncovered and the customer answered the 2–3 fallback
// questions (spec §3). Enums mirror lib/solar/types.ts verbatim.

import { z } from 'zod'

const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'] as const

const ORIENTATIONS = [
  'north', 'north_east', 'east', 'south_east',
  'south', 'south_west', 'west', 'north_west',
  'flat', 'unknown',
] as const

export const SolarEstimateRequestSchema = z.object({
  address: z.object({
    address: z.string().min(3),
    postcode: z.string().min(3),
    state: z.enum(AU_STATES),
  }),
  manual: z
    .object({
      orientation: z.enum(ORIENTATIONS),
      roof_size: z.enum(['small', 'medium', 'large']),
      storeys: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    })
    .optional(),
  panel_type: z
    .enum(['standard_panels', 'premium_panels', 'unknown'])
    .optional(),
  // Property power-supply phase (entry form). A three-phase service lets the
  // engine size the largest tier up to 3× the per-phase DNSP export limit.
  // Optional — absent / 'unknown' is treated as single-phase (no multiplier).
  phase: z.enum(['single', 'three', 'unknown']).optional(),
  // Customer's preferred system size, kW DC (entry form, optional). Anchors
  // the tier targets in sizing.ts; roof fit and the public quote maximum still
  // apply, while export/phase constraints are shown as installer review notes.
  requested_size_kw: z.number().positive().max(100).optional(),
  // Optional customer contact — when a mobile is supplied the tradie-confirm
  // step texts the customer their quote (PDF link + best-effort MMS). Absent
  // → solar behaves as before (tradie-review only, customer views the page).
  customer: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      mobile: z.string().trim().min(6).max(20).optional(),
    })
    .optional(),
  // Optional energy context (premium quote §4.1) — a quarterly bill
  // personalises the utility-cost / savings sections. Bounded so a typo
  // ($85,000 instead of $850) can't distort the financial charts.
  energy: z
    .object({
      quarterly_bill_aud: z.number().positive().max(10_000).optional(),
    })
    .optional(),
  // Quote variant (Felt tab spec 2026-06-13) — 'felt' rows run the
  // IDENTICAL engine but render the Felt interactive-map layout and get
  // a Felt map provisioned in after(). Defaults to 'instant'.
  variant: z.enum(['instant', 'felt']).optional(),
  // Chosen building (multi-roof building picker, 2026-06-16). When the
  // address resolves to ≥2 structures the entry form lets the customer
  // pick which one; this carries that choice so the engine targets that
  // building's centroid (targetLocation) instead of the default structure.
  // Absent → single-building behaviour, the engine resolves the address
  // as before. The id is opaque (Geoscape buildingId or synthetic).
  target_building: z
    .object({
      building_id: z.string().min(1).max(120),
      centroid: z.object({
        lat: z.number().gte(-90).lte(90),
        lng: z.number().gte(-180).lte(180),
      }),
    })
    .optional(),
})

export type SolarEstimateRequestBody = z.infer<typeof SolarEstimateRequestSchema>
