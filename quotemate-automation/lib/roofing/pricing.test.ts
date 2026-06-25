// Roofing pricing — deterministic. Every formula in pricing.ts needs
// one assertion per branch + sanity checks for the routing decider.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROOFING_RATE_CARD,
  applicableLoadings,
  calculateRoofingPrice,
  deriveEdgeWorks,
  formLabel,
  perEdgeLength,
  requiresInspection,
  slopedAreaFromFootprint,
  __test_only__,
} from './pricing'
import type {
  RoofMetrics,
  RoofUserInputs,
  RoofingPriceTier,
  RoofingRateCard,
} from './types'

function baseMetrics(overrides: Partial<RoofMetrics> = {}): RoofMetrics {
  return {
    footprint_m2: 200,
    sloped_area_m2: 220,
    storeys: 1,
    form: 'hip',
    hips: 4,
    valleys: 0,
    ridge_lm: null,
    polygon_geojson: null,
    capture_date: '2025-06-01',
    ...overrides,
  }
}

function baseInputs(overrides: Partial<RoofUserInputs> = {}): RoofUserInputs {
  return {
    material: 'colorbond_trimdek',
    pitch: 'standard',
    building_year_built: 2005,
    intent: 'full_reroof',
    ...overrides,
  }
}

describe('slopedAreaFromFootprint', () => {
  it('applies the standard 22.5° pitch correction (×1.10)', () => {
    expect(slopedAreaFromFootprint(200, 'standard')).toBe(220)
  })
  it('applies the shallow correction (×1.06)', () => {
    expect(slopedAreaFromFootprint(200, 'shallow')).toBe(212)
  })
  it('applies the steep correction (×1.18)', () => {
    expect(slopedAreaFromFootprint(200, 'steep')).toBe(236)
  })
  it('returns null when pitch is unknown or very_steep (routes to inspection)', () => {
    expect(slopedAreaFromFootprint(200, 'unknown')).toBeNull()
    expect(slopedAreaFromFootprint(200, 'very_steep')).toBeNull()
  })
  it('returns null on zero / negative footprint', () => {
    expect(slopedAreaFromFootprint(0, 'standard')).toBeNull()
    expect(slopedAreaFromFootprint(-5, 'standard')).toBeNull()
  })
})

describe('requiresInspection', () => {
  it('returns null for a happy single-storey Colorbond re-roof', () => {
    expect(requiresInspection({ metrics: baseMetrics(), inputs: baseInputs() })).toBeNull()
  })
  it('forces inspection when address is outside Geoscape coverage', () => {
    const r = requiresInspection({ metrics: baseMetrics(), inputs: baseInputs(), outsideCoverage: true })
    expect(r?.decision).toBe('inspection_required')
    expect(r?.reason).toMatch(/coverage/i)
  })
  it('forces inspection on cement_sheet (asbestos risk)', () => {
    const r = requiresInspection({ metrics: baseMetrics(), inputs: baseInputs({ material: 'cement_sheet' }) })
    expect(r?.decision).toBe('inspection_required')
    expect(r?.reason).toMatch(/asbestos/i)
  })
  it('forces inspection on pre-1990 full re-roof', () => {
    const r = requiresInspection({
      metrics: baseMetrics(),
      inputs: baseInputs({ building_year_built: 1985, intent: 'full_reroof' }),
    })
    expect(r?.decision).toBe('inspection_required')
    expect(r?.reason).toMatch(/1990/i)
  })
  it('does NOT force inspection on pre-1990 leak trace (no asbestos disturbance)', () => {
    expect(
      requiresInspection({
        metrics: baseMetrics(),
        inputs: baseInputs({ building_year_built: 1985, intent: 'leak_trace' }),
      }),
    ).toBeNull()
  })
  it('forces inspection on unknown pitch', () => {
    const r = requiresInspection({ metrics: baseMetrics(), inputs: baseInputs({ pitch: 'unknown' }) })
    expect(r?.decision).toBe('inspection_required')
    expect(r?.reason).toMatch(/pitch/i)
  })
  it('forces inspection on very_steep pitch (fall-protection variance)', () => {
    const r = requiresInspection({ metrics: baseMetrics(), inputs: baseInputs({ pitch: 'very_steep' }) })
    expect(r?.decision).toBe('inspection_required')
  })
  it('forces inspection on complex roof form', () => {
    const r = requiresInspection({ metrics: baseMetrics({ form: 'complex' }), inputs: baseInputs() })
    expect(r?.decision).toBe('inspection_required')
    expect(r?.reason).toMatch(/complex/i)
  })
  it('forces inspection when sloped_area cannot be determined', () => {
    const r = requiresInspection({ metrics: baseMetrics({ sloped_area_m2: null }), inputs: baseInputs() })
    expect(r?.decision).toBe('inspection_required')
  })
  it('forces inspection on 3-storey or taller', () => {
    const r = requiresInspection({ metrics: baseMetrics({ storeys: 3 }), inputs: baseInputs() })
    expect(r?.decision).toBe('inspection_required')
    expect(r?.reason).toMatch(/storeys/i)
  })
  it('does NOT force inspection on 2-storey (multi-storey loading applies via pricing)', () => {
    expect(
      requiresInspection({ metrics: baseMetrics({ storeys: 2 }), inputs: baseInputs() }),
    ).toBeNull()
  })
})

