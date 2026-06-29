// Multi-structure roofing pricing — the call-out floor + the
// priceMultiRoof aggregator (per-structure pricing, combined totals,
// per-structure inspection gate). These are the correctness guards the
// feature spec called blockers: mixed materials must NOT be summed onto
// one rate, loadings/inspection must be evaluated per structure, and a
// tiny shed must not compute an unrealistic price.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROOFING_RATE_CARD,
  calculateRoofingPrice,
  orderStructuresByRoofSize,
  priceMultiRoof,
  roofSizeOrder,
  roofStructureSizeM2,
  type RoofStructureInput,
} from './pricing'
import type { RoofMetrics, RoofUserInputs } from './types'

function metrics(overrides: Partial<RoofMetrics> = {}): RoofMetrics {
  return {
    footprint_m2: 200,
    sloped_area_m2: 220,
    storeys: 1,
    form: 'hip',
    hips: 4,
    valleys: 0,
    ridge_lm: null,
    polygon_geojson: null,
    capture_date: null,
    buildingId: 'b-primary',
    ...overrides,
  }
}

function inputs(overrides: Partial<RoofUserInputs> = {}): RoofUserInputs {
  return {
    material: 'colorbond_trimdek',
    pitch: 'standard',
    building_year_built: 2005,
    intent: 'full_reroof',
    ...overrides,
  }
}

describe('call-out minimum floor', () => {
  it('raises a tiny shed Good tier to the floor and flags it', () => {
    // 12 m² shed → better = 12 × 95 = 1140; good = 1140 × 0.20 = 228.
    // Gable shed → no hip/valley edge works, so the floor is tested alone.
    const r = calculateRoofingPrice({
      metrics: metrics({ footprint_m2: 11, sloped_area_m2: 12, storeys: 1, form: 'gable', hips: 0, valleys: 0, buildingId: 'b-shed' }),
      inputs: inputs(),
    })
    expect(r.tiers[0].ex_gst).toBe(550) // good floored from 228 → 550
    expect(r.tiers[1].ex_gst).toBe(1140) // better above floor, untouched
    expect(r.call_out_minimum_applied).toBe(true)
  })

  it('does NOT bind on a full-size house (no flag, exact tier maths preserved)', () => {
    // Gable so the good = better × 0.20 relationship is isolated from edge works.
    const r = calculateRoofingPrice({ metrics: metrics({ form: 'gable', hips: 0, valleys: 0 }), inputs: inputs() })
    expect(r.tiers[1].ex_gst).toBe(20_900) // 220 × 95
    expect(r.tiers[0].ex_gst).toBeCloseTo(20_900 * 0.2, 1) // good = better × 0.20, NOT floored
    expect(r.call_out_minimum_applied).toBe(false)
  })

  it('leaves a zero-rate (inspection-routed) tier at 0 rather than fabricating a floor', () => {
    // cement_sheet has a $0 base rate AND routes to inspection.
    const r = calculateRoofingPrice({
      metrics: metrics({ footprint_m2: 11, sloped_area_m2: 12 }),
      inputs: inputs({ material: 'cement_sheet' }),
    })
    // better/good derive from a 0 base rate → stay 0 (not floored to 550).
    expect(r.tiers[1].ex_gst).toBe(0)
    expect(r.tiers[0].ex_gst).toBe(0)
  })
})

