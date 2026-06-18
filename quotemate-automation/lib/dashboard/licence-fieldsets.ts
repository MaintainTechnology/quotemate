// Which licence fieldsets the Account tab must render (R39).
//
// When a tradie activates a NEW trade (POST /api/tenant/trades/activate), the
// dashboard re-fetches /api/tenant/me. The route's GET builds one `licences`
// entry per active trade — including a BLANK one for the freshly-added trade —
// so the LicencesCard renders an empty fieldset for it. This helper makes that
// guarantee explicit AND resilient on the client: it derives the ordered list
// of fieldsets to show from the tenant's `trades[]`, back-filling a blank
// fieldset for any active trade the licences payload doesn't yet carry (e.g. if
// the route response lagged a beat behind the trades update).
//
// Pure: no fetch/React/DB. Unit-tested in licence-fieldsets.test.ts.

/** The licence row shape the GET returns (and the card consumes). */
export type LicenceLike = {
  trade: string
  licence_type: string | null
  licence_number: string | null
  licence_state: string | null
  licence_expiry: string | null
}

/**
 * Resolve the ordered list of licence fieldsets to display.
 *
 *   • Order follows `trades` (the tenant's active-trade order) so the UI is
 *     stable and matches the rest of the dashboard.
 *   • Each active trade gets its existing licence row when present, else a
 *     BLANK row (so a just-activated trade always gets an empty fieldset to
 *     fill in — the R39 requirement).
 *   • A licence row for a trade NOT in `trades` (e.g. a trade was removed but a
 *     stale licence row lingers) is dropped — we never show a fieldset for a
 *     trade the tenant no longer runs.
 *   • `primaryState` seeds a blank row's `licence_state` so a new trade
 *     defaults to the tenant's operating state (matches the route's own
 *     fallback) instead of an empty dropdown.
 *
 * When `trades` is empty (legacy/edge), falls back to the licences as-is so the
 * card still renders whatever the route returned.
 */
export function licenceFieldsetsForTrades(
  trades: ReadonlyArray<string> | null | undefined,
  licences: ReadonlyArray<LicenceLike> | null | undefined,
  primaryState: string | null = null,
): LicenceLike[] {
  const rows = licences ?? []
  const byTrade = new Map<string, LicenceLike>()
  for (const l of rows) {
    if (l && typeof l.trade === 'string' && !byTrade.has(l.trade)) byTrade.set(l.trade, l)
  }

  const activeTrades = (trades ?? []).filter(
    (t): t is string => typeof t === 'string' && t.trim() !== '',
  )

  if (activeTrades.length === 0) {
    // No trades signal — preserve the route's licence list verbatim.
    return [...rows]
  }

  // De-dupe trades while preserving order.
  const seen = new Set<string>()
  const out: LicenceLike[] = []
  for (const t of activeTrades) {
    if (seen.has(t)) continue
    seen.add(t)
    const existing = byTrade.get(t)
    out.push(
      existing ?? {
        trade: t,
        licence_type: null,
        licence_number: null,
        licence_state: primaryState,
        licence_expiry: null,
      },
    )
  }
  return out
}

/** True when EVERY licence field for a trade is empty/null — i.e. the fieldset
 *  is a blank "please fill me in" prompt for a newly-activated trade. Useful
 *  for an optional "complete your licence" hint in the UI. */
export function isBlankLicence(l: LicenceLike): boolean {
  const empty = (v: string | null) => v === null || v.trim() === ''
  return (
    empty(l.licence_type) &&
    empty(l.licence_number) &&
    empty(l.licence_expiry)
    // licence_state is intentionally excluded: a blank fieldset may carry the
    // tenant's default state and still be "unfilled".
  )
}
