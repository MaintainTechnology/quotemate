// ════════════════════════════════════════════════════════════════════
// Feature catalog + gating predicate — PURE, no I/O, fully unit-testable.
//
// Per-tenant feature access is keyed on tenants.trades[] (the catalog of
// slugs is lib/admin/trades.ts KNOWN_TRADES). This module maps the dashboard's
// FEATURE TABS to the trades[] slug that gates each, and exposes the single
// predicate (tenantHasFeature) used by the nav, the dashboard page guard, the
// client FeatureGate, and the server requireFeature API guard.
// ════════════════════════════════════════════════════════════════════

import { isKnownTrade, type TradeSlug } from '@/lib/admin/trades'

/**
 * Dashboard feature-tab key → the tenants.trades[] slug that gates it.
 * Tabs NOT in this map are "core" and always shown.
 *
 * Note `estimator` is the electrical-plan take-off tool, so it is gated by the
 * `electrical` slug (it has no standalone catalog entry). `commercial-painting`
 * (tab key, hyphen) maps to the `commercial_painting` slug (underscore — the
 * KNOWN_TRADES form).
 */
export const FEATURE_TAB_SLUGS = {
  roofing: 'roofing',
  signage: 'signage',
  painting: 'painting',
  'commercial-painting': 'commercial_painting',
  aircon: 'aircon',
  estimator: 'electrical',
  solar: 'solar',
} as const

export type FeatureTab = keyof typeof FEATURE_TAB_SLUGS

/** Is `tab` a gated feature tab (vs a core tab that's always shown)? */
export function isFeatureTab(tab: string): tab is FeatureTab {
  return Object.prototype.hasOwnProperty.call(FEATURE_TAB_SLUGS, tab)
}

/** The trades[] slug that gates a tab, or null when the tab is core. */
export function slugForTab(tab: string): string | null {
  return isFeatureTab(tab) ? FEATURE_TAB_SLUGS[tab] : null
}

/** PURE — does this tenant's trades[] grant the given feature slug? */
export function tenantHasFeature(
  trades: ReadonlyArray<string> | null | undefined,
  slug: string,
): boolean {
  if (!Array.isArray(trades)) return false
  const want = slug.toLowerCase()
  return trades.some((t) => typeof t === 'string' && t.toLowerCase() === want)
}

/** PURE — is a dashboard tab visible for these trades? Core tabs (no gating
 *  slug) are always visible; feature tabs require their slug in trades[]. */
export function isTabEnabled(
  tab: string,
  trades: ReadonlyArray<string> | null | undefined,
): boolean {
  const slug = slugForTab(tab)
  if (slug === null) return true
  return tenantHasFeature(trades, slug)
}

/** The catalog feature slugs a tenant currently has (trades[] ∩ KNOWN_TRADES). */
export function tenantFeatureSlugs(
  trades: ReadonlyArray<string> | null | undefined,
): TradeSlug[] {
  if (!Array.isArray(trades)) return []
  return trades.filter((t): t is TradeSlug => isKnownTrade(t))
}