describe('priceMultiRoof — per-structure pricing + aggregation', () => {
  const house: RoofStructureInput = {
    buildingId: 'b-house',
    role: 'primary',
    metrics: metrics({ footprint_m2: 200, sloped_area_m2: 220, buildingId: 'b-house' }),
    inputs: inputs({ material: 'terracotta_tile' }), // $130/m²
  }
  const shed: RoofStructureInput = {
    buildingId: 'b-shed',
    role: 'secondary',
    metrics: metrics({ footprint_m2: 45, sloped_area_m2: 50, storeys: 1, form: 'gable', buildingId: 'b-shed' }),
    inputs: inputs({ material: 'colorbond_trimdek' }), // $95/m²
  }

  it('prices each structure with its OWN material — never sums areas onto one rate', () => {
    const q = priceMultiRoof({ structures: [house, shed] })
    const houseLine = q.structures.find((s) => s.buildingId === 'b-house')!
    const shedLine = q.structures.find((s) => s.buildingId === 'b-shed')!
    expect(houseLine.price.tiers[1].ex_gst).toBe(220 * 130) // 28,600
    expect(shedLine.price.tiers[1].ex_gst).toBe(50 * 95) // 4,750
  })

  it('combined better tier = sum of the per-structure better tiers', () => {
    const q = priceMultiRoof({ structures: [house, shed] })
    expect(q.combined.tiers[1].ex_gst).toBe(220 * 130 + 50 * 95) // 33,350
    expect(q.combined.area_m2).toBe(270) // 220 + 50
  })

  it('combined inc-GST is the linear sum of per-structure inc-GST', () => {
    const q = priceMultiRoof({ structures: [house, shed] })
    const expected = (220 * 130 + 50 * 95) * 1.1
    expect(q.combined.tiers[1].inc_gst).toBeCloseTo(expected, 1)
  })

  it('quotable primary + inspection-needed secondary → quote the primary, flag the secondary (whole job NOT inspected)', () => {
    const asbestosShed: RoofStructureInput = { ...shed, inputs: inputs({ material: 'cement_sheet' }) }
    const q = priceMultiRoof({ structures: [house, asbestosShed] })
    // The whole job is NOT blocked — we quote the main dwelling…
    expect(q.routing.decision).toBe('tradie_review')
    // …and flag the secondary that needs a look.
    expect(q.inspection_structures.length).toBe(1)
    // Combined reflects the QUOTABLE structures only (the house, 220 × 130).
    expect(q.combined.tiers[1].ex_gst).toBe(220 * 130)
    const houseLine = q.structures.find((s) => s.buildingId === 'b-house')!
    expect(houseLine.price.routing.decision).toBe('tradie_review')
  })

  it('PRIMARY needs inspection → whole job routes to inspection', () => {
    const asbestosHouse: RoofStructureInput = { ...house, inputs: inputs({ material: 'cement_sheet' }) }
    const q = priceMultiRoof({ structures: [asbestosHouse, shed] })
    expect(q.routing.decision).toBe('inspection_required')
  })

  it('nothing quotable → inspection', () => {
    const q = priceMultiRoof({
      structures: [
        { ...house, inputs: inputs({ material: 'cement_sheet' }) },
        { ...shed, inputs: inputs({ material: 'cement_sheet' }) },
      ],
    })
    expect(q.routing.decision).toBe('inspection_required')
  })

  it('multi-storey loading applies per structure, not across the whole job', () => {
    const twoStoreyHouse: RoofStructureInput = {
      ...house,
      metrics: metrics({ footprint_m2: 200, sloped_area_m2: 220, storeys: 2, buildingId: 'b-house' }),
      inputs: inputs({ material: 'colorbond_trimdek' }),
    }
    const q = priceMultiRoof({ structures: [twoStoreyHouse, shed] })
    const houseLine = q.structures.find((s) => s.buildingId === 'b-house')!
    const shedLine = q.structures.find((s) => s.buildingId === 'b-shed')!
    // House: 220 × 95 × 1.20 = 25,080 (loading applied)
    expect(houseLine.price.tiers[1].ex_gst).toBe(25_080)
    expect(houseLine.price.loadings_applied.map((l) => l.code)).toContain('multi_storey')
    // Shed: single-storey → no multi-storey loading, plain 50 × 95.
    expect(shedLine.price.tiers[1].ex_gst).toBe(4_750)
    expect(shedLine.price.loadings_applied).toEqual([])
  })

  it('all structures clean → tradie_review (roofing never auto-quotes)', () => {
    const q = priceMultiRoof({ structures: [house, shed] })
    expect(q.routing.decision).toBe('tradie_review')
    expect(q.inspection_structures).toEqual([])
  })

  it('derives default labels: primary = Main dwelling, secondaries numbered', () => {
    const shed2: RoofStructureInput = { ...shed, buildingId: 'b-shed-2' }
    const q = priceMultiRoof({ structures: [house, shed, shed2] })
    expect(q.structures[0].label).toBe('Main dwelling')
    expect(q.structures[1].label).toBe('Secondary structure 1')
    expect(q.structures[2].label).toBe('Secondary structure 2')
  })

  it('honours an explicit per-structure rate card', () => {
    const card = { ...DEFAULT_ROOFING_RATE_CARD, reroof_rate_per_m2: { ...DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2, colorbond_trimdek: 100 } }
    const q = priceMultiRoof({ structures: [shed], rateCard: card })
    expect(q.structures[0].price.tiers[1].ex_gst).toBe(50 * 100) // 5,000
  })
})

