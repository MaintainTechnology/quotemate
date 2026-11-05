/** System-wide safety policy, not a tenant rollout flag or a readiness check.
 * Every generic quote must use authoritative calculation or remain unpriced
 * for review. Missing identity, unsupported trade and incomplete price books
 * are handled inside Quote Core; none may select the legacy model-price path. */
export function rank1QuoteCoreEnabled(): true {
  return true
}
