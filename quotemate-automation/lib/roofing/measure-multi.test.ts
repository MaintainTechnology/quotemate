// Multi-structure orchestrator — measureAndPriceRoofs wires measureAll →
// per-structure pricing → aggregated quote, with a single-building
// fallback for providers that can't enumerate buildings.

import { describe, expect, it } from 'vitest'
import { MockRoofingProvider } from './providers/mock'
import { measureAndPriceRoofs } from './measure'
import type { RoofMetrics, RoofUserInputs } from './types'
import type { RoofingMeasurementProvider } from './providers/base'

/** Minimal metrics builder for the ordering tests below. */
function metricsOf(footprint_m2: number, sloped_area_m2: number | null, buildingId: string): RoofMetrics {
  return {
    footprint_m2,
    sloped_area_m2,
    storeys: 1,
    form: 'gable',
    hips: 0,
    valleys: 0,
    ridge_lm: null,
    polygon_geojson: null,
    capture_date: null,
    buildingId,
  }
}

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

describe('measureAndPriceRoofs — structures ordered largest roof first', () => {
  // A provider that hands back its structures in the WRONG order: a small
  // building flagged 'primary' first, a LARGE detached structure second,
  // and a medium one third. The orchestrator must re-rank by roof size so
  // the Main dwelling is always the biggest roof.
  class WrongOrderProvider implements RoofingMeasurementProvider {
    readonly name = 'mock' as const
    async measure() {
      return {
        ok: true as const,
        provider: 'mock' as const,
        warnings: [],
        metrics: metricsOf(70, 80, 'small'),
      }
    }
    async measureAll() {
      return {
        ok: true as const,
        provider: 'mock' as const,
        warnings: [],
        buildings: [
          // Provider's own (wrong) ordering + role flags:
          { buildingId: 'small', role: 'primary' as const, metrics: metricsOf(70, 80, 'small') },
          { buildingId: 'big', role: 'secondary' as const, metrics: metricsOf(280, 300, 'big') },
          { buildingId: 'medium', role: 'secondary' as const, metrics: metricsOf(140, 150, 'medium') },
        ],
      }
    }
  }

  it('makes the largest roof the Main dwelling and sequences the rest largest→smallest', async () => {
    const r = await measureAndPriceRoofs(ADDR, INPUTS, { provider: new WrongOrderProvider() })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const s = r.quote.structures
    expect(s).toHaveLength(3)

    // Largest roof (sloped 300) is the Main dwelling, regardless of the
    // provider's claim that the 80 m² building was 'primary'.
    expect(s[0].buildingId).toBe('big')
    expect(s[0].role).toBe('primary')
    expect(s[0].label).toBe('Main dwelling')

    // Secondaries follow in strictly descending roof size, numbered in order.
    expect(s[1].buildingId).toBe('medium')
    expect(s[1].role).toBe('secondary')
    expect(s[1].label).toBe('Secondary structure 1')
    expect(s[2].buildingId).toBe('small')
    expect(s[2].role).toBe('secondary')
    expect(s[2].label).toBe('Secondary structure 2')

    // The sloped areas are monotonically non-increasing across the line-up.
    const areas = s.map((x) => x.metrics.sloped_area_m2 ?? x.metrics.footprint_m2 ?? 0)
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i - 1]).toBeGreaterThanOrEqual(areas[i])
    }
  })

  it('falls back to footprint when sloped area is missing, still largest-first', async () => {
    class NullSlopedProvider implements RoofingMeasurementProvider {
      readonly name = 'mock' as const
      async measure() {
        return { ok: true as const, provider: 'mock' as const, warnings: [], metrics: metricsOf(120, null, 'a') }
      }
      async measureAll() {
        return {
          ok: true as const,
          provider: 'mock' as const,
          warnings: [],
          buildings: [
            { buildingId: 'a', role: 'primary' as const, metrics: metricsOf(120, null, 'a') },
            { buildingId: 'b', role: 'secondary' as const, metrics: metricsOf(260, null, 'b') },
          ],
        }
      }
    }
    const r = await measureAndPriceRoofs(ADDR, INPUTS, { provider: new NullSlopedProvider() })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 'b' has the larger footprint (260 vs 120) → becomes the Main dwelling.
    expect(r.quote.structures[0].buildingId).toBe('b')
    expect(r.quote.structures[0].label).toBe('Main dwelling')
  })
})
