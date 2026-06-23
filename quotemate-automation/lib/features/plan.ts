// ════════════════════════════════════════════════════════════════════
// Subscription plan → feature defaults, and the PURE computation that maps a
// plan change onto tenants.trades[]. No I/O — unit-testable.
//
// The plan layer only ADDs/REMOVEs the cross-sell "tool" feature slugs; a
// tenant's core trade(s) (electrical/plumbing/whatever they signed up with)
// are identity, never granted or stripped here. On a downgrade, a slug is
// removed ONLY if its provenance is 'plan' — an admin-granted ('manual') or
// signup ('onboarding') slug always survives.
//
// Plan map contents are the shipped default and flagged for product sign-off
// (specs/per-tenant-feature-toggles.md open questions).
// ════════════════════════════════════════════════════════════════════

export type PlanId = 'starter' | 'pro' | 'crew'

/** Feature slugs each plan grants BEYOND the tenant's core trade(s). */
export const PLAN_FEATURE_GRANTS: Record<PlanId, readonly string[]> = {
  starter: [],
  pro: ['signage', 'painting', 'commercial_painting', 'aircon', 'solar'],
  crew: ['signage', 'painting', 'commercial_painting', 'aircon', 'solar', 'roofing'],
}

/** The universe of slugs the plan layer may add or remove. Anything outside
 *  this set (electrical, plumbing, future trades) is left untouched. */
export const PLAN_MANAGED_SLUGS: readonly string[] = [
  'signage',
  'painting',
  'commercial_painting',
  'aircon',
  'solar',
  'roofing',
]

export function isPlanId(v: unknown): v is PlanId {
  return v === 'starter' || v === 'pro' || v === 'crew'
}

export type FeatureSource = 'manual' | 'plan' | 'onboarding'
export type ProvenanceMap = Record<string, FeatureSource>

export type PlanFeatureUpdate = {
  /** trades[] after applying the plan map. */
  nextTrades: string[]
  /** Slugs newly granted by this plan (stamp provenance source='plan'). */
  added: string[]
  /** Plan-sourced slugs stripped because the new plan no longer grants them. */
  removed: string[]
}

/**
 * PURE. Compute the next trades[] for a tenant whose plan changed to `newPlan`.
 *   • Adds the plan's granted slugs that aren't already present.
 *   • Removes plan-managed slugs the new plan no longer grants — but ONLY when
 *     their provenance is 'plan'. Manual/onboarding grants and any slug outside
 *     PLAN_MANAGED_SLUGS (e.g. the base trades) are never removed.
 * Idempotent: re-running with the same plan yields no further changes.
 */
export function computePlanFeatureUpdate(
  currentTrades: ReadonlyArray<string>,
  provenance: ProvenanceMap,
  newPlan: PlanId,
): PlanFeatureUpdate {
  const next = new Set(currentTrades)
  const grants = new Set(PLAN_FEATURE_GRANTS[newPlan] ?? [])
  const added: string[] = []
  const removed: string[] = []

  for (const slug of grants) {
    if (!next.has(slug)) {
      next.add(slug)
      added.push(slug)
    }
  }
  for (const slug of PLAN_MANAGED_SLUGS) {
    if (!grants.has(slug) && next.has(slug) && provenance[slug] === 'plan') {
      next.delete(slug)
      removed.push(slug)
    }
  }
  return { nextTrades: Array.from(next), added, removed }
}