describe('applicableLoadings', () => {
  it('returns no loadings for a happy single-storey Colorbond job', () => {
    expect(applicableLoadings(baseMetrics(), baseInputs(), DEFAULT_ROOFING_RATE_CARD)).toEqual([])
  })
  it('adds multi_storey loading when storeys >= 2', () => {
    const out = applicableLoadings(baseMetrics({ storeys: 2 }), baseInputs(), DEFAULT_ROOFING_RATE_CARD)
    expect(out.map((l) => l.code)).toContain('multi_storey')
    expect(out.find((l) => l.code === 'multi_storey')?.pct).toBe(0.20)
  })
  it('adds asbestos loading when material is cement_sheet', () => {
    const out = applicableLoadings(
      baseMetrics(),
      baseInputs({ material: 'cement_sheet' }),
      DEFAULT_ROOFING_RATE_CARD,
    )
    expect(out.map((l) => l.code)).toContain('asbestos')
  })
  it('stacks both loadings when both apply', () => {
    const out = applicableLoadings(
      baseMetrics({ storeys: 2 }),
      baseInputs({ material: 'cement_sheet' }),
      DEFAULT_ROOFING_RATE_CARD,
    )
    expect(out.map((l) => l.code).sort()).toEqual(['asbestos', 'multi_storey'])
  })
})

describe('calculateRoofingPrice — happy path full re-roof', () => {
  const result = calculateRoofingPrice({ metrics: baseMetrics(), inputs: baseInputs() })

  it('uses the sloped area as the pricing input', () => {
    expect(result.area_m2).toBe(220)
  })

  it('returns the three tiers in good→better→best order', () => {
    expect(result.tiers.map((t) => t.tier)).toEqual(['good', 'better', 'best'])
  })

  it('better-tier = sloped_area × Colorbond Trimdek rate', () => {
    // 220 m² × $95 = $20,900 ex-GST
    expect(result.tiers[1].ex_gst).toBe(20_900)
  })

  it('inc-GST = ex-GST × 1.10 when gst_registered', () => {
    expect(result.tiers[1].inc_gst).toBe(22_990)
  })

  it('best-tier uses the upgrade material rate (Klip-Lok = $115/m²)', () => {
    // 220 × $115 = $25,300
    expect(result.tiers[2].ex_gst).toBe(25_300)
  })

  it('good-tier = better × 0.20 (patch scope) on a gable roof with no edge works', () => {
    // Isolate the scope-fraction relationship on a roof with no hips/valleys
    // so charged edge works on the good tier don't perturb the ratio.
    const gable = calculateRoofingPrice({
      metrics: baseMetrics({ form: 'gable', hips: 0, valleys: 0 }),
      inputs: baseInputs(),
    })
    expect(gable.tiers[0].ex_gst).toBeCloseTo(gable.tiers[1].ex_gst * 0.20, 1)
  })

  it('has no loadings applied for a single-storey Colorbond job', () => {
    expect(result.loadings_applied).toEqual([])
  })

  it('routes to tradie_review (NOT auto_quote) — roofing always needs sign-off', () => {
    expect(result.routing.decision).toBe('tradie_review')
  })
})

