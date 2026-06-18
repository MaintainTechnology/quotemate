// Catalogue-coverage badge resolver (R37).
//
// The Catalogue, Estimating, and Recipes tabs each render a per-line badge
// answering ONE question: "does this line price from the tradie's own
// catalogue, or fall back to a generic price?" Today that decision is
// duplicated inline in two tabs (categoryHasCatalogueProduct + bespoke JSX),
// so they can drift in wording AND in the underlying set of catalogue
// categories each tab fetched.
//
// This module is the SINGLE resolver all three tabs call, plus a helper that
// folds an in-session Catalogue enable/disable into the category set so a
// just-toggled product is reflected immediately (before any re-fetch) and the
// three tabs never disagree.
//
// Pure: no fetch, no React, no DB. Reuses normaliseCategory from the estimator
// catalogue module so "same category" means exactly what the estimator means.
// Unit-tested in badge-state.test.ts.

import { normaliseCategory } from '@/lib/estimate/catalogue'

/** Discriminated badge outcome for one priced line.
 *  - 'catalogue' → the tradie has an active, priced product in this category.
 *  - 'generic'   → no catalogue product; the AI falls back to a generic price. */
export type CatalogueBadge = 'catalogue' | 'generic'

/**
 * The one definition of "is this line priced from the tradie's catalogue".
 * Returns a discriminated value (not a bare boolean) so every consumer renders
 * the SAME two states and can never invent a third. Empty/blank category →
 * 'generic' (an un-categorised line can't match a catalogue category).
 */
export function resolveCatalogueBadge(
  lineCategory: string | null | undefined,
  catalogueCategories: ReadonlyArray<string | null | undefined>,
): CatalogueBadge {
  const target = normaliseCategory(lineCategory)
  if (!target) return 'generic'
  const has = catalogueCategories.some((c) => normaliseCategory(c) === target)
  return has ? 'catalogue' : 'generic'
}

/**
 * Fold an in-session Catalogue enable/disable into the set of "priced
 * categories" so the badge updates the instant the tradie flips a product,
 * without waiting for a tab re-fetch.
 *
 *   • enabling (active=true) a product ADDS its category to the set, so the
 *     Estimating/Recipes badge for that category flips to 'catalogue'.
 *   • disabling it does NOT remove the category here — another active product
 *     in the same category may still price the line, and the client doesn't
 *     hold the full catalogue to prove the category is now empty. The authoritative
 *     answer lands on the next tab re-fetch (each tab remounts on tab-switch
 *     and re-GETs catalogue_categories). So this helper is purely ADDITIVE:
 *     it can only make a badge MORE accurate (reveal newly-covered categories),
 *     never wrongly claim coverage that was removed.
 *
 * Returns a NEW, de-duplicated (normalised) array; inputs are not mutated.
 */
export function mergeCatalogueToggleIntoCats(
  catalogueCategories: ReadonlyArray<string | null | undefined>,
  toggled: { category: string | null | undefined; active: boolean },
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (raw: string | null | undefined) => {
    const n = normaliseCategory(raw)
    if (n && !seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }
  for (const c of catalogueCategories) push(c)
  if (toggled.active) push(toggled.category)
  return out
}

/** Display copy for a badge state. Centralised so the wording is identical in
 *  every tab (the R37 "never disagree" requirement applies to text too). The
 *  caller supplies the surface so the slightly different phrasings the tabs use
 *  today ("priced from your catalogue" vs "your catalogue") converge. */
export function badgeLabel(badge: CatalogueBadge, surface: 'long' | 'short' = 'long'): string {
  if (badge === 'catalogue') {
    return surface === 'short' ? '✓ your catalogue' : '✓ priced from your catalogue'
  }
  return surface === 'short'
    ? '⚠ generic price'
    : '⚠ no catalogue product — generic price'
}
