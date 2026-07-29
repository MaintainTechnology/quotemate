// Found by driving the real dashboard: the Recipes tab opened on "Ducted
// system — supply & install (per kW)" (aircon) on an 8-trade tenant, and every
// add-step submit came back 400. The picker was fed the tenant's trades; the
// writers accept only TRADE_ENUM. These tests pin the narrowing.

import { describe, it, expect } from 'vitest'
import { RECIPE_TRADES, recipeTradesFor } from './recipe-trades'
import { TRADE_ENUM } from './update-schema'

describe('RECIPE_TRADES tracks TRADE_ENUM', () => {
  it('is exactly the writer enum, not a second hardcoded copy', () => {
    // If someone widens TRADE_ENUM, the picker must widen with it. A literal
    // ['electrical','plumbing'] here would silently drift.
    expect([...RECIPE_TRADES]).toEqual([...TRADE_ENUM.options])
  })
})

describe('recipeTradesFor', () => {
  it('drops the trades a recipe cannot be stored against', () => {
    const eight = [
      'commercial_painting',
      'electrical',
      'plumbing',
      'painting',
      'solar',
      'roofing',
      'aircon',
      'signage',
    ]
    expect(recipeTradesFor(eight).sort()).toEqual(['electrical', 'plumbing'])
  })

  it('excludes aircon — the exact job the tab used to open on', () => {
    expect(recipeTradesFor(['aircon', 'electrical'])).toEqual(['electrical'])
    expect(recipeTradesFor(['aircon', 'electrical'])).not.toContain('aircon')
  })

  it('returns EMPTY for a roofing-only tenant rather than falling through', () => {
    // 3 of 8 live tenants are roofing-only. Empty must mean "no jobs" — a
    // caller that reads it as "no filter" reintroduces the whole bug.
    expect(recipeTradesFor(['roofing'])).toEqual([])
  })

  it('keeps a single recipe trade for a one-trade electrical tenant', () => {
    expect(recipeTradesFor(['electrical'])).toEqual(['electrical'])
  })

  it('falls back to the recipe pair when the tenant has no trades recorded', () => {
    // Distinct from the roofing-only case: nothing is known, so offer the
    // writable pair rather than every trade in the table.
    expect(recipeTradesFor([]).sort()).toEqual(['electrical', 'plumbing'])
  })

  it('preserves the caller order and does not mutate the input', () => {
    const input = ['plumbing', 'roofing', 'electrical']
    const frozen = Object.freeze([...input])
    expect(recipeTradesFor(frozen)).toEqual(['plumbing', 'electrical'])
    expect(input).toEqual(['plumbing', 'roofing', 'electrical'])
  })

  it('never returns a trade the writer enum would reject', () => {
    const messy = ['ELECTRICAL', ' electrical', 'electrical', 'gasfitting', 'roofing']
    for (const t of recipeTradesFor(messy)) {
      expect(TRADE_ENUM.safeParse(t).success).toBe(true)
    }
  })
})