describe('calculateRoofingPrice — multi-storey loading', () => {
  it('applies the +20% multi-storey loading to the better tier', () => {
    const r = calculateRoofingPrice({
      metrics: baseMetrics({ storeys: 2 }),
      inputs: baseInputs(),
    })
    // 220 × 95 × 1.20 = $25,080
    expect(r.tiers[1].ex_gst).toBe(25_080)
    expect(r.loadings_applied.map((l) => l.code)).toContain('multi_storey')
  })
})

describe('calculateRoofingPrice — inspection routing', () => {
  it('routes cement_sheet to inspection_required', () => {
    const r = calculateRoofingPrice({
      metrics: baseMetrics(),
      inputs: baseInputs({ material: 'cement_sheet' }),
    })
    expect(r.routing.decision).toBe('inspection_required')
  })

  it('still emits indicative numbers even on inspection routing (for tradie context)', () => {
    const r = calculateRoofingPrice({
      metrics: baseMetrics({ form: 'complex', sloped_area_m2: null }),
      inputs: baseInputs(),
    })
    expect(r.routing.decision).toBe('inspection_required')
    expect(r.area_m2).toBeGreaterThan(0)
  })
})

describe('calculateRoofingPrice — non-GST tradie', () => {
  const card: RoofingRateCard = { ...DEFAULT_ROOFING_RATE_CARD, gst_registered: false }
  it('inc-GST equals ex-GST when not GST registered', () => {
    const r = calculateRoofingPrice({ metrics: baseMetrics(), inputs: baseInputs(), rateCard: card })
    expect(r.tiers[1].ex_gst).toBe(r.tiers[1].inc_gst)
  })
})

describe('calculateRoofingPrice — per-intent tier labels', () => {
  it('uses leak-trace specific labels when intent is leak_trace', () => {
    const r = calculateRoofingPrice({
      metrics: baseMetrics(),
      inputs: baseInputs({ intent: 'leak_trace' }),
    })
    expect(r.tiers[0].label).toMatch(/leak trace/i)
  })
  it('uses gutter-specific labels when intent is gutter_replace', () => {
    const r = calculateRoofingPrice({
      metrics: baseMetrics(),
      inputs: baseInputs({ intent: 'gutter_replace' }),
    })
    expect(r.tiers[1].label).toMatch(/gutter/i)
  })
})

describe('formLabel', () => {
  it('emits a human label per form', () => {
    expect(formLabel('gable')).toMatch(/gable/i)
    expect(formLabel('hip')).toMatch(/hip/i)
    expect(formLabel('complex')).toMatch(/complex|irregular/i)
  })
})

describe('roof types — Corrugated + Spandek COLORBOND (roof-types spec)', () => {
  it('defines the two new installed $/m² rates', () => {
    expect(DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.colorbond_corrugated).toBe(90)
    expect(DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.colorbond_spandek).toBe(105)
  })

  it('prices the Better tier on each new material at area × its rate', () => {
    // baseMetrics → sloped_area 220 m², single-storey standard pitch → no loadings.
    const corrugated = calculateRoofingPrice({
      metrics: baseMetrics(),
      inputs: baseInputs({ material: 'colorbond_corrugated' }),
    })
    const spandek = calculateRoofingPrice({
      metrics: baseMetrics(),
      inputs: baseInputs({ material: 'colorbond_spandek' }),
    })
    expect(corrugated.tiers[1].ex_gst).toBe(220 * 90)
    expect(spandek.tiers[1].ex_gst).toBe(220 * 105)
  })

  it('orders the metal profiles Corrugated < Trimdek < Spandek < Klip-Lok by Better-tier price', () => {
    const better = (material: RoofUserInputs['material']) =>
      calculateRoofingPrice({ metrics: baseMetrics(), inputs: baseInputs({ material }) }).tiers[1].ex_gst
    expect(better('colorbond_corrugated')).toBeLessThan(better('colorbond_trimdek'))
    expect(better('colorbond_trimdek')).toBeLessThan(better('colorbond_spandek'))
    expect(better('colorbond_spandek')).toBeLessThan(better('colorbond_kliplok'))
  })

  it('keeps Klip-Lok as the Best-tier upgrade material for a Corrugated job', () => {
    const q = calculateRoofingPrice({
      metrics: baseMetrics(),
      inputs: baseInputs({ material: 'colorbond_corrugated' }),
    })
    // Best uses upgrade_material (colorbond_kliplok, $115) → area × 115.
    expect(q.tiers[2].ex_gst).toBe(220 * 115)
  })
})

