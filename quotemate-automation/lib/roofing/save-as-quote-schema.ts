// The POST /api/roofing/save-as-quote request contract (spec
// tradie-onsite-quote-editing R6b/R6c). Extracted from the route so
// buildSaveAsQuoteRequest (lib/roofing/save-as-quote-helpers.ts) and its
// tests can validate against the ONE schema the route actually enforces.
//
// `measure_token` is the required promotion capability. The route reloads
// the tenant-owned measurement and a second call returns the existing quote.

import { z } from 'zod'

/** Customer-price promotion accepts identity + expected server revision only.
 * Address, measurements, tiers, GST, routing and totals are reloaded from the
 * tenant-owned persisted measurement; caller-authored money is not a request
 * field. */
export const SaveAsQuoteRequestSchema = z.object({
  measure_token: z.string().min(8).max(200),
  expected_pricing_revision: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export type SaveAsQuoteRequest = z.infer<typeof SaveAsQuoteRequestSchema>
