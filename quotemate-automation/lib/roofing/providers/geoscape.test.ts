// Geoscape adapter — pure helpers + the public measure() via a stub
// fetch. Every branch of the response-parsing + form-normalisation
// logic gets its own assertion.

import { describe, expect, it, vi } from 'vitest'
import {
  GeoscapeProvider,
  buildingResponseToMetrics,
  estimateHipsFromForm,
  estimateValleysFromForm,
  isGeoscapeBuildingBody,
  normaliseGeoscapeRoofForm,
  pickAddressId,
  polygonAreaM2,
} from './geoscape'
import type { GeoJSONPolygon } from '../types'

const SQUARE_10M: GeoJSONPolygon = {
  type: 'Polygon',
  // ~10m × 10m square at lat -33.8 (Sydney).
  //   10m of latitude  ≈ 10 / 110574  = 0.0000904506°
  //   10m of longitude ≈ 10 / (111320 × cos(33.8°)) = 10 / 92480 ≈ 0.0001081°
  // Produces a polygon whose shoelace area should be ~100 m².
  coordinates: [[
    [151.2000, -33.8000],
    [151.2001081, -33.8000],
    [151.2001081, -33.8000905],
    [151.2000, -33.8000905],
    [151.2000, -33.8000],
  ]],
}

describe('pickAddressId — envelope variations', () => {
  it('reads { id }', () => {
    expect(pickAddressId({ id: 'abc' })).toBe('abc')
  })
  it('reads { addressId }', () => {
    expect(pickAddressId({ addressId: 'xyz' })).toBe('xyz')
  })
  it('reads { data: [ { id } ] }', () => {
    expect(pickAddressId({ data: [{ id: 'd1' }] })).toBe('d1')
  })
  it('reads { results: [ { addressId } ] }', () => {
    expect(pickAddressId({ results: [{ addressId: 'r1' }] })).toBe('r1')
  })
  it('returns null on empty / unparsable shapes', () => {
    expect(pickAddressId({})).toBeNull()
    expect(pickAddressId(null)).toBeNull()
    expect(pickAddressId({ data: [] })).toBeNull()
  })
})

describe('isGeoscapeBuildingBody', () => {
  it('accepts a body with a Polygon footprint', () => {
    expect(isGeoscapeBuildingBody({ footprint: SQUARE_10M })).toBe(true)
  })
  it('rejects bodies without a footprint', () => {
    expect(isGeoscapeBuildingBody({})).toBe(false)
    expect(isGeoscapeBuildingBody(null)).toBe(false)
  })
  it('rejects non-Polygon footprints', () => {
    expect(
      isGeoscapeBuildingBody({ footprint: { type: 'Point', coordinates: [1, 2] } }),
    ).toBe(false)
  })
})

describe('normaliseGeoscapeRoofForm', () => {
  it('maps strings onto our enum', () => {
    expect(normaliseGeoscapeRoofForm('Gable')).toBe('gable')
    expect(normaliseGeoscapeRoofForm('hip')).toBe('hip')
    expect(normaliseGeoscapeRoofForm('skillion')).toBe('skillion')
    expect(normaliseGeoscapeRoofForm('mono-pitch')).toBe('skillion')
    expect(normaliseGeoscapeRoofForm('gable + hip')).toBe('gable_hip')
    expect(normaliseGeoscapeRoofForm('complex')).toBe('complex')
    expect(normaliseGeoscapeRoofForm('mansard')).toBe('complex')
    expect(normaliseGeoscapeRoofForm(null)).toBe('unknown')
    expect(normaliseGeoscapeRoofForm('')).toBe('unknown')
    expect(normaliseGeoscapeRoofForm('something-else')).toBe('unknown')
  })
})

describe('polygonAreaM2', () => {
  it('computes ~100 m² for a 10m × 10m square at Sydney lat', () => {
    // Allow ±2% — equirectangular projection at residential scale is
    // accurate but not exact.
    const a = polygonAreaM2(SQUARE_10M)
    expect(a).toBeGreaterThan(98)
    expect(a).toBeLessThan(102)
  })
  it('returns 0 for malformed polygons', () => {
    expect(polygonAreaM2({ type: 'Polygon', coordinates: [] })).toBe(0)
    expect(polygonAreaM2({ type: 'Polygon', coordinates: [[[1, 1]]] })).toBe(0)
  })
})

