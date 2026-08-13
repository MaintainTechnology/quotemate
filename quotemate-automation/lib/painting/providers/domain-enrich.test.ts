import { describe, it, expect } from 'vitest'
import { enrichFromDomain, pickBestSuggestion } from './domain-enrich'
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

const ADDR: PaintAddressInput = { address: '670 London Road, Chandler QLD 4155', postcode: '4155', state: 'QLD' }

// Fixture deliberately ordered so the first entry is NOT the highest score.
const SUGGEST_ORDERED = [
  { address: '660 London Road, Chandler QLD 4155', id: 'RR-3689-ZP', relativeScore: 24 },
  { address: '670 London Road, Chandler QLD 4155', id: 'RS-9254-SA', relativeScore: 100, addressComponents: {} },
]

const DETAIL_FULL = {
  bedrooms: 9,
  bathrooms: 4,
  carSpaces: 7,
  storeys: 2,
  yearBuilt: 1890,
  propertyType: 'House',
  propertyCategory: 'Residential',
  areaSize: 10120,
  internalArea: 363,
  addressCoordinate: { lat: -27.50278, lon: 153.16227 },
  features: ['Pool'],
  photos: [
    { imageType: 'Property', fullUrl: 'https://bucket-api.domain.com.au/v1/bucket/image/aaa' },
    { imageType: 'FloorPlan', fullUrl: 'https://bucket-api.domain.com.au/v1/bucket/image/bbb' },
  ],
}

function happyFetch(): FetchLike {
  return router([
    { when: (u) => u.includes('/v1/properties/_suggest'), body: SUGGEST_ORDERED },
    { when: (u) => u.includes('/v1/properties/RS-9254-SA'), body: DETAIL_FULL },
  ])
}

