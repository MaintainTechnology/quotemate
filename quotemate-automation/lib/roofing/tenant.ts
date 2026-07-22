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

/** PURE — does this tenant do roofing and NOTHING else?
 *
 *  Such a tenant has no second trade to route to, so their SMS receptionist
 *  must not require a roofing keyword before engaging — see
 *  shouldEngageRoofing in lib/sms/roofing-receptionist.ts. */
export function tenantIsRoofingOnly(
  trades: ReadonlyArray<string> | null | undefined,
): boolean {
  if (!Array.isArray(trades)) return false
  const clean = trades
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0)
  return clean.length > 0 && clean.every((t) => t === 'roofing')
}
