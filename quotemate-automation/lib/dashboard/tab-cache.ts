// Per-tab SWR-lite cache (specs/dashboard-performance.md R4). Tab components
// unmount on every switch (conditional render in page.tsx), so their fetched
// data lives here at module scope: a revisit renders instantly from cache and
// revalidates in the background. Pure logic — callers pass timestamps (same
// contract as recent-activity.ts shouldRefresh, which supplies the shared
// 15s window). Entries are treated as IMMUTABLE by callers: never mutate
// entry.data in place (it is shared by reference across mounts) — write a new
// array via writeTabCache instead.

import { shouldRefresh } from './recent-activity'

export type CacheEntry<T> = { data: T; fetchedAt: number }

const cache = new Map<string, CacheEntry<unknown>>()

/** Tenant-scoped key: tab data is tenant data, so the tenant id is part of
 *  the identity — an account switch on the same device can never read the
 *  previous tenant's rows, even on paths that skip clearTabCache(). */
export function tabCacheKey(surface: string, tenantId: string): string {
  return `${surface}:${tenantId}`
}

export function readTabCache<T>(key: string): CacheEntry<T> | null {
  return (cache.get(key) as CacheEntry<T> | undefined) ?? null
}

export function writeTabCache<T>(key: string, data: T, fetchedAt: number): void {
  cache.set(key, { data, fetchedAt })
}

/** Mark an entry stale without dropping its data: the next mount still
 *  paints instantly from it, but always revalidates. Call after a mutation
 *  (reply sent, job deleted) that makes the cached list wrong. */
export function staleTabCache(key: string): void {
  const entry = cache.get(key)
  if (entry) cache.set(key, { ...entry, fetchedAt: 0 })
}

/** Fresh iff shouldRefresh (the shared 15s refresh-on-return throttle in
 *  recent-activity.ts) would NOT refetch — one window, one source. */
export function isFresh(
  entry: CacheEntry<unknown> | null,
  nowMs: number,
  maxAgeMs?: number,
): boolean {
  if (!entry) return false
  return !shouldRefresh(entry.fetchedAt, nowMs, maxAgeMs)
}

/** Empty the cache (sign-out, tests). */
export function clearTabCache(): void {
  cache.clear()
}
