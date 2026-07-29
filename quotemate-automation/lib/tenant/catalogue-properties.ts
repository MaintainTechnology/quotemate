// Phase 2b — the tradie-facing write path for a catalogue product's attributes.
//
// tenant_material_catalogue.properties has existed since migration 028 and been
// GIN-indexed since 082, but no tradie-facing path could ever write it. The
// estimator already READS two of these keys as strict-true filters
// (lib/estimate/tools.ts:103-104, `properties->>smart` compared to the string
// 'true'), so the key names here are matched to that reader verbatim and
// tagging becomes effective with no change on the read side.
//
// The keys are a closed set on purpose. An open record would let a typo like
// `smrt` into the jsonb, where it would sit forever matching no filter.

/** The attributes a tradie can set. `smart` and `dimmable` already have
 *  readers in applyPropertyFilters; `integrated_driver` is consumed by the
 *  Phase 4B recipe conditions. */
export const PRODUCT_ATTRIBUTE_KEYS = ['smart', 'dimmable', 'integrated_driver'] as const

export type ProductAttributeKey = (typeof PRODUCT_ATTRIBUTE_KEYS)[number]
export type ProductAttributes = Partial<Record<ProductAttributeKey, boolean>>

const KEY_SET = new Set<string>(PRODUCT_ATTRIBUTE_KEYS)

/**
 * Merge tradie-set attributes into an existing `properties` jsonb.
 *
 * MUST be used instead of assigning `properties` directly. The PATCH handler
 * does a bare `.update(fields)`, so a wholesale assignment replaces the column
 * and destroys keys this feature does not own — notably `amperage`, which
 * a GPO-amperage backfill wrote to feed the spec guard. (That file lives at
 * the stray nested path quotemate-automation/sql/migrations/087_gpo_amperage_
 * backfill.sql — canonical 087 is signage compliance, so do not cite 087.)
 *
 * Only known keys are copied across, so a value that slipped past validation
 * cannot land in the column. `false` is written, not dropped: a tradie
 * un-ticking a box has to persist.
 */
export function mergeProductProperties(
  existing: Record<string, unknown> | null | undefined,
  incoming: ProductAttributes | null | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(existing ?? {}) }
  for (const [key, value] of Object.entries(incoming ?? {})) {
    if (!KEY_SET.has(key)) continue
    if (typeof value !== 'boolean') continue
    merged[key] = value
  }
  return merged
}
