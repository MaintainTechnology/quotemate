// PropRadar property-context enrichment — pure parsing, the best-effort
// fetch (injected), the derived warnings, and the end-to-end wiring into
// measureAndPriceRoofs (context attach + asbestos-year seeding).
//
// Attribute shapes are verbatim from the live probe on 2026-07-01:
//   free plan  → { bedrooms, bathrooms, parking, property_type:"House",
//                  land_size_sqm, floor_area_sqm }  (year_built omitted)
//   Hobby+     → adds year_built.

import { describe, expect, it, vi } from 'vitest'
import {
  fetchPropertyContext,
  pickPropertyId,
  propertyContextWarnings,
  propradarEnabled,
  toPropertyContext,
  type PropRadarOpts,
} from './propradar'
import { measureAndPriceRoofs } from './measure'
import { propertyContextChips } from './attributes-display'
import type {
  GeoJSONPolygon,
  MultiRoofQuote,
  RoofAddressInput,
  RoofMetrics,
  RoofUserInputs,
  RoofingMultiMeasurementResult,
} from './types'
import type { RoofingMeasurementProvider } from './providers/base'

const ADDR: RoofAddressInput = { address: '14 Noonan Road Caversham', postcode: '6055', state: 'WA' }
const INPUTS: RoofUserInputs = { material: 'colorbond_corrugated', pitch: 'standard', intent: 'full_reroof' }

const DETAIL_FREE = { attributes: { bedrooms: 4, bathrooms: 2, parking: 2, property_type: 'House', land_size_sqm: 280, floor_area_sqm: 144 } }
const DETAIL_PAID = { attributes: { property_type: 'House', year_built: 1975, land_size_sqm: 600, floor_area_sqm: 180 } }

const SQUARE: GeoJSONPolygon = {
  type: 'Polygon',
  coordinates: [[[153.07, -27.5], [153.0702, -27.5], [153.0702, -27.5002], [153.07, -27.5002], [153.07, -27.5]]],
}
function metrics(footprint_m2: number, storeys: number): RoofMetrics {
  return {
    footprint_m2, sloped_area_m2: Math.round(footprint_m2 * 1.1), storeys,
    form: 'hip', hips: 4, valleys: 0, ridge_lm: null, polygon_geojson: SQUARE, capture_date: null,
  }
}
function jsonRes(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status })
}
const injected = (fetchImpl: PropRadarOpts['fetchImpl']): PropRadarOpts => ({
  enabled: true, apiKey: 'k', baseUrl: 'https://api.test/v1', fetchImpl,
})

describe('pickPropertyId', () => {
  it('returns null when found:false (off-market — the common roofing case)', () => {
    expect(pickPropertyId({ property_id: null, found: false, matches: [] })).toBeNull()
  })
  it('reads property_id when covered', () => {
    expect(pickPropertyId({ property_id: 'c8868204', found: true })).toBe('c8868204')
  })
  it('falls back to matches[].property_id', () => {
    expect(pickPropertyId({ matches: [{ property_id: 'abc123' }] })).toBe('abc123')
  })
  it('null on junk', () => {
    expect(pickPropertyId(null)).toBeNull()
    expect(pickPropertyId({})).toBeNull()
  })
})

describe('toPropertyContext', () => {
  it('maps the free-plan attributes (year_built absent → null)', () => {
    expect(toPropertyContext('c8868204', DETAIL_FREE)).toEqual({
      source: 'propradar', property_id: 'c8868204', property_type: 'House',
      year_built: null, floor_area_sqm: 144, land_size_sqm: 280, bedrooms: 4, bathrooms: 2, parking: 2,
    })
  })
  it('maps year_built when present (paid plan)', () => {
    expect(toPropertyContext('x', DETAIL_PAID)?.year_built).toBe(1975)
  })
})

describe('propradarEnabled', () => {
  it('requires both a flag and a key', () => {
    expect(propradarEnabled({ enabled: true, apiKey: 'k' })).toBe(true)
    expect(propradarEnabled({ enabled: true, apiKey: '' })).toBe(false)
    expect(propradarEnabled({ enabled: false, apiKey: 'k' })).toBe(false)
  })
})

