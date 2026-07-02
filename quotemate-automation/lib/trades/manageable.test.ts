// Unit tests for the shared manageable-trades registry read.
//
// The load-bearing case: PostgREST embeds trade_pricing_defaults as a
// one-to-one `object | null` (trade_id is unique). The routes originally
// assumed an array, which silently emptied the Account-tab Trades card in
// production. hasPricingDefaults must accept BOTH shapes.

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasPricingDefaults, listManageableTrades } from './manageable'

describe('hasPricingDefaults', () => {
  it('accepts the real one-to-one embed shape (object)', () => {
    expect(hasPricingDefaults({ trade_id: 'abc' })).toBe(true)
  })

  it('accepts the to-many embed shape (non-empty array)', () => {
    expect(hasPricingDefaults([{ trade_id: 'abc' }])).toBe(true)
  })

  it('rejects a missing defaults row in either shape', () => {
    expect(hasPricingDefaults(null)).toBe(false)
    expect(hasPricingDefaults(undefined)).toBe(false)
    expect(hasPricingDefaults([])).toBe(false)
  })
})

/** Minimal fake of the route clients' `.from('trades').select().eq().eq()`
 *  chain, resolving with the given rows/error. */
function fakeClient(rows: unknown[] | null, error: { message: string } | null = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: rows, error }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

describe('listManageableTrades', () => {
  it('returns only trades with a pricing-defaults row, object or array shaped', async () => {
    const rows = [
      { name: 'solar', display_name: 'Solar', trade_pricing_defaults: { trade_id: 's' } },
      { name: 'aircon', display_name: 'Air Conditioning', trade_pricing_defaults: null },
      { name: 'painting', display_name: 'Painting', trade_pricing_defaults: [{ trade_id: 'p' }] },
      { name: 'gardening', display_name: 'Gardening', trade_pricing_defaults: [] },
    ]
    const out = await listManageableTrades(fakeClient(rows))
    expect(out).toEqual([
      { name: 'painting', displayName: 'Painting' },
      { name: 'solar', displayName: 'Solar' },
    ])
  })

  it('falls back to the slug when display_name is null and sorts by display name', async () => {
    const rows = [
      { name: 'plumbing', display_name: null, trade_pricing_defaults: { trade_id: 'pl' } },
      { name: 'electrical', display_name: 'Electrical', trade_pricing_defaults: { trade_id: 'e' } },
    ]
    const out = await listManageableTrades(fakeClient(rows))
    expect(out).toEqual([
      { name: 'electrical', displayName: 'Electrical' },
      { name: 'plumbing', displayName: 'plumbing' },
    ])
  })

  it('returns [] for an empty registry', async () => {
    expect(await listManageableTrades(fakeClient([]))).toEqual([])
    expect(await listManageableTrades(fakeClient(null))).toEqual([])
  })

  it('throws on a registry read error so callers 500 instead of rendering an empty list', async () => {
    await expect(
      listManageableTrades(fakeClient(null, { message: 'relation missing' })),
    ).rejects.toThrow('relation missing')
  })
})
