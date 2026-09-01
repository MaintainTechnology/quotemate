import { describe, expect, it } from 'vitest'
import { sizeAircon } from './sizing'
import {
  recommendAircon,
  recommendAirconUnpriced,
  parseTenantAcRateCard,
} from './recommend'
import type { AcPropertyInputs, AcRateCard } from './types'

const TEST_RATE_CARD: AcRateCard = {
  split: {
    per_head: { '2.5': 1100, '3.5': 1400, '5': 1900, '7': 2600, '8': 3000 },
    multi_head_discount_pct: 0.08,
  },
  ducted: { rate_per_kw: 1100, base_ex_gst: 4000, per_zone: 350, min_ex_gst: 8000 },
  gst_registered: true,
}

function inputs(overrides: Partial<AcPropertyInputs> = {}): AcPropertyInputs {
  return {
    bedrooms: 3,
    bathrooms: 2,
    living_spaces: 2,
    ceiling_height: 'standard',
    insulation: 'average',
    current_situation: 'replacing',
    floor_area_m2: 180,
    ...overrides,
  }
}

function recommend(overrides: Partial<AcPropertyInputs> = {}) {
  const i = inputs(overrides)
  const sizing = sizeAircon('temperate', i)
  return recommendAircon({ sizing, inputs: i, rateCard: TEST_RATE_CARD })
}

describe('recommendAircon', () => {
  it('marks a tenant-card recommendation as priced', () => {
    expect(recommend().pricing_status).toBe('priced')
  })
  it('always returns both options, ordered ducted then split', () => {
    const r = recommend()
    expect(r.options.map((o) => o.system_type)).toEqual(['ducted', 'split'])
  })

  it('always routes to a site assessment', () => {
    expect(recommend().routing.decision).toBe('book_assessment')
  })

  it('prefers ducted for a large multi-zone home', () => {
    const r = recommend({ bedrooms: 4, living_spaces: 2, floor_area_m2: 240 })
    const ducted = r.options.find((o) => o.system_type === 'ducted')!
    expect(ducted.best_fit).toBe(true)
  })

  it('prefers split for a small home', () => {
    const r = recommend({ bedrooms: 1, living_spaces: 1, floor_area_m2: 60 })
    const split = r.options.find((o) => o.system_type === 'split')!
    expect(split.best_fit).toBe(true)
  })

  it('marks exactly one option as best fit', () => {
    const r = recommend()
    expect(r.options.filter((o) => o.best_fit)).toHaveLength(1)
  })

  it('produces an inc-GST price range (low < high) for both options', () => {
    for (const o of recommend().options) {
      expect(o.price.low).toBeGreaterThan(0)
      expect(o.price.high).toBeGreaterThan(o.price.low)
    }
  })

  it('gives a raked-ceiling-specific assessment reason', () => {
    const r = recommend({ ceiling_height: 'raked' })
    expect(r.routing.reason.toLowerCase()).toContain('raked')
  })

  it('flags a budget below both options (small home, so load is not 3-phase)', () => {
    const r = recommend({ bedrooms: 1, living_spaces: 1, floor_area_m2: 60, budget: 500 })
    expect(r.routing.reason.toLowerCase()).toContain('budget')
  })

  it('prices a two-storey ducted install above the single-storey equivalent', () => {
    const one = recommend({ storeys: 1 })
    const two = recommend({ storeys: 2 })
    const ductedOne = one.options.find((o) => o.system_type === 'ducted')!
    const ductedTwo = two.options.find((o) => o.system_type === 'ducted')!
    expect(ductedTwo.pricing.point_estimate_ex_gst).toBeGreaterThan(
      ductedOne.pricing.point_estimate_ex_gst,
    )
    expect(
      ductedTwo.pricing.adjustments.some((a) => a.label.toLowerCase().includes('storey')),
    ).toBe(true)
  })

  it('routes 3+ level homes to an assessment with a duct-routing reason', () => {
    const r = recommend({ storeys: 3 })
    expect(r.routing.reason.toLowerCase()).toContain('level')
  })

  it('exposes a line-item price explanation for both options', () => {
    for (const o of recommend().options) {
      expect(o.pricing.components.length).toBeGreaterThan(0)
      expect(o.pricing.point_estimate_inc_gst).toBeGreaterThan(0)
      expect(o.pricing.formula.length).toBeGreaterThan(0)
    }
  })

  it('refuses to price a home with zero conditioned rooms', () => {
    const i = inputs({ bedrooms: 0, living_spaces: 0, floor_area_m2: null })
    const sizing = sizeAircon('temperate', i)
    expect(() =>
      recommendAircon({ sizing, inputs: i, rateCard: TEST_RATE_CARD }),
    ).toThrow(/positive conditioned load/i)
  })
})

describe('tenant aircon pricing authority', () => {
  const complete = {
    split: {
      per_head: { '2.5': 1200, '3.5': 1500, '5': 2000, '7': 2700, '8': 3200 },
      multi_head_discount_pct: 0.05,
    },
    ducted: { rate_per_kw: 1250, base_ex_gst: 4500, per_zone: 400, min_ex_gst: 8500 },
    gst_registered: false,
  }

  it('accepts only a complete finite tenant card and preserves GST state', () => {
    expect(parseTenantAcRateCard(complete)).toEqual(complete)
    expect(parseTenantAcRateCard({ ...complete, gst_registered: true })?.gst_registered).toBe(true)
  })

  it('uses the tenant GST state in deterministic point-price maths', () => {
    const i = inputs()
    const sizing = sizeAircon('temperate', i)
    const registered = recommendAircon({
      sizing,
      inputs: i,
      rateCard: { ...complete, gst_registered: true },
    })
    const unregistered = recommendAircon({
      sizing,
      inputs: i,
      rateCard: { ...complete, gst_registered: false },
    })
    expect(registered.options[0].pricing.point_estimate_inc_gst).toBeGreaterThan(
      registered.options[0].pricing.point_estimate_ex_gst,
    )
    expect(unregistered.options[0].pricing.point_estimate_inc_gst).toBe(
      unregistered.options[0].pricing.point_estimate_ex_gst,
    )
  })

  it('rejects absent, partial and malformed overlays instead of filling defaults', () => {
    expect(parseTenantAcRateCard(null)).toBeNull()
    expect(parseTenantAcRateCard({ ducted: { rate_per_kw: 1300 } })).toBeNull()
    expect(parseTenantAcRateCard({ ...complete, ducted: { ...complete.ducted, per_zone: Number.NaN } })).toBeNull()
  })

  it('returns sizing and assessment advice with no monetary options when unpriced', () => {
    const i = inputs()
    const sizing = sizeAircon('temperate', i)
    const result = recommendAirconUnpriced({ sizing, inputs: i })
    expect(result.pricing_status).toBe('tenant_pricing_required')
    expect('options' in result).toBe(false)
    expect(JSON.stringify(result)).not.toMatch(/point_estimate|rate_ex_gst|"price"/)
    expect(result.routing.decision).toBe('book_assessment')
  })
})