describe('roof-size ordering — Main dwelling is always the largest roof', () => {
  const mk = (footprint: number, sloped: number | null, buildingId: string): RoofStructureInput => ({
    buildingId,
    role: 'secondary',
    metrics: metrics({ footprint_m2: footprint, sloped_area_m2: sloped, buildingId }),
    inputs: inputs(),
  })

  describe('roofStructureSizeM2', () => {
    it('uses sloped area when present and positive', () => {
      expect(roofStructureSizeM2(metrics({ footprint_m2: 100, sloped_area_m2: 130 }))).toBe(130)
    })
    it('falls back to footprint when sloped area is null or non-positive', () => {
      expect(roofStructureSizeM2(metrics({ footprint_m2: 100, sloped_area_m2: null }))).toBe(100)
      expect(roofStructureSizeM2(metrics({ footprint_m2: 100, sloped_area_m2: 0 }))).toBe(100)
    })
    it('is 0 when neither measure is usable', () => {
      expect(roofStructureSizeM2(metrics({ footprint_m2: 0, sloped_area_m2: null }))).toBe(0)
    })
  })

  describe('roofSizeOrder', () => {
    it('returns indices largest roof first', () => {
      const s = [mk(70, 80, 'a'), mk(280, 300, 'b'), mk(140, 150, 'c')]
      expect(roofSizeOrder(s)).toEqual([1, 2, 0])
    })
    it('is stable on ties (equal sizes keep input order)', () => {
      const s = [mk(50, 50, 'a'), mk(200, 200, 'b'), mk(50, 50, 'c')]
      expect(roofSizeOrder(s)).toEqual([1, 0, 2])
    })
    it('does not mutate its input', () => {
      const s = [mk(70, 80, 'a'), mk(280, 300, 'b')]
      const before = s.map((x) => x.buildingId)
      roofSizeOrder(s)
      expect(s.map((x) => x.buildingId)).toEqual(before)
    })
  })

  describe('orderStructuresByRoofSize', () => {
    it('makes the biggest roof primary and the rest secondary, largest→smallest', () => {
      const ordered = orderStructuresByRoofSize([mk(70, 80, 'a'), mk(280, 300, 'b'), mk(140, 150, 'c')])
      expect(ordered.map((s) => s.buildingId)).toEqual(['b', 'c', 'a'])
      expect(ordered.map((s) => s.role)).toEqual(['primary', 'secondary', 'secondary'])
    })

    it('feeds priceMultiRoof so labels follow size: Main dwelling, Secondary 1, 2', () => {
      const q = priceMultiRoof({
        structures: orderStructuresByRoofSize([mk(70, 80, 'a'), mk(280, 300, 'b'), mk(140, 150, 'c')]),
      })
      expect(q.structures.map((s) => s.label)).toEqual([
        'Main dwelling',
        'Secondary structure 1',
        'Secondary structure 2',
      ])
      expect(q.structures.map((s) => s.buildingId)).toEqual(['b', 'c', 'a'])
    })
  })
})

describe('tier ordering invariant — combined multi-roof (tier-ordering-fix spec)', () => {
  it('combined terracotta dwelling + corrugated shed stays monotonic (Re-roof ≤ Upgrade)', () => {
    const terracottaHouse: RoofStructureInput = {
      buildingId: 'b-house',
      role: 'primary',
      metrics: metrics({ footprint_m2: 200, sloped_area_m2: 220, buildingId: 'b-house' }),
      inputs: inputs({ material: 'terracotta_tile' }),
    }
    const corrugatedShed: RoofStructureInput = {
      buildingId: 'b-shed',
      role: 'secondary',
      metrics: metrics({ footprint_m2: 45, sloped_area_m2: 50, form: 'gable', hips: 0, valleys: 0, buildingId: 'b-shed' }),
      inputs: inputs({ material: 'colorbond_corrugated' }),
    }
    const c = priceMultiRoof({ structures: [terracottaHouse, corrugatedShed] }).combined.tiers
    expect(c[0].ex_gst).toBeLessThanOrEqual(c[1].ex_gst)
    expect(c[1].ex_gst).toBeLessThanOrEqual(c[2].ex_gst)
    // Re-roof = terracotta 220×130 + corrugated 50×90 = 33,100
    expect(c[1].ex_gst).toBe(220 * 130 + 50 * 90)
    // Upgrade = terracotta backstop 220×130 + corrugated→Klip-Lok 50×115 = 34,350
    expect(c[2].ex_gst).toBe(220 * 130 + 50 * 115)
  })

  it('a rate-card overlay that lifts a material above its upgrade target stays monotonic', () => {
    // Spandek overlaid to $200/m² — above the Klip-Lok upgrade ($115). The
    // backstop must keep Upgrade ≥ Re-roof rather than inverting.
    const card = {
      ...DEFAULT_ROOFING_RATE_CARD,
      reroof_rate_per_m2: { ...DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2, colorbond_spandek: 200 },
    }
    const t = calculateRoofingPrice({
      metrics: metrics({ form: 'gable', hips: 0, valleys: 0 }),
      inputs: inputs({ material: 'colorbond_spandek' }),
      rateCard: card,
    }).tiers
    expect(t[1].ex_gst).toBe(220 * 200) // Re-roof at the overlaid rate
    expect(t[2].ex_gst).toBeGreaterThanOrEqual(t[1].ex_gst) // Upgrade not below
  })
})
