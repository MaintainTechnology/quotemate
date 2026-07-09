// Per-tab SWR-lite cache (specs/dashboard-performance.md R4). Tab components
// unmount on every switch (conditional render in page.tsx), so their fetched
// data lives here at module scope: a revisit renders instantly from cache and
// revalidates in the background. Pure logic — callers pass timestamps (same
// contract as recent-activity.ts shouldRefresh); freshness window matches the
// dashboard's 15s refresh-on-return throttle.

export type CacheEntry<T> = { data: T; fetchedAt: number }

const cache = new Map<string, CacheEntry<unknown>>()

export function readTabCache<T>(key: string): CacheEntry<T> | null {
  return (cache.get(key) as CacheEntry<T> | undefined) ?? null
}

export function writeTabCache<T>(key: string, data: T, fetchedAt: number): void {
  cache.set(key, { data, fetchedAt })
}

/** Fresh iff strictly inside the window — at exactly maxAgeMs the entry is
 *  stale, mirroring shouldRefresh's `>=` refetch semantics. */
export function isFresh(
  entry: CacheEntry<unknown> | null,
  nowMs: number,
  maxAgeMs = 15_000,
): boolean {
  if (!entry) return false
  return nowMs - entry.fetchedAt < maxAgeMs
}

/** Empty the cache (sign-out, tests). */
export function clearTabCache(): void {
  cache.clear()
}
