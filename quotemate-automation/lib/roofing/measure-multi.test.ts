// Multi-structure orchestrator — measureAndPriceRoofs wires measureAll →
// per-structure pricing → aggregated quote, with a single-building
// fallback for providers that can't enumerate buildings.

import { describe, expect, it } from 'vitest'
import { MockRoofingProvider } from './providers/mock'
import { measureAndPriceRoofs } from './measure'
import type { RoofUserInputs } from './types'
import type { RoofingMeasurementProvider } from './providers/base'

const ADDR = { address: '12 Example Rd', postcode: '2750', state: 'NSW' as const }
const INPUTS: RoofUserInputs = {
  material: 'colorbond_trimdek',
  pitch: 'standard',
  building_year_built: 2010,
  intent: 'full_reroof',
}

describe('MockRoofingProvider.measureAll', () => {
  it('returns a primary house + a secondary shed deterministically', async () => {
    const p = new MockRoofingProvider()
    const r = await p.measureAll(ADDR)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.buildings).toHaveLength(2)
      expect(r.buildings[0].role).toBe('primary')
      expect(r.buildings[1].role).toBe('secondary')
      expect(r.buildings[0].buildingId).toBeTruthy()
      expect(r.buildings[1].buildingId).toBeTruthy()
      // Shed is smaller than the house.
      expect(r.buildings[1].metrics.footprint_m2).toBeLessThan(r.buildings[0].metrics.footprint_m2)
    }
  })
})

describe('measureAndPriceRoofs — happy path with mock provider', () => {
  it('returns an aggregated quote across house + shed', async () => {
    const r = await measureAndPriceRoofs(ADDR, INPUTS, { provider: new MockRoofingProvider() })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.quote.structures).toHaveLength(2)
      expect(r.quote.combined.tiers).toHaveLength(3)
      // Combined better tier = sum of per-structure better tiers.
      const sum = r.quote.structures.reduce((acc, s) => acc + s.price.tiers[1].ex_gst, 0)
      expect(r.quote.combined.tiers[1].ex_gst).toBeCloseTo(sum, 1)
      expect(r.quote.routing.decision).toBe('tradie_review')
    }
  })

  it('applies per-building input overrides by buildingId', async () => {
    const provider = new MockRoofingProvider()
    const first = await measureAndPriceRoofs(ADDR, INPUTS, { provider })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const shed = first.quote.structures.find((s) => s.role === 'secondary')!
    const shedId = shed.buildingId!

    // Re-price with the shed switched to terracotta tile ($130/m²).
    const second = await measureAndPriceRoofs(ADDR, INPUTS, {
      provider,
      perBuilding: { [shedId]: { material: 'terracotta_tile' } },
    })
    expect(second.ok).toBe(true)
    if (second.ok) {
      const shed2 = second.quote.structures.find((s) => s.buildingId === shedId)!
      expect(shed2.inputs.material).toBe('terracotta_tile')
      // The house keeps the shared material.
      const house2 = second.quote.structures.find((s) => s.role === 'primary')!
      expect(house2.inputs.material).toBe('colorbond_trimdek')
    }
  })
})

describe('measureAndPriceRoofs — single-building fallback', () => {
  class SingleOnlyProvider implements RoofingMeasurementProvider {
    readonly name = 'mock' as const
    async measure() {
      return {
        ok: true as const,
        provider: 'mock' as const,
        warnings: [],
        metrics: {
          footprint_m2: 200,
          sloped_area_m2: 220,
          storeys: 1,
          form: 'hip' as const,
          hips: 4,
          valleys: 0,
          ridge_lm: null,
          polygon_geojson: null,
          capture_date: null,
          buildingId: 'solo',
        },
      }
    }
  }

  it('wraps a measure()-only provider into a one-structure quote', async () => {
    const r = await measureAndPriceRoofs(ADDR, INPUTS, { provider: new SingleOnlyProvider() })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.quote.structures).toHaveLength(1)
      expect(r.quote.structures[0].role).toBe('primary')
      expect(r.quote.structures[0].buildingId).toBe('solo')
    }
  })

  class FailingProvider implements RoofingMeasurementProvider {
    readonly name = 'mock' as const
    async measure() {
      return { ok: false as const, code: 'no_building_at_address' as const, detail: 'none' }
    }
  }
  class ThrowingProvider implements RoofingMeasurementProvider {
    readonly name = 'mock' as const
    async measure(): Promise<never> {
      throw new Error('boom')
    }
  }

  it('passes through a graceful provider failure', async () => {
    const r = await measureAndPriceRoofs(ADDR, INPUTS, { provider: new FailingProvider() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('no_building_at_address')
  })

  it('catches a throwing provider', async () => {
    const r = await measureAndPriceRoofs(ADDR, INPUTS, { provider: new ThrowingProvider() })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('provider_unavailable')
      expect(r.detail).toMatch(/boom/)
    }
  })
})
