// Which trades a recipe — parts (migration 031) or steps (migration 184) —
// can actually be stored against.
//
// Why this exists: both Recipes GETs used to offer every job in the TENANT's
// trades, while both writers validate `trade` with TRADE_ENUM (electrical +
// plumbing) and tenant_assembly_tasks carries a matching CHECK. On an 8-trade
// tenant the tab therefore opened on an aircon job whose add form 400s on
// every submit — the picker offered 16 jobs (2 aircon, 14 roofing) that have
// no shared baseline, no existing rows, and no writable path.
//
// Derived from TRADE_ENUM rather than restating the pair, so widening the enum
// widens the picker in one move.

import { TRADE_ENUM } from './update-schema'

export const RECIPE_TRADES: readonly string[] = TRADE_ENUM.options

/**
 * Narrow a tenant's trades to the ones a recipe can be stored against.
 *
 * Empty result is meaningful, not a bug: a roofing-only tenant can hold no
 * recipe at all, so the picker must show nothing rather than fall through to
 * every trade. Callers must treat `[]` as "no jobs", never as "no filter".
 */
export function recipeTradesFor(tenantTrades: readonly string[]): string[] {
  // No trades recorded at all: fall back to the recipe-capable pair rather
  // than every trade, so the picker still never offers an unwritable job.
  if (tenantTrades.length === 0) return [...RECIPE_TRADES]
  return tenantTrades.filter((t) => RECIPE_TRADES.includes(t))
}