describe('tier ordering invariant — Patch ≤ Re-roof ≤ Upgrade (tier-ordering-fix spec)', () => {
  const PRICEABLE_MATERIALS: RoofUserInputs['material'][] = [
    'colorbond_corrugated',
    'colorbond_trimdek',
    'colorbond_spandek',
    'colorbond_kliplok',
    'concrete_tile',
    'terracotta_tile',
  ]

  it('keeps every priceable material monotonic good ≤ better ≤ best (ex + inc GST)', () => {
    for (const material of PRICEABLE_MATERIALS) {
      const t = calculateRoofingPrice({ metrics: baseMetrics(), inputs: baseInputs({ material }) }).tiers
      expect(t[0].ex_gst, `${material} good≤better`).toBeLessThanOrEqual(t[1].ex_gst)
      expect(t[1].ex_gst, `${material} better≤best`).toBeLessThanOrEqual(t[2].ex_gst)
      expect(t[0].inc_gst).toBeLessThanOrEqual(t[1].inc_gst)
      expect(t[1].inc_gst).toBeLessThanOrEqual(t[2].inc_gst)
    }
  })

  it('terracotta no longer inverts: Upgrade is not cheaper than Re-roof (the reported bug)', () => {
    // Existing terracotta rate ($130) exceeds the old fixed upgrade ($115).
    // Pre-fix this made Re-roof ($130) > Upgrade ($115). Now Upgrade
    // backstops to the dearer of the two, so it is never below Re-roof.
    const t = calculateRoofingPrice({
      metrics: baseMetrics(),
      inputs: baseInputs({ material: 'terracotta_tile' }),
    }).tiers
    expect(t[1].ex_gst).toBe(220 * 130) // Re-roof in terracotta
    expect(t[2].ex_gst).toBeGreaterThanOrEqual(t[1].ex_gst) // Upgrade ≥ Re-roof
  })

  it('concrete tile upgrades to terracotta — a genuinely dearer Best tier', () => {
    const t = calculateRoofingPrice({
      metrics: baseMetrics(),
      inputs: baseInputs({ material: 'concrete_tile' }),
    }).tiers
    expect(t[1].ex_gst).toBe(220 * 95) // Re-roof in concrete tile
    expect(t[2].ex_gst).toBe(220 * 130) // Upgrade to terracotta
  })

  it('resolves the upgrade ladder within material families', () => {
    const { upgradeMaterialFor } = __test_only__
    expect(upgradeMaterialFor('colorbond_corrugated', DEFAULT_ROOFING_RATE_CARD)).toBe('colorbond_kliplok')
    expect(upgradeMaterialFor('concrete_tile', DEFAULT_ROOFING_RATE_CARD)).toBe('terracotta_tile')
    // Top-of-family materials map to themselves (backstop keeps Best ≥ Better).
    expect(upgradeMaterialFor('terracotta_tile', DEFAULT_ROOFING_RATE_CARD)).toBe('terracotta_tile')
    expect(upgradeMaterialFor('colorbond_kliplok', DEFAULT_ROOFING_RATE_CARD)).toBe('colorbond_kliplok')
  })

  it('keeps honest copy when Upgrade is the same material (terracotta)', () => {
    const best = calculateRoofingPrice({
      metrics: baseMetrics(),
      inputs: baseInputs({ material: 'terracotta_tile' }),
    }).tiers[2]
    expect(best.label).toMatch(/premium grade/i)
    expect(best.label).not.toMatch(/upgrade material/i)
    // Scope must not claim a different "upgrade material".
    expect(best.scope).not.toMatch(/as a material upgrade/i)
    expect(best.scope).toMatch(/premium-grade terracotta/i)
  })

  it('keeps the genuine-upgrade copy when Upgrade is a different material (corrugated → Klip-Lok)', () => {
    const best = calculateRoofingPrice({
      metrics: baseMetrics(),
      inputs: baseInputs({ material: 'colorbond_corrugated' }),
    }).tiers[2]
    expect(best.label).toMatch(/upgrade material/i)
    expect(best.scope).toMatch(/klip-lok/i)
    expect(best.scope).toMatch(/as a material upgrade/i)
  })

  it('tripwire throws on a synthetically inverted (better > best) tier set', () => {
    const { assertTierMonotonic } = __test_only__
    const ordered = [
      { tier: 'good', ex_gst: 100 },
      { tier: 'better', ex_gst: 200 },
      { tier: 'best', ex_gst: 300 },
    ] as unknown as RoofingPriceTier[]
    const inverted = [
      { tier: 'good', ex_gst: 100 },
      { tier: 'better', ex_gst: 300 },
      { tier: 'best', ex_gst: 200 },
    ] as unknown as RoofingPriceTier[]
    expect(() => assertTierMonotonic(ordered, 'test')).not.toThrow()
    expect(() => assertTierMonotonic(inverted, 'test')).toThrow(/inversion/i)
  })
})

