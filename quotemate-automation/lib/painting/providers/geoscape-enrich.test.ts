import { describe, it, expect } from 'vitest'
import {
  enrichFromGeoscape,
  extractEaveHeight,
  extractZoning,
  absoluteLink,
} from './geoscape-enrich'
import type { PaintAddressInput } from '../types'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function router(routes: Array<{ when: (u: string) => boolean; body: unknown; ok?: boolean }>): FetchLike {
  return async (input) => {
    const url = String(input)
    const r = routes.find((x) => x.when(url))
    if (!r) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    return { ok: r.ok ?? true, status: 200, json: async () => r.body } as unknown as Response
  }
}

const ADDR: PaintAddressInput = { address: '31 Greens Rd, Coorparoo', postcode: '4151', state: 'QLD' }

// Shapes captured live 2026-07-01 (scripts/probe-geoscape-building-attrs.mjs).
const FIXTURES = {
  addresses: { data: [{ addressId: 'GAQLD155218810', addressString: '31 Greens Rd, Coorparoo QLD 4151', matchConfidence: 100 }] },
  buildings: {
    data: [{
      buildingId: 'bldaea00f0a464f', coverageType: 'Urban', relatedAddressIds: ['a'],
      links: {
        area: '/v1/buildings/bldaea00f0a464f/area',
        averageEaveHeight: '/v1/buildings/bldaea00f0a464f/averageEaveHeight',
        estimatedLevels: '/v1/buildings/bldaea00f0a464f/estimatedLevels',
        zonings: '/v1/buildings/bldaea00f0a464f/zonings',
      },
    }],
  },
  levels: { estimatedLevels: 2, buildingId: 'bldaea00f0a464f' },
  eave: { averageEaveHeight: 8.94, buildingId: 'bldaea00f0a464f' },
  zonings: { zonings: ['Residential'], buildingId: 'bldaea00f0a464f' },
  area: { area: 213.89, buildingId: 'bldaea00f0a464f' },
}

function happyFetch(): FetchLike {
  return router([
    { when: (u) => u.includes('/addresses'), body: FIXTURES.addresses },
    { when: (u) => u.includes('/buildings?addressId'), body: FIXTURES.buildings },
    { when: (u) => u.includes('/estimatedLevels'), body: FIXTURES.levels },
    { when: (u) => u.includes('/averageEaveHeight'), body: FIXTURES.eave },
    { when: (u) => u.includes('/zonings'), body: FIXTURES.zonings },
    { when: (u) => u.includes('/area'), body: FIXTURES.area },
  ])
}

describe('enrichFromGeoscape', () => {
  it('maps storeys, eave height, zoning use and footprint from live sub-resources', async () => {
    const res = await enrichFromGeoscape(ADDR, { apiKey: 'k', fetchImpl: happyFetch() })
    expect(res.patch.storeys).toBe(2)
    expect(res.patch.eave_height_m).toBe(8.94)
    expect(res.patch.property_type).toBe('Residential')
    expect(res.patch.footprint_m2).toBe(213.9)
    expect(res.notes.join(' ')).toMatch(/Storeys/)
    expect(res.notes.join(' ')).toMatch(/Eave height/)
  })

  it('no-ops without an API key (never calls fetch)', async () => {
    let called = false
    const res = await enrichFromGeoscape(ADDR, {
      apiKey: '',
      fetchImpl: async () => {
        called = true
        return {} as Response
      },
    })
    expect(res).toEqual({ patch: {}, notes: [] })
    expect(called).toBe(false)
  })

  it('returns empty when the address does not resolve', async () => {
    const res = await enrichFromGeoscape(ADDR, {
      apiKey: 'k',
      fetchImpl: router([{ when: (u) => u.includes('/addresses'), body: { data: [] } }]),
    })
    expect(res).toEqual({ patch: {}, notes: [] })
  })

  it('returns empty when no building is found', async () => {
    const res = await enrichFromGeoscape(ADDR, {
      apiKey: 'k',
      fetchImpl: router([
        { when: (u) => u.includes('/addresses'), body: FIXTURES.addresses },
        { when: (u) => u.includes('/buildings'), body: { data: [] } },
      ]),
    })
    expect(res).toEqual({ patch: {}, notes: [] })
  })
})

describe('extractEaveHeight', () => {
  it('reads averageEaveHeight', () => {
    expect(extractEaveHeight({ averageEaveHeight: 8.94 })).toBe(8.94)
  })
  it('rejects non-positive / missing', () => {
    expect(extractEaveHeight({ averageEaveHeight: 0 })).toBeNull()
    expect(extractEaveHeight({})).toBeNull()
    expect(extractEaveHeight(null)).toBeNull()
  })
})

describe('extractZoning', () => {
  it('reads the first zonings entry', () => {
    expect(extractZoning({ zonings: ['Residential'] })).toBe('Residential')
  })
  it('handles empty / missing', () => {
    expect(extractZoning({ zonings: [] })).toBeNull()
    expect(extractZoning({})).toBeNull()
  })
})

describe('absoluteLink', () => {
  it('resolves a relative /v1 link on the base host', () => {
    expect(absoluteLink('https://api.psma.com.au/v1', '/v1/buildings/x/area')).toBe(
      'https://api.psma.com.au/v1/buildings/x/area',
    )
  })
})
