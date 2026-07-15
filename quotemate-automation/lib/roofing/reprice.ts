// Pure re-price for the /m tradie edge-override flow: apply confirmed
// hip/valley/box-gutter counts onto a persisted MultiRoofQuote's structures and
// re-run pricing with the tenant rate card. Extracted so the measurement route
// stays thin and this stays unit-testable without Supabase.

import type { MultiRoofQuote, RoofingRateCard } from './types'
import { priceMultiRoof } from './pricing'

/** One structure's tradie-confirmed edge counts, keyed by 1-based index. */
export type EdgeOverride = {
  index: number
  hips?: number | null
  valleys?: number | null
  box_gutter_lm?: number | null
}

/** PURE — apply edge overrides (1-based index) to a stored quote's structures
 *  and re-price. Preserves the job-level solar addon + property context, which
 *  pricing doesn't reproduce. Undefined fields keep the measured value. */
export function repriceWithEdgeOverrides(
  quote: MultiRoofQuote,
  edges: EdgeOverride[],
  rateCard?: RoofingRateCard,
): MultiRoofQuote {
  const byIndex = new Map(edges.map((e) => [e.index, e]))
  const structures = quote.structures.map((s, i) => {
    const o = byIndex.get(i + 1)
    const m = o
      ? {
          ...s.metrics,
          hips: o.hips !== undefined ? o.hips : s.metrics.hips,
          valleys: o.valleys !== undefined ? o.valleys : s.metrics.valleys,
          box_gutter_lm: o.box_gutter_lm !== undefined ? o.box_gutter_lm : s.metrics.box_gutter_lm ?? null,
        }
      : s.metrics
    return { buildingId: s.buildingId, role: s.role, metrics: m, inputs: s.inputs }
  })
  const repriced = priceMultiRoof({ structures, rateCard })
  // priceMultiRoof rebuilds structures/combined/routing but not the job-level
  // solar addon or property context — carry them across so a re-price doesn't
  // drop the customer-facing solar line or the property chips.
  return { ...repriced, solar: quote.solar, property_context: quote.property_context }
}
