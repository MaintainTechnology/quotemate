import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAINTING_TAKEOFF_CARD,
  computePaintingTakeoff,
  packsForLitres,
} from './takeoff'
import { DEFAULT_PAINTING_RATE_CARD, calculatePaintingPrice } from './pricing'
import type {
  PaintMeasurement,
  PaintUserInputs,
  PaintingRateCard,
  PropertyFacts,
} from './types'

// ── Fixtures ────────────────────────────────────────────────────────

const FACTS: PropertyFacts = {
  floor_area_m2: 180,
  floor_area_source: 'footprint',
  footprint_m2: 180,
  storeys: 1,
  bedrooms: 3,
  bathrooms: 2,
  year_built: 1998,
  property_type: 'House',
  land_size_m2: 600,
  has_floor_plan: false,
  source: 'solar',
  capture_note: null,
}

const MEASUREMENT: PaintMeasurement = {
  floor_area_m2: 180,
  floor_area_low_m2: 160,
  floor_area_high_m2: 200,
  floor_area_source: 'footprint',
  ceiling_height_m: 2.4,
  storeys: 1,
  confidence: 'medium',
  surfaces: [
    { scope: 'walls', unit: 'm2', quantity: 380, quantity_low: 340, quantity_high: 420 },
    { scope: 'trim', unit: 'lm', quantity: 120, quantity_low: 110, quantity_high: 130 },
  ],
  notes: [],
}

const INPUTS: PaintUserInputs = {
  scopes: ['walls', 'trim'],
  coats: 2,
  condition: 'sound',
  ceiling_height: 'standard',
  colour_change: false,
}

function priceFor(inputs: PaintUserInputs, measurement = MEASUREMENT, rateCard = DEFAULT_PAINTING_RATE_CARD) {
  return calculatePaintingPrice({ facts: FACTS, inputs, measurement, rateCard })
}

function takeoffFor(
  inputs: PaintUserInputs,
  measurement = MEASUREMENT,
  rateCard: PaintingRateCard = DEFAULT_PAINTING_RATE_CARD,
) {
  return computePaintingTakeoff({
    measurement,
    inputs,
    price: priceFor(inputs, measurement, rateCard),
    rateCard,
  })
}

const tier = (t: ReturnType<typeof takeoffFor>, name: 'good' | 'better' | 'best') =>
  t.tiers.find((x) => x.tier === name)!

// ── Pack rounding ───────────────────────────────────────────────────

describe('packsForLitres', () => {
  it('fits an exact 15 L in one pack', () => {
    expect(packsForLitres(15)).toEqual([{ size_l: 15, count: 1 }])
  })
  it('adds a 1 L pack for a small remainder', () => {
    expect(packsForLitres(15.1)).toEqual([
      { size_l: 15, count: 1 },
      { size_l: 1, count: 1 },
    ])
  })
  it('rounds a mid remainder up to a 4 L pack', () => {
    expect(packsForLitres(3.2)).toEqual([{ size_l: 4, count: 1 }])
  })
  it('rounds a tiny job up to a single 1 L pack', () => {
    expect(packsForLitres(0.4)).toEqual([{ size_l: 1, count: 1 }])
  })
  it('covers the worked walls example: 47.5 L → 3×15 + 1×4', () => {
    expect(packsForLitres(47.5)).toEqual([
      { size_l: 15, count: 3 },
      { size_l: 4, count: 1 },
    ])
  })
  it('takes a 10 L pack for a remainder between 4 and 10', () => {
    expect(packsForLitres(5.3)).toEqual([{ size_l: 10, count: 1 }])
  })
  it('returns no packs for zero litres', () => {
    expect(packsForLitres(0)).toEqual([])
  })
  it('handles absurdly large litre counts in constant time (bad tenant coverage)', () => {
    const t0 = performance.now()
    const packs = packsForLitres(1_000_000_000)
    expect(performance.now() - t0).toBeLessThan(50)
    // ceil((1e9 − 10) ÷ 15) = 66,666,666 × 15 L = 999,999,990 L; the 10 L
    // remainder takes one 10 L pack.
    expect(packs).toEqual([
      { size_l: 15, count: 66666666 },
      { size_l: 10, count: 1 },
    ])
  })
})

// ── Litres per product ──────────────────────────────────────────────