describe('perEdgeLength + deriveEdgeWorks — geometry derivation', () => {
  it('derives per-edge length from footprint + declared pitch (geometry source)', () => {
    // s=√200=14.14, /2=7.07, ×1/cos(22.5°)=×1.082 ≈ 7.7 m
    const { lengthM, source } = perEdgeLength(baseMetrics({ footprint_m2: 200 }), 'standard')
    expect(source).toBe('geometry')
    expect(lengthM).toBeCloseTo(7.7, 1)
  })

  it('prefers measured pitch_degrees over the declared bucket', () => {
    // 45° → factor 1/cos(45°)=1.414 → 7.07 × 1.414 ≈ 10.0 m
    const measured = perEdgeLength(baseMetrics({ footprint_m2: 200, pitch_degrees: 45 }), 'standard')
    expect(measured.lengthM).toBeCloseTo(10.0, 1)
  })

  it('clamps to the [3, 20] m range', () => {
    expect(perEdgeLength(baseMetrics({ footprint_m2: 10000 }), 'standard').lengthM).toBe(20)
    expect(perEdgeLength(baseMetrics({ footprint_m2: 4 }), 'shallow').lengthM).toBe(3)
  })

  it('falls back to the fixed average when footprint is unusable', () => {
    const { lengthM, source } = perEdgeLength(baseMetrics({ footprint_m2: 0 }), 'standard')
    expect(source).toBe('fallback')
    expect(lengthM).toBe(6.0)
  })

  it('falls back when the pitch has no representative angle (unknown)', () => {
    expect(perEdgeLength(baseMetrics({ footprint_m2: 200 }), 'unknown').source).toBe('fallback')
  })

  it('derives lm from counts; 0 → 0 lm, null → null lm (never fabricated)', () => {
    const hip = deriveEdgeWorks(baseMetrics({ footprint_m2: 200, hips: 4, valleys: 0 }), 'standard')
    expect(hip.hips_lm).toBeCloseTo(30.8, 1) // 4 × 7.7
    expect(hip.valleys_lm).toBe(0)
    const unknown = deriveEdgeWorks(baseMetrics({ hips: null, valleys: null }), 'standard')
    expect(unknown.hips_lm).toBeNull()
    expect(unknown.valleys_lm).toBeNull()
  })
})

