import { describe, expect, it } from 'vitest'
import { sizeAircon } from './sizing'
import { recommendAircon, DEFAULT_AC_RATE_CARD, mergeAcRateCard } from './recommend'
import type { AcPropertyInputs } from './types'

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
  return recommendAircon({ sizing, inputs: i })
}

describe('recommendAircon', () => {
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
})

describe('mergeAcRateCard', () => {
  it('returns the default when overlay is missing', () => {
    expect(mergeAcRateCard(null)).toEqual(DEFAULT_AC_RATE_CARD)
  })
  it('shallow-merges a ducted override', () => {
    const merged = mergeAcRateCard({ ducted: { rate_per_kw: 1300 } })
    expect(merged.ducted.rate_per_kw).toBe(1300)
    expect(merged.ducted.base_ex_gst).toBe(DEFAULT_AC_RATE_CARD.ducted.base_ex_gst)
  })
})
