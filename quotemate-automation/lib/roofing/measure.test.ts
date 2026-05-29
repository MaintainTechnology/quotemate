// Orchestrator — wires provider → pricing → result. Tests use the
// mock provider so no network is touched.

import { describe, expect, it } from 'vitest'
import { MockRoofingProvider } from './providers/mock'
import { measureAndPriceRoof, pickProvider, reapplyPitchToMetrics } from './measure'
import type { RoofMetrics } from './types'
import type { RoofingMeasurementProvider } from './providers/base'

const ADDR = { address: '12 Example Rd', postcode: '2750', state: 'NSW' as const }

describe('measureAndPriceRoof — happy path with mock provider', () => {
  it('returns ok with metrics + 3-tier prices', async () => {
    const r = await measureAndPriceRoof(
      ADDR,
      {
        material: 'colorbond_trimdek',
        pitch: 'standard',
        building_year_built: 2010,
        intent: 'full_reroof',
      },
      { provider: new MockRoofingProvider() },
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.provider).toBe('mock')
      expect(r.price.tiers).toHaveLength(3)
      expect(r.price.tiers.map((t) => t.tier)).toEqual(['good', 'better', 'best'])
      expect(r.price.routing.decision).toBe('tradie_review')
    }
  })

  it('routes pre-1990 full re-roof to inspection_required', async () => {
    const r = await measureAndPriceRoof(
      ADDR,
      {
        material: 'colorbond_trimdek',
        pitch: 'standard',
        building_year_built: 1985,
        intent: 'full_reroof',
      },
      { provider: new MockRoofingProvider() },
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.price.routing.decision).toBe('inspection_required')
    }
  })

  it('routes cement_sheet to inspection_required regardless of year', async () => {
    const r = await measureAndPriceRoof(
      ADDR,
      {
        material: 'cement_sheet',
        pitch: 'standard',
        building_year_built: 2010,
        intent: 'full_reroof',
      },
      { provider: new MockRoofingProvider() },
    )
    if (r.ok) expect(r.price.routing.decision).toBe('inspection_required')
  })
})

describe('measureAndPriceRoof — provider failure handling', () => {
  class FailingProvider implements RoofingMeasurementProvider {
    readonly name = 'mock' as const
    async measure() {
      return { ok: false as const, code: 'provider_unavailable' as const, detail: 'down' }
    }
  }

  class ThrowingProvider implements RoofingMeasurementProvider {
    readonly name = 'mock' as const
    async measure(): Promise<never> {
      throw new Error('boom')
    }
  }

  it('passes through { ok: false } from a graceful provider', async () => {
    const r = await measureAndPriceRoof(
      ADDR,
      { material: 'colorbond_trimdek', pitch: 'standard', intent: 'full_reroof' },
      { provider: new FailingProvider() },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('provider_unavailable')
    }
  })

  it('catches throws from a provider and returns { ok:false, provider_unavailable }', async () => {
    const r = await measureAndPriceRoof(
      ADDR,
      { material: 'colorbond_trimdek', pitch: 'standard', intent: 'full_reroof' },
      { provider: new ThrowingProvider() },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('provider_unavailable')
      expect(r.detail).toMatch(/boom/)
    }
  })
})

describe('reapplyPitchToMetrics', () => {
  const baseMetrics: RoofMetrics = {
    footprint_m2: 200,
    sloped_area_m2: 220, // value-from-standard
    storeys: 1,
    form: 'hip',
    hips: 4,
    valleys: 0,
    ridge_lm: null,
    polygon_geojson: null,
    capture_date: null,
  }

  it('updates sloped_area_m2 when the customer picks shallow pitch', () => {
    const m = reapplyPitchToMetrics(baseMetrics, {
      material: 'colorbond_trimdek',
      pitch: 'shallow',
      intent: 'full_reroof',
    })
    expect(m.sloped_area_m2).toBe(212) // 200 × 1.06
    expect(m.footprint_m2).toBe(200)
  })

  it('nulls sloped_area_m2 on unknown pitch', () => {
    const m = reapplyPitchToMetrics(baseMetrics, {
      material: 'colorbond_trimdek',
      pitch: 'unknown',
      intent: 'full_reroof',
    })
    expect(m.sloped_area_m2).toBeNull()
  })
})

describe('pickProvider', () => {
  it('honours an explicit override', () => {
    const mock = new MockRoofingProvider()
    expect(pickProvider({ provider: mock })).toBe(mock)
  })

  it('falls back to mock when no key is set and no env override', () => {
    const prev = process.env.GEOSCAPE_API_KEY
    const prevEnv = process.env.ROOFING_PROVIDER
    delete process.env.GEOSCAPE_API_KEY
    delete process.env.ROOFING_PROVIDER
    try {
      const p = pickProvider()
      expect(p.name).toBe('mock')
    } finally {
      if (prev !== undefined) process.env.GEOSCAPE_API_KEY = prev
      if (prevEnv !== undefined) process.env.ROOFING_PROVIDER = prevEnv
    }
  })
})