describe('calculateRoofingPrice — edge works (hips/valleys)', () => {
  const { roundTo } = __test_only__
  const sumLineItems = (t: { line_items?: { total_ex_gst: number }[] }) =>
    roundTo((t.line_items ?? []).reduce((a, li) => a + li.total_ex_gst, 0), 2)

  it('charges hip repointing on the good tier of a full re-roof and adds it to ex_gst', () => {
    const r = calculateRoofingPrice({ metrics: baseMetrics({ hips: 4, valleys: 0 }), inputs: baseInputs() })
    const good = r.tiers[0]
    const hipLine = good.line_items?.find((li) => li.unit === 'lm')
    expect(hipLine).toBeDefined()
    expect(hipLine?.quantity).toBeCloseTo(30.8, 1)
    expect(hipLine?.total_ex_gst).toBeCloseTo(30.8 * 12, 1)
    // good = better×0.20 (4180) + hip cost
    expect(good.ex_gst).toBeCloseTo(4180 + 30.8 * 12, 1)
  })

  it('shows hip/valley lines at $0 (included) on full re-roof better/best, totals unchanged', () => {
    const r = calculateRoofingPrice({ metrics: baseMetrics({ hips: 4, valleys: 0 }), inputs: baseInputs() })
    const better = r.tiers[1]
    const hipLine = better.line_items?.find((li) => li.unit === 'lm')
    expect(hipLine).toBeDefined()
    expect(hipLine?.total_ex_gst).toBe(0)
    expect(hipLine?.description).toMatch(/included/i)
    expect(better.ex_gst).toBe(20_900) // unchanged from the no-edge-works baseline
  })

  it('charges edge works on ALL tiers for a repair intent', () => {
    const r = calculateRoofingPrice({
      metrics: baseMetrics({ hips: 4, valleys: 0 }),
      inputs: baseInputs({ intent: 'patch_repair' }),
    })
    for (const t of r.tiers) {
      const hipLine = t.line_items?.find((li) => li.unit === 'lm')
      expect(hipLine?.total_ex_gst).toBeGreaterThan(0)
    }
  })

  it('prices valley flashing at $45/lm where charged (gable_hip)', () => {
    const r = calculateRoofingPrice({
      metrics: baseMetrics({ form: 'gable_hip', hips: 2, valleys: 1 }),
      inputs: baseInputs({ intent: 'flashing_repair' }),
    })
    const valleyLine = r.tiers[0].line_items?.find((li) => /valley/i.test(li.description))
    expect(valleyLine).toBeDefined()
    expect(valleyLine?.unit_price_ex_gst).toBe(45)
  })

  it('keeps sum(line_items.total_ex_gst) === tier.ex_gst for every tier', () => {
    for (const intent of ['full_reroof', 'patch_repair'] as const) {
      const r = calculateRoofingPrice({
        metrics: baseMetrics({ form: 'gable_hip', hips: 2, valleys: 1 }),
        inputs: baseInputs({ intent }),
      })
      for (const t of r.tiers) {
        expect(sumLineItems(t)).toBe(t.ex_gst)
      }
    }
  })

  it('exposes edge_works with counts, lm and length_source', () => {
    const r = calculateRoofingPrice({ metrics: baseMetrics({ hips: 4, valleys: 0 }), inputs: baseInputs() })
    expect(r.edge_works?.hips_count).toBe(4)
    expect(r.edge_works?.hips_lm).toBeCloseTo(30.8, 1)
    expect(r.edge_works?.length_source).toBe('geometry')
  })

  it('does not fabricate edge works for unknown-form roofs (null counts)', () => {
    const r = calculateRoofingPrice({
      metrics: baseMetrics({ form: 'unknown', hips: null, valleys: null }),
      inputs: baseInputs(),
    })
    expect(r.edge_works?.hips_count).toBeNull()
    for (const t of r.tiers) {
      expect(t.line_items?.some((li) => li.unit === 'lm')).toBe(false)
    }
  })

  it('price_edge_works:false reproduces the pre-edge-works totals and a single line', () => {
    const card: RoofingRateCard = { ...DEFAULT_ROOFING_RATE_CARD, price_edge_works: false }
    const r = calculateRoofingPrice({
      metrics: baseMetrics({ hips: 4 }),
      inputs: baseInputs(),
      rateCard: card,
    })
    expect(r.tiers[0].ex_gst).toBeCloseTo(4180, 1) // good = better×0.20, no edge
    for (const t of r.tiers) expect(t.line_items).toHaveLength(1)
    expect(r.edge_works).toBeUndefined()
  })

  it('gable roof (no hips/valleys) produces a single line per tier', () => {
    const r = calculateRoofingPrice({
      metrics: baseMetrics({ form: 'gable', hips: 0, valleys: 0 }),
      inputs: baseInputs(),
    })
    for (const t of r.tiers) expect(t.line_items).toHaveLength(1)
  })
})

describe('roundTo helper', () => {
  it('rounds to N decimal places without surprises', () => {
    const { roundTo } = __test_only__
    // 1.005 is famously bad in IEEE 754 (100.4999…). We don't promise to
    // fix that here — the helper is for tier prices, not financial
    // rounding. Use inputs that don't hit the floating-point edge.
    expect(roundTo(1.236, 2)).toBe(1.24)
    expect(roundTo(1234.567, 1)).toBe(1234.6)
    expect(roundTo(0, 2)).toBe(0)
    // NaN / Infinity sanity — collapses to 0 rather than propagating.
    expect(roundTo(Number.NaN, 2)).toBe(0)
    expect(roundTo(Number.POSITIVE_INFINITY, 2)).toBe(0)
  })
})