describe('computePaintingTakeoff — materials', () => {
  it('computes wall paint litres, band, packs and cost (Better tier, worked example)', () => {
    const better = tier(takeoffFor(INPUTS), 'better')
    const walls = better.products.find((p) => p.product === 'wall_paint')!
    // 380 m² × 2 coats ÷ 16 m²/L = 47.5 L (42.5–52.5)
    expect(walls.litres).toBe(47.5)
    expect(walls.litres_low).toBe(42.5)
    expect(walls.litres_high).toBe(52.5)
    expect(walls.packs).toEqual([
      { size_l: 15, count: 3 },
      { size_l: 4, count: 1 },
    ])
    // 49 packed litres × $14/L
    expect(walls.cost_ex_gst).toBe(686)
  })

  it('converts trim lm through lm-per-litre coverage', () => {
    const better = tier(takeoffFor(INPUTS), 'better')
    const trim = better.products.find((p) => p.product === 'trim_enamel')!
    // 120 lm × 2 coats ÷ 45 lm/L = 5.33… → 5.3 L → 1×10 L pack → 10 L × $20
    expect(trim.litres).toBe(5.3)
    expect(trim.packs).toEqual([{ size_l: 10, count: 1 }])
    expect(trim.cost_ex_gst).toBe(200)
  })

  it('the Good tier is one coat', () => {
    const good = tier(takeoffFor(INPUTS), 'good')
    const walls = good.products.find((p) => p.product === 'wall_paint')!
    // 380 × 1 ÷ 16 = 23.75 → 23.8 L
    expect(walls.litres).toBe(23.8)
  })

  it("treats 'poor' as at-least-bare: primer included, labour never below minor", () => {
    // 'poor' routes to inspection but the takeoff still displays — as an
    // indicative FLOOR, not the cheapest-possible job.
    const poor = tier(takeoffFor({ ...INPUTS, condition: 'poor' }), 'better')
    const bare = tier(takeoffFor({ ...INPUTS, condition: 'bare' }), 'better')
    expect(poor.products.some((p) => p.product === 'primer_sealer')).toBe(true)
    expect(poor.labour_hours).toBe(bare.labour_hours)
  })

  it('adds primer only when the condition is bare', () => {
    const sound = tier(takeoffFor(INPUTS), 'better')
    expect(sound.products.some((p) => p.product === 'primer_sealer')).toBe(false)

    const bare = tier(takeoffFor({ ...INPUTS, condition: 'bare' }), 'better')
    const primer = bare.products.find((p) => p.product === 'primer_sealer')!
    // one coat over walls m² only (trim is lm): 380 ÷ 12 = 31.66… → 31.7 L
    expect(primer.litres).toBe(31.7)
  })

  it('Best pays the premium uplift on paint but not primer', () => {
    const t = takeoffFor({ ...INPUTS, condition: 'bare' })
    const better = tier(t, 'better')
    const best = tier(t, 'best')
    const paint = (x: typeof better) => x.products.find((p) => p.product === 'wall_paint')!
    const primer = (x: typeof better) => x.products.find((p) => p.product === 'primer_sealer')!
    expect(paint(best).cost_ex_gst).toBe(
      +(paint(better).cost_ex_gst * (1 + DEFAULT_PAINTING_TAKEOFF_CARD.premium_price_uplift_pct)).toFixed(2),
    )
    expect(primer(best).cost_ex_gst).toBe(primer(better).cost_ex_gst)
  })

  it('applies the sundries percentage to the product subtotal', () => {
    const better = tier(takeoffFor(INPUTS), 'better')
    const products = better.products.reduce((a, p) => a + p.cost_ex_gst, 0)
    expect(better.sundries_ex_gst).toBe(+(products * DEFAULT_PAINTING_TAKEOFF_CARD.sundries_pct).toFixed(2))
    expect(better.materials_ex_gst).toBe(+(products + better.sundries_ex_gst).toFixed(2))
  })
})

// ── Labour ──────────────────────────────────────────────────────────

describe('computePaintingTakeoff — labour', () => {
  it('derives hours from production rates and the tier coats multiplier', () => {
    const t = takeoffFor(INPUTS)
    // Better: walls 380÷3 + trim 120÷7, × coats 1.0 = 143.8 h
    expect(tier(t, 'better').labour_hours).toBe(143.8)
    // Good: × 0.7 coats multiplier = 100.7 h
    expect(tier(t, 'good').labour_hours).toBe(100.7)
    // Cost at the default $85/h
    expect(tier(t, 'better').labour_ex_gst).toBe(+(143.8 * 85).toFixed(2))
  })

  it('scales hours by condition and colour multipliers', () => {
    const plain = tier(takeoffFor(INPUTS), 'better').labour_hours
    const loaded = tier(
      takeoffFor({ ...INPUTS, condition: 'minor', colour_change: true }),
      'better',
    ).labour_hours
    expect(loaded).toBe(+(plain * 1.15 * 1.1).toFixed(1))
  })

  it('loads exterior hours for a double-storey job', () => {
    const m: PaintMeasurement = {
      ...MEASUREMENT,
      storeys: 2,
      surfaces: [{ scope: 'exterior', unit: 'm2', quantity: 200, quantity_low: 180, quantity_high: 220 }],
    }
    const t = takeoffFor({ ...INPUTS, scopes: ['exterior'] }, m)
    // 200÷2 m²/hr × 1.0 coats × 1.5 double-storey = 150 h
    expect(tier(t, 'better').labour_hours).toBe(150)
  })

  it('converts hours to crew-days with a minimum of one day', () => {
    const t = takeoffFor(INPUTS)
    const better = tier(t, 'better')
    expect(better.crew_size).toBe(DEFAULT_PAINTING_TAKEOFF_CARD.crew_size)
    // 143.8 h ÷ (2 × 7.6 h) = 9.46 → 10 days
    expect(better.days_on_site).toBe(10)

    const tiny: PaintMeasurement = {
      ...MEASUREMENT,
      surfaces: [{ scope: 'walls', unit: 'm2', quantity: 10, quantity_low: 9, quantity_high: 11 }],
    }
    expect(tier(takeoffFor(INPUTS, tiny), 'good').days_on_site).toBe(1)
  })
})

