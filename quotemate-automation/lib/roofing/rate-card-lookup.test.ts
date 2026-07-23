// Roofing rate-card lookup — the reader must honour the WRITER's contract.
//
// The writer (/api/tenant/roofing-rates PATCH) stores ONE card per tenant,
// "trade-agnostic so it doesn't matter which row holds it": it targets the
// primary-trade pricing_book row but falls back to ANY row when the primary
// trade has none (live: Sparky's primary is commercial_painting, which has
// no pricing_book row at all).
//
// So loadRoofingRateCard must SEARCH the tenant's rows for the card, not
// address a single row. Two real failures the old single-row read caused:
//   - measurement/[token] passed primaryTrade=null → unordered limit(1)
//     picked an arbitrary row (live: Atomic's plumbing row, no card) → the
//     /m reprice priced Atomic at DEFAULTS while save/SMS used its card.
//   - a Sparky-shaped tenant saves rates → written to some row → reader
//     queries the primary trade → no row → rates silently never used.

import { describe, expect, it } from 'vitest'
import { loadRoofingRateCard } from './solar-detect'
import { DEFAULT_ROOFING_RATE_CARD } from './pricing'

/** Fake supabase for the pricing_book read. Rows are returned in ARRAY
 *  ORDER for unfiltered reads — fixtures below deliberately put a card-less
 *  row first, emulating the live unordered-limit(1) trap. */
function fakeSupabase(rows: Array<{ tenant_id: string; trade: string; overlays: unknown }>) {
  return {
    from() {
      const filters: Record<string, string> = {}
      const matches = () =>
        rows.filter(
          (r) =>
            (filters.tenant_id === undefined || r.tenant_id === filters.tenant_id) &&
            (filters.trade === undefined || r.trade === filters.trade),
        )
      const builder = {
        select: () => builder,
        eq(col: string, val: string) {
          filters[col] = val
          return builder
        },
        limit: () => builder,
        maybeSingle: async () => {
          const m = matches()
          return { data: m.length ? { overlays: m[0].overlays } : null }
        },
        // Awaiting the builder itself resolves ALL matching rows,
        // like the real PostgREST builder.
        then(resolve: (v: { data: unknown }) => void) {
          resolve({ data: matches().map((r) => ({ trade: r.trade, overlays: r.overlays })) })
        },
      }
      return builder
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const CARD = { reroof_rate_per_m2: { colorbond_trimdek: 123 } }

// Atomic's live shape: card on 'electrical', a card-less 'plumbing' row
// listed FIRST so any first-row-wins read picks the wrong one.
const ATOMIC_ROWS = [
  { tenant_id: 'atomic', trade: 'plumbing', overlays: {} },
  { tenant_id: 'atomic', trade: 'electrical', overlays: { roofing_rate_card: CARD } },
]

describe('loadRoofingRateCard — searches all rows (writer stores the card on ANY row)', () => {
  it('finds the card via the primary trade (Atomic, the common case)', async () => {
    const card = await loadRoofingRateCard(fakeSupabase(ATOMIC_ROWS), 'atomic', 'electrical')
    expect(card.reroof_rate_per_m2.colorbond_trimdek).toBe(123)
  })

  it('finds the card with NO primary trade — the /m reprice path passes null', async () => {
    // Old behaviour: unordered limit(1) → plumbing row → silent DEFAULTS.
    const card = await loadRoofingRateCard(fakeSupabase(ATOMIC_ROWS), 'atomic', null)
    expect(card.reroof_rate_per_m2.colorbond_trimdek).toBe(123)
  })

  it('finds the card when the primary trade has NO pricing row (Sparky shape)', async () => {
    // Writer fell back to "any row"; reader must find it there.
    const rows = [
      { tenant_id: 'sparky', trade: 'painting', overlays: { roofing_rate_card: CARD } },
      { tenant_id: 'sparky', trade: 'solar', overlays: {} },
    ]
    const card = await loadRoofingRateCard(fakeSupabase(rows), 'sparky', 'commercial_painting')
    expect(card.reroof_rate_per_m2.colorbond_trimdek).toBe(123)
  })

  it('finds the card even when the caller names a trade whose row lacks it', async () => {
    // A literal 'roofing' used to MISS Atomic's card entirely. The card is
    // per-tenant, so a wrong trade hint must degrade the preference, not
    // the result.
    const card = await loadRoofingRateCard(fakeSupabase(ATOMIC_ROWS), 'atomic', 'roofing')
    expect(card.reroof_rate_per_m2.colorbond_trimdek).toBe(123)
  })

  it('prefers the primary-trade row when SEVERAL rows carry a card', async () => {
    const rows = [
      { tenant_id: 't', trade: 'electrical', overlays: { roofing_rate_card: { reroof_rate_per_m2: { colorbond_trimdek: 111 } } } },
      { tenant_id: 't', trade: 'roofing', overlays: { roofing_rate_card: { reroof_rate_per_m2: { colorbond_trimdek: 222 } } } },
    ]
    const viaPrimary = await loadRoofingRateCard(fakeSupabase(rows), 't', 'electrical')
    expect(viaPrimary.reroof_rate_per_m2.colorbond_trimdek).toBe(111)
    // No usable primary → the 'roofing' row wins over alphabetical order.
    const viaRoofing = await loadRoofingRateCard(fakeSupabase(rows), 't', 'aircon')
    expect(viaRoofing.reroof_rate_per_m2.colorbond_trimdek).toBe(222)
  })

  it('finds a roofing-only tenant\'s card (primary trade IS roofing)', async () => {
    const rows = [
      { tenant_id: 'bob', trade: 'roofing', overlays: { roofing_rate_card: { reroof_rate_per_m2: { colorbond_trimdek: 456 } } } },
    ]
    const card = await loadRoofingRateCard(fakeSupabase(rows), 'bob', 'roofing')
    expect(card.reroof_rate_per_m2.colorbond_trimdek).toBe(456)
  })

  it('returns defaults for a null tenant, so pricing never throws', async () => {
    const card = await loadRoofingRateCard(fakeSupabase([]), null, null)
    expect(card).toEqual(DEFAULT_ROOFING_RATE_CARD)
  })

  it('returns defaults when no row carries a roofing overlay', async () => {
    const rows = [{ tenant_id: 's', trade: 'electrical', overlays: {} }]
    const card = await loadRoofingRateCard(fakeSupabase(rows), 's', 'electrical')
    expect(card).toEqual(DEFAULT_ROOFING_RATE_CARD)
  })
})