describe('fetchPropertyContext (injected fetch, X-API-Key auth)', () => {
  it('returns null without calling the API when disabled', async () => {
    const f = vi.fn()
    expect(await fetchPropertyContext(ADDR, { enabled: false, apiKey: 'k', fetchImpl: f })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
  it('off-market address → null after ONE call (no wasted detail call)', async () => {
    const f = vi.fn().mockResolvedValueOnce(jsonRes({ found: false, matches: [] }))
    expect(await fetchPropertyContext(ADDR, injected(f))).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('covered address → mapped context (search → detail), sends X-API-Key', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(jsonRes({ property_id: 'p1', found: true }))
      .mockResolvedValueOnce(jsonRes(DETAIL_PAID))
    const c = await fetchPropertyContext(ADDR, injected(f))
    expect(c?.property_type).toBe('House')
    expect(c?.year_built).toBe(1975)
    expect(f).toHaveBeenCalledTimes(2)
    expect((f.mock.calls[0][1] as { headers: Record<string, string> }).headers['X-API-Key']).toBe('k')
  })
  it('never throws — returns null on network error', async () => {
    const f = vi.fn().mockRejectedValue(new Error('boom'))
    expect(await fetchPropertyContext(ADDR, injected(f))).toBeNull()
  })
})

describe('propertyContextWarnings', () => {
  function quoteWith(footprint: number, storeys = 1): MultiRoofQuote {
    return {
      structures: [{ role: 'primary', label: 'Main', metrics: metrics(footprint, storeys) }],
      routing: { decision: 'auto_quote', reason: '' },
    } as unknown as MultiRoofQuote
  }
  it('warns on a non-house dwelling type', () => {
    const ctx = toPropertyContext('x', { attributes: { property_type: 'Unit', floor_area_sqm: 120 } })!
    expect(propertyContextWarnings(ctx, quoteWith(120)).some((s) => /Unit/.test(s))).toBe(true)
  })
  it('no strata warning for a house', () => {
    const ctx = toPropertyContext('x', { attributes: { property_type: 'House', floor_area_sqm: 140 } })!
    expect(propertyContextWarnings(ctx, quoteWith(150)).some((s) => /strata/.test(s))).toBe(false)
  })
  it('warns when the measured footprint wildly diverges from floor area', () => {
    const ctx = toPropertyContext('x', { attributes: { property_type: 'House', floor_area_sqm: 400 } })!
    expect(propertyContextWarnings(ctx, quoteWith(60, 1)).some((s) => /differs from PropRadar floor area/.test(s))).toBe(true)
  })
})

describe('propertyContextChips', () => {
  it('produces roofing-relevant chips', () => {
    const labels = propertyContextChips(toPropertyContext('x', DETAIL_PAID)!).map(([l]) => l)
    expect(labels).toEqual(expect.arrayContaining(['Property type', 'Year built', 'Floor area', 'Land size']))
  })
})

describe('end-to-end via measureAndPriceRoofs', () => {
  function fakeProvider(): RoofingMeasurementProvider {
    return {
      name: 'geoscape',
      async measure() { throw new Error('measure() unused in this test') },
      async measureAll(): Promise<RoofingMultiMeasurementResult> {
        return { ok: true, provider: 'geoscape', warnings: [], buildings: [{ buildingId: 'b1', role: 'primary', metrics: metrics(150, 1) }] }
      },
    }
  }
  it('attaches property_context and seeds the asbestos year on covered pre-1990 homes', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(jsonRes({ property_id: 'p1', found: true }))
      .mockResolvedValueOnce(jsonRes(DETAIL_PAID))
    const res = await measureAndPriceRoofs(ADDR, INPUTS, { provider: fakeProvider(), propradar: injected(f) })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.quote.property_context?.property_type).toBe('House')
      expect(res.quote.property_context?.year_built).toBe(1975)
      // year_built seeded into the priced structure's inputs → asbestos gate fires.
      expect(res.quote.structures[0].inputs.building_year_built).toBe(1975)
    }
  })
  it('does NOT attach context or call PropRadar when disabled (the default)', async () => {
    const f = vi.fn()
    const res = await measureAndPriceRoofs(ADDR, INPUTS, {
      provider: fakeProvider(), propradar: { enabled: false, apiKey: 'k', fetchImpl: f },
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.quote.property_context ?? null).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})