describe('enrichFromDomain', () => {
  it('no-ops without an API key (never calls fetch)', async () => {
    let called = false
    const res = await enrichFromDomain(ADDR, {
      apiKey: '',
      fetchImpl: async () => {
        called = true
        return {} as Response
      },
    })
    expect(res).toEqual({ patch: {}, notes: [], found: false })
    expect(called).toBe(false)
  })

  it('no-ops on a blank/missing address (never calls fetch)', async () => {
    let called = false
    const res = await enrichFromDomain(
      { ...ADDR, address: '   ' },
      {
        apiKey: 'k',
        fetchImpl: async () => {
          called = true
          return {} as Response
        },
      },
    )
    expect(res).toEqual({ patch: {}, notes: [], found: false })
    expect(called).toBe(false)
  })

  it('returns EMPTY when suggest returns an empty array', async () => {
    const res = await enrichFromDomain(ADDR, {
      apiKey: 'k',
      fetchImpl: router([{ when: (u) => u.includes('_suggest'), body: [] }]),
    })
    expect(res).toEqual({ patch: {}, notes: [], found: false })
  })

  it('treats a 429 on suggest as no data (never throws)', async () => {
    const res = await enrichFromDomain(ADDR, {
      apiKey: 'k',
      fetchImpl: router([{ when: (u) => u.includes('_suggest'), body: {}, status: 429 }]),
    })
    expect(res).toEqual({ patch: {}, notes: [], found: false })
  })

  it('treats a 429 on detail as no data (never throws)', async () => {
    const res = await enrichFromDomain(ADDR, {
      apiKey: 'k',
      fetchImpl: router([
        { when: (u) => u.includes('_suggest'), body: SUGGEST_ORDERED },
        { when: (u) => u.includes('/v1/properties/RS-9254-SA'), body: {}, status: 429 },
      ]),
    })
    expect(res).toEqual({ patch: {}, notes: [], found: false })
  })

  it('treats a transport rejection as no data (never throws)', async () => {
    const res = await enrichFromDomain(ADDR, {
      apiKey: 'k',
      fetchImpl: async () => {
        throw new Error('DNS failure')
      },
    })
    expect(res).toEqual({ patch: {}, notes: [], found: false })
  })

  it('treats a malformed JSON body as no data (never throws)', async () => {
    const res = await enrichFromDomain(ADDR, {
      apiKey: 'k',
      fetchImpl: async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('Unexpected token')
          },
        }) as unknown as Response,
    })
    expect(res).toEqual({ patch: {}, notes: [], found: false })
  })

  it('happy path: maps every field from the Chandler fixture', async () => {
    const res = await enrichFromDomain(ADDR, { apiKey: 'k', fetchImpl: happyFetch() })
    expect(res.found).toBe(true)
    expect(res.patch).toEqual({
      bedrooms: 9,
      bathrooms: 4,
      car_spaces: 7,
      storeys: 2,
      year_built: 1890,
      property_type: 'House',
      land_size_m2: 10120,
      floor_area_m2: 363,
      floor_area_source: 'listing',
      has_floor_plan: true,
      floor_plan_urls: ['https://bucket-api.domain.com.au/v1/bucket/image/bbb'],
    })
    expect(res.notes.join(' ')).toMatch(/Domain/)
    expect(res.notes.join(' ')).toMatch(/670 London Road, Chandler QLD 4155/)
    expect(res.notes.join(' ')).toMatch(/363/)
  })

  it('a record with no internalArea omits floor_area_m2 and floor_area_source but maps everything else', async () => {
    const withoutInternalArea = { ...DETAIL_FULL, internalArea: undefined }
    const res = await enrichFromDomain(ADDR, {
      apiKey: 'k',
      fetchImpl: router([
        { when: (u) => u.includes('_suggest'), body: SUGGEST_ORDERED },
        { when: (u) => u.includes('/v1/properties/RS-9254-SA'), body: withoutInternalArea },
      ]),
    })
    expect(res.found).toBe(true)
    expect(res.patch.floor_area_m2).toBeUndefined()
    expect(res.patch.floor_area_source).toBeUndefined()
    expect(res.patch.bedrooms).toBe(9)
    expect(res.patch.land_size_m2).toBe(10120)
  })

  it('a FloorPlan photo populates floor_plan_urls and has_floor_plan:true', async () => {
    const res = await enrichFromDomain(ADDR, { apiKey: 'k', fetchImpl: happyFetch() })
    expect(res.patch.has_floor_plan).toBe(true)
    expect(res.patch.floor_plan_urls).toEqual(['https://bucket-api.domain.com.au/v1/bucket/image/bbb'])
  })

  it('no FloorPlan photo → has_floor_plan:false, floor_plan_urls empty', async () => {
    const detail = { ...DETAIL_FULL, photos: [DETAIL_FULL.photos[0]] }
    const res = await enrichFromDomain(ADDR, {
      apiKey: 'k',
      fetchImpl: router([
        { when: (u) => u.includes('_suggest'), body: SUGGEST_ORDERED },
        { when: (u) => u.includes('/v1/properties/RS-9254-SA'), body: detail },
      ]),
    })
    expect(res.patch.has_floor_plan).toBe(false)
    expect(res.patch.floor_plan_urls).toEqual([])
  })

  it('picks the HIGHEST relativeScore suggestion, not the first array element', async () => {
    const res = await enrichFromDomain(ADDR, { apiKey: 'k', fetchImpl: happyFetch() })
    // SUGGEST_ORDERED[0] is id RR-3689-ZP (score 24); the fixture only wires
    // a detail response for RS-9254-SA (score 100) — a first-element pick
    // would hit the unmocked route and fall through to EMPTY.
    expect(res.found).toBe(true)
    expect(res.notes.join(' ')).toMatch(/670 London Road/)
  })
})

describe('pickBestSuggestion', () => {
  it('picks the entry with the highest relativeScore', () => {
    expect(pickBestSuggestion(SUGGEST_ORDERED)).toEqual({
      id: 'RS-9254-SA',
      address: '670 London Road, Chandler QLD 4155',
    })
  })

  it('returns null for an empty or non-array body', () => {
    expect(pickBestSuggestion([])).toBeNull()
    expect(pickBestSuggestion(null)).toBeNull()
    expect(pickBestSuggestion({})).toBeNull()
  })
})
