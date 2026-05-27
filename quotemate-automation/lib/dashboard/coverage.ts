// Catalogue coverage — pure module that computes the diff between the
// global shared_materials catalogue and a tenant's own
// tenant_material_catalogue, surfaced on the dashboard's Catalogue tab.
//
// "Coverage" answers the question: of all the material categories the
// shared catalogue stocks for this tenant's trade(s), how many does the
// tenant have AT LEAST ONE row for, and how many shared rows would they
// still be missing per category if they wanted full breadth?
//
// The dashboard panel uses the output to nudge the tradie:
//   "Plumbing — 1 of 8 categories covered, 24 shared rows missing.
//    [▸ See gaps]"
// and the See-gaps expander deep-links into the Browse Supplier Catalogue
// tab pre-filtered to a specific (trade, category) pair.
//
// ─── Dual-vocab fix (2026-05-27) ──────────────────────────────────────
// shared_materials.category uses the GRANULAR vocab ('ceiling_fan',
// 'hws_electric', 'hws_gas', 'safety_switch', 'tapware_basin', etc.).
// tenant_material_catalogue.category uses the GROUNDING vocab ('fan',
// 'hot_water', 'rcbo', 'tap', etc.) because that's what the Catalogue-tab
// dropdown writes + what the grounding validator matches against.
//
// Before this fix, computeCoverage was bucketing the two sides by raw
// category, so a tenant with a 'fan' row legitimately stocked from the
// supplier catalogue (whose granular category was 'ceiling_fan') was
// reported as 0-of-2 missing — even though the row was right there.
// Same for hot_water vs hws_electric/hws_gas/hws_heat_pump, rcbo vs
// safety_switch, etc.
//
// The fix: normalise BOTH sides to the grounding vocab via
// granularToGroundingCategory() before bucketing. Tenant rows already
// use grounding so they pass through unchanged; shared rows get
// collapsed (e.g. ceiling_fan → fan, hws_electric/gas/heat_pump → all
// fold to hot_water). The displayed category in the report is the
// grounding form (matches how the rest of the dashboard talks about
// categories).
// ──────────────────────────────────────────────────────────────────────
//
// This module is intentionally pure — no DB, no fetch, no React. The
// caller queries shared_materials + tenant_material_catalogue, hands the
// rows to computeCoverage(), and gets back the report. Easy to test
// without mocking Supabase.

import { granularToGroundingCategory } from '@/lib/catalogue/category-mapping'

// ─────────────────────────────────────────────────────────────────────
// Row shapes — only the columns coverage cares about.
// ─────────────────────────────────────────────────────────────────────

export type SharedMaterialRow = {
  trade: string | null
  category: string | null
}

export type TenantMaterialRow = {
  trade: string | null
  category: string | null
  active?: boolean | null
}

// ─────────────────────────────────────────────────────────────────────
// Output shape
// ─────────────────────────────────────────────────────────────────────

/** One category's slice of the coverage report. */
export type CategoryCoverage = {
  /** Category slug as stored on the rows (e.g. "hws_electric"). */
  category: string
  /** How many shared rows exist for this (trade, category). */
  shared_count: number
  /** How many ACTIVE tenant rows exist for this (trade, category). */
  tenant_count: number
  /** Shared rows the tenant doesn't have yet. clamped to >= 0 so an
   *  over-stocked tenant (more tenant rows than shared) reports 0. */
  missing_count: number
  /** True when the tenant has at least one row in this category. */
  covered: boolean
}

/** Per-trade rollup. */
export type TradeCoverage = {
  trade: string
  /** Distinct categories the shared catalogue stocks for this trade. */
  total_shared_categories: number
  /** Distinct categories the tenant has AT LEAST ONE active row in. */
  covered_categories: number
  /** total_shared_categories - covered_categories. */
  uncovered_categories: number
  /** Sum of missing_count across every shared category. */
  missing_rows_total: number
  /** 0..100, integer, derived from covered_categories /
   *  total_shared_categories. Returns 0 when there are no shared
   *  categories at all. */
  coverage_pct: number
  /** All categories the shared catalogue stocks for this trade, sorted
   *  by category slug. Even covered categories appear so the dashboard
   *  can show "you have 1 of 4 hws_electric — 3 missing". */
  categories: CategoryCoverage[]
}

/** Top-level report returned by the /api/tenant/catalogue/coverage route. */
export type CoverageReport = {
  /** The trades the tenant operates in (mirrors what the route resolves
   *  from tenants.trades). */
  trades_active: string[]
  /** Per-trade rollups, in the same order as trades_active. */
  by_trade: TradeCoverage[]
}

// ─────────────────────────────────────────────────────────────────────
// Pure computation
// ─────────────────────────────────────────────────────────────────────

function normTrade(t: string | null | undefined): string | null {
  const s = (t ?? '').trim().toLowerCase()
  return s.length > 0 ? s : null
}

function normCategory(c: string | null | undefined): string | null {
  const s = (c ?? '').trim().toLowerCase()
  return s.length > 0 ? s : null
}