// ── Derivation notes ────────────────────────────────────────────────

describe('computePaintingTakeoff — derivation notes', () => {
  it('explains each paint line from its actual numbers', () => {
    const better = tier(takeoffFor(INPUTS), 'better')
    const walls = better.products.find((p) => p.product === 'wall_paint')!
    expect(walls.note).toBe('380 m² × 2 coats ÷ 16 m²/L = 47.5 L → packed 49 L × $14/L')
    const trim = better.products.find((p) => p.product === 'trim_enamel')!
    expect(trim.note).toBe('120 lm × 2 coats ÷ 45 lm/L = 5.3 L → packed 10 L × $20/L')
  })

  it('marks the Best-tier premium on the paint note', () => {
    const best = tier(takeoffFor(INPUTS), 'best')
    const walls = best.products.find((p) => p.product === 'wall_paint')!
    expect(walls.note).toBe(
      '380 m² × 2 coats ÷ 16 m²/L = 47.5 L → packed 49 L × $17.50/L (premium +25%)',
    )
  })

  it('explains the primer line for a bare substrate', () => {
    const bare = tier(takeoffFor({ ...INPUTS, condition: 'bare' }), 'better')
    const primer = bare.products.find((p) => p.product === 'primer_sealer')!
    expect(primer.note).toBe(
      'Bare substrate — 1 sealing coat: 380 m² ÷ 12 m²/L = 31.7 L → packed 34 L × $12/L',
    )
  })

  it('explains sundries, labour and margin', () => {
    const t = takeoffFor(INPUTS)
    const better = tier(t, 'better')
    expect(better.sundries_note).toBe('8% of product cost — filler, caulk, tape, drop sheets')
    expect(better.labour_note).toBe(
      'walls 380 m² ÷ 3 m²/hr + trim 120 lm ÷ 7 lm/hr × 1 (coats · prep · colour) = 143.8 h @ $85/hr · 2 painters × 7.6 h/day ≈ 10 days',
    )
    const price = priceFor(INPUTS)
    const ex = price.tiers[1].ex_gst
    expect(better.margin_note).toBe(
      `Better $${Math.round(ex).toLocaleString('en-AU')} ex GST − materials $${Math.round(better.materials_ex_gst).toLocaleString('en-AU')} − labour $${Math.round(better.labour_ex_gst).toLocaleString('en-AU')}`,
    )
  })

  it('notes the exterior access loading when it applies', () => {
    const m: PaintMeasurement = {
      ...MEASUREMENT,
      storeys: 2,
      surfaces: [{ scope: 'exterior', unit: 'm2', quantity: 200, quantity_low: 180, quantity_high: 220 }],
    }
    const better = tier(takeoffFor({ ...INPUTS, scopes: ['exterior'] }, m), 'better')
    expect(better.labour_note).toBe(
      'exterior 200 m² ÷ 2 m²/hr × 1 (coats · prep · colour) = 150 h @ $85/hr · 2 painters × 7.6 h/day ≈ 10 days · exterior +50% access',
    )
  })
})

// ── Margin + invariants ─────────────────────────────────────────────

describe('computePaintingTakeoff — margin and invariants', () => {
  it('margin is tier price minus materials minus labour', () => {
    const price = priceFor(INPUTS)
    const t = computePaintingTakeoff({
      measurement: MEASUREMENT,
      inputs: INPUTS,
      price,
      rateCard: DEFAULT_PAINTING_RATE_CARD,
    })
    const better = tier(t, 'better')
    const expected = +(price.tiers[1].ex_gst - better.materials_ex_gst - better.labour_ex_gst).toFixed(2)
    expect(better.margin_ex_gst).toBe(expected)
    expect(better.margin_pct).toBe(+(expected / price.tiers[1].ex_gst).toFixed(4))
  })

  it('is deterministic', () => {
    expect(takeoffFor(INPUTS)).toEqual(takeoffFor(INPUTS))
  })

  it('never changes the quoted price: calculatePaintingPrice ignores takeoff config', () => {
    const withTakeoff: PaintingRateCard = {
      ...DEFAULT_PAINTING_RATE_CARD,
      takeoff: { sundries_pct: 0.2, crew_size: 4, price_per_litre: { wall_paint: 30 } },
    }
    expect(priceFor(INPUTS, MEASUREMENT, withTakeoff)).toEqual(priceFor(INPUTS))
  })
})
