// Roofing pricing — deterministic. Every formula in pricing.ts needs
// one assertion per branch + sanity checks for the routing decider.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROOFING_RATE_CARD,
  applicableLoadings,
  calculateRoofingPrice,
  formLabel,
  requiresInspection,
  slopedAreaFromFootprint,
  __test_only__,
} from './pricing'
import type {
  RoofMetrics,
  RoofUserInputs,
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

  it('good-tier = better × 0.20 (patch scope)', () => {
    expect(result.tiers[0].ex_gst).toBeCloseTo(result.tiers[1].ex_gst * 0.20, 1)
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
