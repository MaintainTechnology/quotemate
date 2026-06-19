// R3 / R7 — normalise a draft that is routing to the $99 inspection.
//
// A self-declared (or forced) inspection must NEVER ship priced tiers: a model
// can set needs_inspection=true while still emitting good/better/best, and the
// route/render downstream would surface that ungrounded price. We force the
// tiers null centrally and stamp pricing_path='inspection' for observability.
// Pure + side-effect-only-on-the-passed-object so it is trivially unit-tested.

/** True when the draft is carrying any priced tier (the anomaly to log on the
 *  needs_inspection path). */
export function carriedPricedTiers(draft: unknown): boolean {
  const d = draft as { good?: unknown; better?: unknown; best?: unknown } | null
  return !!(d && (d.good || d.better || d.best))
}

/** Force a draft to the inspection shape: all tiers null, pricing_path stamped.
 *  Returns the same object for convenience. */
export function forceInspectionTiers(draft: Record<string, unknown>): Record<string, unknown> {
  draft.good = null
  draft.better = null
  draft.best = null
  draft.pricing_path = 'inspection'
  return draft
}
