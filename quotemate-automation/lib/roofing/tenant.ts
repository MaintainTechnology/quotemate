// ════════════════════════════════════════════════════════════════════
// Roofing — tenant-side helpers used by the dashboard.
//
// PURE — no I/O, no React — fully unit-testable.
// ════════════════════════════════════════════════════════════════════

/** PURE — does this tenant offer roofing? Tolerates the legacy
 *  electrical/plumbing-only typing of tenant.trades without rippling
 *  type changes through 17 callers. */
export function tenantHasRoofingTrade(
  trades: ReadonlyArray<string> | null | undefined,
): boolean {
  if (!Array.isArray(trades)) return false
  return trades.some((t) => typeof t === 'string' && t.toLowerCase() === 'roofing')
}
