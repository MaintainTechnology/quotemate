import { describe, it, expect } from 'vitest'
import { enrichFromPropRadar, pickPropertyId } from './propradar'
import type { PaintAddressInput } from '../types'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function router(routes: Array<{ when: (u: string) => boolean; body: unknown; status?: number }>): FetchLike {
  return async (input) => {
    const url = String(input)
    const r = routes.find((x) => x.when(url))
    if (!r) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    const status = r.status ?? 200
    return { ok: status >= 200 && status < 300, status, json: async () => r.body } as unknown as Response
  }
}

const ADDR: PaintAddressInput = { address: '6/24 Haig Street, Coorparoo QLD', postcode: '4151', state: 'QLD' }

// Shapes captured live 2026-07-01 (scripts/probe-propradar-apis.mjs).
const SEARCH_FOUND = { property_id: '962e1df8', found: true, on_market: true, matches: [{ property_id: '962e1df8' }] }
const SEARCH_MISS = { property_id: null, found: false, on_market: false, matches: [], hint: 'off-market' }
const DETAIL = {
  property_id: '962e1df8',
  attributes: { bedrooms: 1, bathrooms: 1, parking: 1, property_type: 'Apartment', land_size_sqm: 88, floor_area_sqm: 110 },
  listing: { on_market: true },
}

describe('enrichFromPropRadar', () => {
  it('maps attributes (incl _sqm → _m2) from a found property', async () => {
    const res = await enrichFromPropRadar(ADDR, {
      apiKey: 'k',
      fetchImpl: router([
        { when: (u) => u.includes('/properties/search'), body: SEARCH_FOUND },
        { when: (u) => u.includes('/properties/962e1df8'), body: DETAIL },
      ]),
    })
    expect(res.found).toBe(true)
    expect(res.patch).toMatchObject({
      bedrooms: 1, bathrooms: 1, car_spaces: 1, property_type: 'Apartment',
      land_size_m2: 88, floor_area_m2: 110, floor_area_source: 'listing',
    })
    expect(res.patch.year_built).toBeUndefined()
    expect(res.notes.join(' ')).toMatch(/PropRadar/)
  })

  it('no-ops on an off-market address (found:false)', async () => {
    const res = await enrichFromPropRadar(ADDR, {
      apiKey: 'k',
      fetchImpl: router([{ when: (u) => u.includes('/properties/search'), body: SEARCH_MISS }]),
    })
    expect(res).toEqual({ patch: {}, notes: [], found: false })
  })

  it('maps year_built when the record carries it', async () => {
    const res = await enrichFromPropRadar(ADDR, {
      apiKey: 'k',
      fetchImpl: router([
        { when: (u) => u.includes('/properties/search'), body: SEARCH_FOUND },
        { when: (u) => u.includes('/properties/962e1df8'), body: { ...DETAIL, attributes: { ...DETAIL.attributes, year_built: 1995 } } },
      ]),
    })
    expect(res.patch.year_built).toBe(1995)
  })

  it('treats a 429 as no data (never throws)', async () => {
    const res = await enrichFromPropRadar(ADDR, {
      apiKey: 'k',
      fetchImpl: router([{ when: () => true, body: {}, status: 429 }]),
    })
    expect(res).toEqual({ patch: {}, notes: [], found: false })
  })

  it('no-ops without an API key', async () => {
    let called = false
    const res = await enrichFromPropRadar(ADDR, {
      apiKey: '',
      fetchImpl: async () => {
        called = true
        return {} as Response
      },
    })
    expect(res).toEqual({ patch: {}, notes: [], found: false })
    expect(called).toBe(false)
  })

  it('no-ops on an invalid postcode', async () => {
    let called = false
    const res = await enrichFromPropRadar({ ...ADDR, postcode: 'abcd' }, {
      apiKey: 'k',
      fetchImpl: async () => {
        called = true
        return {} as Response
      },
    })
    expect(res.found).toBe(false)
    expect(called).toBe(false)
  })
})

describe('pickPropertyId', () => {
  it('reads a top-level property_id', () => {
    expect(pickPropertyId({ property_id: 'x1' })).toBe('x1')
  })
  it('reads from matches[]', () => {
    expect(pickPropertyId({ matches: [{ property_id: 'm1' }] })).toBe('m1')
  })
  it('returns null when absent', () => {
    expect(pickPropertyId({ found: false, matches: [] })).toBeNull()
  })
})