describe('buildingResponseToMetrics', () => {
  it('builds RoofMetrics from a typical hip-roof body', () => {
    const m = buildingResponseToMetrics(
      {
        footprint: SQUARE_10M,
        roofForm: 'hip',
        storeys: 1,
        buildingArea: 200,
        captureDate: '2024-08-15',
      },
      'standard',
    )
    expect(m).not.toBeNull()
    expect(m!.footprint_m2).toBe(200)
    expect(m!.sloped_area_m2).toBe(220) // 200 × 1.10
    expect(m!.form).toBe('hip')
    expect(m!.hips).toBe(4)
    expect(m!.valleys).toBe(0)
    expect(m!.storeys).toBe(1)
    expect(m!.capture_date).toBe('2024-08-15')
  })

  it('falls back to computed footprint when buildingArea is missing', () => {
    const m = buildingResponseToMetrics(
      { footprint: SQUARE_10M, roofForm: 'gable', storeys: 1 },
      'standard',
    )
    expect(m).not.toBeNull()
    expect(m!.footprint_m2).toBeGreaterThan(95)
    expect(m!.footprint_m2).toBeLessThan(105)
  })

  it('returns null when polygon area is zero', () => {
    expect(
      buildingResponseToMetrics(
        { footprint: { type: 'Polygon', coordinates: [] } },
        'standard',
      ),
    ).toBeNull()
  })

  it('does not guess hips/valleys when form is complex', () => {
    const m = buildingResponseToMetrics(
      { footprint: SQUARE_10M, roofForm: 'complex', buildingArea: 200 },
      'standard',
    )
    expect(m!.hips).toBeNull()
    expect(m!.valleys).toBeNull()
  })
})

describe('estimate{Hips,Valleys}FromForm', () => {
  it('gable: 0 hips, 0 valleys', () => {
    expect(estimateHipsFromForm('gable')).toBe(0)
    expect(estimateValleysFromForm('gable')).toBe(0)
  })
  it('hip: 4 hips, 0 valleys', () => {
    expect(estimateHipsFromForm('hip')).toBe(4)
    expect(estimateValleysFromForm('hip')).toBe(0)
  })
  it('gable_hip: 2 hips, 1 valley', () => {
    expect(estimateHipsFromForm('gable_hip')).toBe(2)
    expect(estimateValleysFromForm('gable_hip')).toBe(1)
  })
  it('complex / unknown: nulls (no guessing)', () => {
    expect(estimateHipsFromForm('complex')).toBeNull()
    expect(estimateHipsFromForm('unknown')).toBeNull()
    expect(estimateValleysFromForm('complex')).toBeNull()
  })
})

describe('GeoscapeProvider.measure — error envelope (with stub fetch)', () => {
  it('returns provider_unavailable when API key is missing', async () => {
    const p = new GeoscapeProvider({ apiKey: '', fetchImpl: vi.fn() as never })
    const r = await p.measure({ address: '1 Test St', postcode: '2000', state: 'NSW' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('provider_unavailable')
  })

  it('throws on programmer error — empty address', async () => {
    const p = new GeoscapeProvider({ apiKey: 'fake' })
    await expect(
      p.measure({ address: '', postcode: '2000', state: 'NSW' }),
    ).rejects.toThrow(/address is required/)
  })

  it('returns rate_limited on 429 from the address lookup', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
    const p = new GeoscapeProvider({ apiKey: 'fake', fetchImpl })
    const r = await p.measure({ address: '1 Test St', postcode: '2000', state: 'NSW' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('provider_rate_limited')
  })

  it('returns address_not_resolved on empty address result', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
    const p = new GeoscapeProvider({ apiKey: 'fake', fetchImpl })
    const r = await p.measure({ address: 'gibberish', postcode: '2000', state: 'NSW' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('address_not_resolved')
  })

  it('returns no_building_at_address on 404 from buildings lookup', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'addr-1' }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    const p = new GeoscapeProvider({ apiKey: 'fake', fetchImpl })
    const r = await p.measure({ address: '1 Test St', postcode: '2000', state: 'NSW' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('no_building_at_address')
  })

  it('returns ok with metrics on the full happy path', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'addr-1' }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            footprint: SQUARE_10M,
            roofForm: 'hip',
            storeys: 1,
            buildingArea: 200,
            captureDate: '2024-08-15',
          }),
          { status: 200 },
        ),
      )
    const p = new GeoscapeProvider({ apiKey: 'fake', fetchImpl })
    const r = await p.measure({ address: '1 Test St', postcode: '2000', state: 'NSW' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.metrics.footprint_m2).toBe(200)
      expect(r.metrics.sloped_area_m2).toBe(220)
      expect(r.metrics.form).toBe('hip')
      expect(r.provider).toBe('geoscape')
    }
  })

  it('emits warnings for 2-storey buildings', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'addr-1' }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            footprint: SQUARE_10M,
            roofForm: 'hip',
            storeys: 2,
            buildingArea: 200,
          }),
          { status: 200 },
        ),
      )
    const p = new GeoscapeProvider({ apiKey: 'fake', fetchImpl })
    const r = await p.measure({ address: '1 Test St', postcode: '2000', state: 'NSW' })
    if (r.ok) {
      expect(r.warnings.some((w) => /multi-storey/i.test(w))).toBe(true)
    }
  })

  it('emits warnings for complex roof form', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'addr-1' }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            footprint: SQUARE_10M,
            roofForm: 'complex',
            storeys: 1,
            buildingArea: 200,
          }),
          { status: 200 },
        ),
      )
    const p = new GeoscapeProvider({ apiKey: 'fake', fetchImpl })
    const r = await p.measure({ address: '1 Test St', postcode: '2000', state: 'NSW' })
    if (r.ok) {
      expect(r.warnings.some((w) => /complex/i.test(w))).toBe(true)
    }
  })
})
