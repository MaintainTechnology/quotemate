// ════════════════════════════════════════════════════════════════════
// Signage Compliance — region matching (PURE, no I/O).
//
// The manage-studio / sweep flow filters studios by a region label. The
// original bug: a studio saved with region "Au-Qld" never matched a sweep
// filter "AU-QLD" because the DB `.eq('region', …)` is case-SENSITIVE. And
// studios added via Google Places set `state` (e.g. "QLD") but no `region`,
// so a region filter missed them entirely.
//
// These helpers make targeting forgiving: a filter matches a studio when it
// case-insensitively equals EITHER the studio's region OR its state. The
// region dropdown is also de-duplicated case-insensitively so the same area
// never shows twice ("AU-QLD" + "Au-Qld").
// ════════════════════════════════════════════════════════════════════

function norm(v: string | null | undefined): string {
  return (typeof v === 'string' ? v : '').trim().toLowerCase()
}

/** A studio's region/state fields, as stored. */
export type StudioRegionFields = { region?: string | null; state?: string | null }

/** PURE — does a region filter select this studio? Case-insensitive match
 *  against the studio's region OR state. An empty/blank filter matches every
 *  studio (the "all regions" sweep). */
export function regionMatches(studio: StudioRegionFields, filter: string | null | undefined): boolean {
  const f = norm(filter)
  if (!f) return true // no filter → all studios
  return norm(studio.region) === f || norm(studio.state) === f
}

/** PURE — filter a list of studios by a region filter (case-insensitive,
 *  region OR state). */
export function filterStudiosByRegion<T extends StudioRegionFields>(
  studios: readonly T[],
  filter: string | null | undefined,
): T[] {
  const f = norm(filter)
  if (!f) return [...studios]
  return studios.filter((s) => regionMatches(s, filter))
}

/** PURE — the distinct region labels for a dropdown, de-duplicated
 *  case-insensitively (first-seen casing wins) and sorted. Studios with no
 *  region fall back to their state so a Places-added studio is still
 *  filterable. */
export function distinctRegions(studios: readonly StudioRegionFields[]): string[] {
  const byKey = new Map<string, string>()
  for (const s of studios) {
    const label = (s.region && s.region.trim()) || (s.state && s.state.trim()) || ''
    if (!label) continue
    const key = label.toLowerCase()
    if (!byKey.has(key)) byKey.set(key, label)
  }
  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b))
}
