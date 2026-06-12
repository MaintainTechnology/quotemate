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
})

export type SolarEstimateRequestBody = z.infer<typeof SolarEstimateRequestSchema>
