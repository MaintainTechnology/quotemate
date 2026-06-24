// Quote tier-visibility mode — pure helpers (unit-tested in tier-visibility.test.ts).
//
// This is the SINGLE SOURCE OF TRUTH for "how many price options does the
// customer see, and which one(s)". It is a presentation / VIEW gate applied
// AFTER estimation — it never re-prices and never deletes tiers. Every quote
// still persists its full good/better/best breakdown for the tradie's
// audit + edit path; only the customer-facing render (quote page, SMS, PDF)
// honours the mode.
//
// Orthogonal to lib/quote/display.ts (itemised vs summary), which controls the
// line-item DETAIL inside a tier. A tenant can combine e.g. `single` + `summary`.
//
// Modes (per tenant, per feature/trade — stored on pricing_book.quote_tier_mode):
//   • 'good_better_best' — show every priced tier (the legacy behaviour).
//   • 'single'           — show ONE tier = the recommended tier (selected_tier),
//                          falling back better → good → best to the nearest
//                          priced tier. This is the new platform default.
//   • 'good'|'better'|'best' — show ONLY that one tier; if it wasn't priced,
//                          fall back to the recommended tier (then better →
//                          good → best) so the customer never sees zero prices.
//
// Pure and DB-free so the customer page renderer, SMS template, PDF builder,
// and dashboard form can all share the exact same answer.

export type TierKey = 'good' | 'better' | 'best'

export type QuoteTierMode =
  | 'good_better_best'
  | 'single'
  | 'good'
  | 'better'
  | 'best'

export const QUOTE_TIER_MODES: readonly QuoteTierMode[] = [
  'good_better_best',
  'single',
  'good',
  'better',
  'best',
] as const

// Canonical good → better → best ordering used for rendering.
const TIER_ORDER: readonly TierKey[] = ['good', 'better', 'best'] as const

// Recommended-tier fallback preference when there is no usable selected_tier:
// better (the baseline / most common pick) → good → best. Mirrors the insert
// fallback in app/api/estimate/draft/route.ts.
const RECOMMENDED_FALLBACK: readonly TierKey[] = ['better', 'good', 'best'] as const

/**
 * Type-guard / sanitiser for unknown inputs (form values, API payloads, DB
 * rows that pre-date the column). Returns `fallback` ('single' by default —
 * the new platform default) when the value isn't one of the valid modes.
 */
export function asQuoteTierMode(
  v: unknown,
  fallback: QuoteTierMode = 'single',
): QuoteTierMode {
  if (
    v === 'good_better_best' ||
    v === 'single' ||
    v === 'good' ||
    v === 'better' ||
    v === 'best'
  ) {
    return v
  }
  return fallback
}

function isTierKey(v: unknown): v is TierKey {
  return v === 'good' || v === 'better' || v === 'best'
}

/**
 * Pick the single recommended tier from the priced tiers. Honours an explicit
 * `selectedTier` when it points at a priced tier, otherwise falls back
 * better → good → best (intersected with what's actually priced).
 *
 * `presentKeys` is assumed non-empty and in good→better→best order.
 */
function pickRecommendedTier(
  presentKeys: readonly TierKey[],
  selectedTier?: string | null | undefined,
): TierKey {
  if (isTierKey(selectedTier) && presentKeys.includes(selectedTier)) {
    return selectedTier
  }
  for (const k of RECOMMENDED_FALLBACK) {
    if (presentKeys.includes(k)) return k
  }
  // presentKeys is non-empty by contract — safe final fallback.
  return presentKeys[0]
}

/**
 * Resolve which tier keys are visible to the customer for a single quote,
 * given the tenant/feature `mode`, which tiers were actually priced, and the
 * quote's recommended tier.
 *
 * Returns an ORDERED array (good → better → best) of visible tier keys. The
 * array is empty ONLY when no tiers are priced (e.g. an inspection-route quote
 * with good/better/best all null) — callers keep their existing
 * inspection/empty handling for that case.
 *
 * Pure. Does not read the DB. Caller passes whatever it already loaded.
 */
export function resolveVisibleTiers(args: {
  mode: QuoteTierMode
  present: { good?: boolean | null; better?: boolean | null; best?: boolean | null }
  selectedTier?: string | null | undefined
}): TierKey[] {
  const presentKeys = TIER_ORDER.filter((k) => Boolean(args.present[k]))
  if (presentKeys.length === 0) return []

  if (args.mode === 'good_better_best') return presentKeys

  const recommended = pickRecommendedTier(presentKeys, args.selectedTier)

  if (args.mode === 'single') return [recommended]

  // Forced single tier ('good' | 'better' | 'best').
  if (presentKeys.includes(args.mode)) return [args.mode]
  // Forced tier wasn't priced → fall back to the recommended tier so the
  // customer still sees a price.
  return [recommended]
}
