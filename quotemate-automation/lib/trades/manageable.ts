// Shared "manageable trades" registry read for the Account-tab Trades
// section. A trade is manageable (dashboard-activatable) when it is
// registered, ACTIVE, JOB-BASED, and carries a trade_pricing_defaults row —
// without that row activate_trade_for_tenant() (migration 055) cannot seed
// the pricing_book and activation fails.
//
// Single source of truth for GET /api/tenant/trades/available (renders the
// toggle list) and POST /api/tenant/trades/reconcile (validates the desired
// set). The two routes previously duplicated this query and both assumed the
// PostgREST embed was an array — see hasPricingDefaults for why that made
// every trade vanish from the dashboard in production.

import type { SupabaseClient } from '@supabase/supabase-js'

export type ManageableTrade = { name: string; displayName: string }

/**
 * True when a `trade_pricing_defaults(...)` PostgREST embed says the
 * defaults row exists.
 *
 * trade_pricing_defaults.trade_id is UNIQUE, so PostgREST detects the
 * relationship as one-to-one and embeds `object | null` — NOT the array the
 * routes originally assumed (`Array.isArray(defs) && defs.length > 0`),
 * which filtered out every trade in production while array-shaped test
 * mocks kept the suite green. Accept both shapes so a schema-cache or
 * relationship-detection change can never silently empty the list again.
 */
export function hasPricingDefaults(embed: unknown): boolean {
  if (embed == null) return false
  return Array.isArray(embed) ? embed.length > 0 : typeof embed === 'object'
}

/**
 * Every dashboard-activatable trade, sorted by display name. Throws on a
 * registry read failure so callers return a 500 instead of rendering an
 * empty (and wrong) "no activatable trades" state.
 */
export async function listManageableTrades(
  supabase: SupabaseClient,
): Promise<ManageableTrade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('name, display_name, trade_pricing_defaults(trade_id)')
    .eq('active', true)
    .eq('is_job_based', true)
  if (error) throw new Error(error.message)

  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((t) => hasPricingDefaults(t.trade_pricing_defaults))
    .map((t) => ({
      name: t.name as string,
      displayName: (t.display_name as string | null) ?? (t.name as string),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}