/**
 * Normalise either a granular or grounding category to its grounding
 * form so both sides of the coverage diff use the same vocabulary.
 *
 * - 'ceiling_fan' (granular, shared_materials)        → 'fan'
 * - 'hws_electric' / 'hws_gas' / 'hws_heat_pump'      → 'hot_water'
 * - 'tapware_basin' / 'tapware_kitchen' / etc.        → 'tap'
 * - 'safety_switch'                                   → 'rcbo'
 * - 'sundries'                                        → 'sundry'
 * - 'toilet_repair'                                   → 'toilet'
 * - Already-grounding categories ('fan', 'hot_water') → unchanged
 * - Unmapped strings ('cctv', custom slugs)           → returned as-is
 *
 * The fallback to the raw lowercased input is intentional: tenant rows
 * may legitimately carry one-off custom categories the shared catalogue
 * doesn't stock (e.g. Peppers' 'cctv' rental row). Coverage should
 * surface those as "tenant has a category outside the shared library"
 * rather than dropping them.
 */
function toGrounding(raw: string): string {
  const grounded = granularToGroundingCategory(raw)
  return grounded ?? raw
}

/**
 * Compute the coverage report from raw rows.
 *
 * @param tradesActive  Trades the tenant operates in (e.g. ["electrical","plumbing"]).
 *                      The report includes one TradeCoverage per entry, even
 *                      when the tenant has zero rows in that trade.
 * @param sharedRows    Every shared_materials row across all trades. Filtered
 *                      internally by trade. NULL trade/category are dropped.
 * @param tenantRows    Every tenant_material_catalogue row for THIS tenant.
 *                      Inactive rows are skipped. NULL trade/category are dropped.
 */
export function computeCoverage(
  tradesActive: string[],
  sharedRows: SharedMaterialRow[],
  tenantRows: TenantMaterialRow[],
): CoverageReport {
  const trades = tradesActive
    .map(normTrade)
    .filter((t): t is string => t !== null)

  // Group shared rows by trade -> grounding-category -> count.
  // Multiple granular categories collapse into the same grounding bucket
  // (e.g. hws_electric + hws_gas + hws_heat_pump all add to 'hot_water').
  const sharedByTrade = new Map<string, Map<string, number>>()
  for (const row of sharedRows) {
    const trade = normTrade(row.trade)
    const rawCategory = normCategory(row.category)
    if (!trade || !rawCategory) continue
    const category = toGrounding(rawCategory)
    if (!sharedByTrade.has(trade)) sharedByTrade.set(trade, new Map())
    const cats = sharedByTrade.get(trade)!
    cats.set(category, (cats.get(category) ?? 0) + 1)
  }

  // Group active tenant rows by trade -> grounding-category -> count.
  // Tenant rows already use grounding vocab but we run them through the
  // same mapper defensively — handles legacy rows that may have been
  // stored with granular categories before the dropdown enforced
  // grounding values.
  const tenantByTrade = new Map<string, Map<string, number>>()
  for (const row of tenantRows) {
    // Default active to true when the column is missing/undefined — matches
    // the dashboard's own treatment (the catalogue tab hides explicitly
    // active=false rows but treats missing as active).
    if (row.active === false) continue
    const trade = normTrade(row.trade)
    const rawCategory = normCategory(row.category)
    if (!trade || !rawCategory) continue
    const category = toGrounding(rawCategory)
    if (!tenantByTrade.has(trade)) tenantByTrade.set(trade, new Map())
    const cats = tenantByTrade.get(trade)!
    cats.set(category, (cats.get(category) ?? 0) + 1)
  }

  const byTrade: TradeCoverage[] = trades.map((trade) => {
    const sharedCats = sharedByTrade.get(trade) ?? new Map<string, number>()
    const tenantCats = tenantByTrade.get(trade) ?? new Map<string, number>()

    // Every shared category for this trade, plus any tenant categories
    // that AREN'T in the shared catalogue (those report shared_count=0,
    // useful as a "tenant has a one-off custom category" signal).
    const allCats = new Set<string>([
      ...sharedCats.keys(),
      ...tenantCats.keys(),
    ])

    const categories: CategoryCoverage[] = Array.from(allCats)
      .sort()
      .map((category) => {
        const sharedCount = sharedCats.get(category) ?? 0
        const tenantCount = tenantCats.get(category) ?? 0
        const missingCount = Math.max(0, sharedCount - tenantCount)
        return {
          category,
          shared_count: sharedCount,
          tenant_count: tenantCount,
          missing_count: missingCount,
          covered: tenantCount >= 1,
        }
      })

    // Coverage stats are computed off the SHARED catalogue universe only —
    // a tenant-only custom category doesn't penalise their coverage_pct.
    const sharedCategories = categories.filter((c) => c.shared_count > 0)
    const coveredCategories = sharedCategories.filter((c) => c.covered).length
    const totalSharedCategories = sharedCategories.length
    const missingRowsTotal = sharedCategories.reduce(
      (sum, c) => sum + c.missing_count,
      0,
    )
    const coveragePct =
      totalSharedCategories === 0
        ? 0
        : Math.round((coveredCategories / totalSharedCategories) * 100)

    return {
      trade,
      total_shared_categories: totalSharedCategories,
      covered_categories: coveredCategories,
      uncovered_categories: totalSharedCategories - coveredCategories,
      missing_rows_total: missingRowsTotal,
      coverage_pct: coveragePct,
      categories,
    }
  })

  return {
    trades_active: trades,
    by_trade: byTrade,
  }
}
