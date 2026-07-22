// Roofing rate-card lookup — pins the trade argument the SMS receptionist
// passes to loadRoofingRateCard.
//
// Why this exists: /api/sms/inbound used to price roofing with NO rate card,
// so every tenant got DEFAULT_ROOFING_RATE_CARD on SMS while the dashboard
// used their real rates. The fix passes tenants.trade (NOT a literal
// 'roofing') — a cross-trade tenant keeps its roofing_rate_card on its
// PRIMARY-trade pricing_book row, so 'roofing' would miss it and silently
// fall back to defaults. These tests fail if anyone "simplifies" that back.

import { describe, expect, it } from 'vitest'
import { loadRoofingRateCard } from './solar-detect'
import { DEFAULT_ROOFING_RATE_CARD } from './pricing'

/** Minimal supabase stub: one pricing_book table, filtered like the real
 *  query (eq tenant_id, optional eq trade, limit 1, maybeSingle). */
function fakeSupabase(rows: Array<{ tenant_id: string; trade: string; overlays: unknown }>) {
  return {
    from() {
      const filters: Record<string, string> = {}
      const builder = {
        select: () => builder,
        eq(col: string, val: string) {
          filters[col] = val
          return builder
        },
        limit: () => builder,
        maybeSingle: async () => {
          const match = rows.find(
            (r) =>
              r.tenant_id === filters.tenant_id &&
              (filters.trade === undefined || r.trade === filters.trade),
          )
          return { data: match ? { overlays: match.overlays } : null }
        },
      }
      return builder
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// Mirrors live data: Atomic Electrical (cross-trade) keeps its roofing card
// on the 'electrical' row and has no 'roofing' row at all.
const CROSS_TRADE_ROWS = [
  {
    tenant_id: 'atomic',
    trade: 'electrical',
    overlays: { roofing_rate_card: { reroof_rate_per_m2: { colorbond_trimdek: 123 } } },
  },
  { tenant_id: 'atomic', trade: 'plumbing', overlays: {} },
]

describe('loadRoofingRateCard — trade argument', () => {
  it('finds a cross-trade tenant\'s card via its PRIMARY trade', async () => {
    const card = await loadRoofingRateCard(fakeSupabase(CROSS_TRADE_ROWS), 'atomic', 'electrical')
    expect(card.reroof_rate_per_m2.colorbond_trimdek).toBe(123)
  })

  it('MISSES that card when asked for a literal "roofing" row', async () => {
    // The regression this fix exists to prevent — silent fallback to defaults.
    const card = await loadRoofingRateCard(fakeSupabase(CROSS_TRADE_ROWS), 'atomic', 'roofing')
    expect(card.reroof_rate_per_m2.colorbond_trimdek).toBe(
      DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.colorbond_trimdek,
    )
  })

  it('finds a roofing-only tenant\'s card (primary trade IS roofing)', async () => {
    const rows = [
      {
        tenant_id: 'bob',
        trade: 'roofing',
        overlays: { roofing_rate_card: { reroof_rate_per_m2: { colorbond_trimdek: 456 } } },
      },
    ]
    const card = await loadRoofingRateCard(fakeSupabase(rows), 'bob', 'roofing')
    expect(card.reroof_rate_per_m2.colorbond_trimdek).toBe(456)
  })

  it('returns defaults for a null tenant, so pricing never throws', async () => {
    const card = await loadRoofingRateCard(fakeSupabase([]), null, null)
    expect(card).toEqual(DEFAULT_ROOFING_RATE_CARD)
  })

  it('returns defaults when the tenant has no roofing overlay', async () => {
    const rows = [{ tenant_id: 'sparky', trade: 'electrical', overlays: {} }]
    const card = await loadRoofingRateCard(fakeSupabase(rows), 'sparky', 'electrical')
    expect(card).toEqual(DEFAULT_ROOFING_RATE_CARD)
  })
})
