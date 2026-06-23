// Known trade set for the admin customer console's trade toggles.
//
// These slugs are what the customer dashboard reads out of
// tenants.trades[] to decide which trade-tool tabs to show (electrical /
// plumbing base trades + roofing / signage / painting / commercial
// painting / aircon / solar feature trades — see lib/roofing/tenant.ts
// and friends). The toggle UI offers exactly this set so admin edits map
// 1:1 onto dashboard tab visibility.
//
// NOTE: tenants.trades[] is an unconstrained text[] (migration 017) — any
// of these slugs can be added/removed freely. The scalar tenants.trade is
// a FK to the trades registry (migration 051) and is synced separately by
// the trades action to a registry-valid value, never to an arbitrary slug.

export type TradeSlug =
  | 'electrical'
  | 'plumbing'
  | 'roofing'
  | 'signage'
  | 'painting'
  | 'commercial_painting'
  | 'aircon'
  | 'solar'

export const KNOWN_TRADES: ReadonlyArray<{ slug: TradeSlug; label: string }> = [
  { slug: 'electrical', label: 'Electrical' },
  { slug: 'plumbing', label: 'Plumbing' },
  { slug: 'roofing', label: 'Roofing' },
  { slug: 'signage', label: 'Signage' },
  { slug: 'painting', label: 'Painting' },
  { slug: 'commercial_painting', label: 'Commercial painting' },
  { slug: 'aircon', label: 'Air conditioning' },
  { slug: 'solar', label: 'Solar' },
]

const KNOWN_SLUGS = new Set<string>(KNOWN_TRADES.map((t) => t.slug))

export function isKnownTrade(v: unknown): v is TradeSlug {
  return typeof v === 'string' && KNOWN_SLUGS.has(v)
}

/**
 * Human label for a trade slug. Falls back to a title-cased slug for any
 * value not in the known set, so an unexpected / future trade already
 * sitting in tenants.trades[] still renders rather than crashing the UI.
 */
export function tradeLabel(slug: string): string {
  const known = KNOWN_TRADES.find((t) => t.slug === slug)
  if (known) return known.label
  return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
