import { describe, expect, it } from 'vitest'
import {
  buildPaintingOverlayFromInputs,
  effectivePaintingRateCardFromOverlay,
  mergePaintingRateCard,
  paintingDepositPctFromCard,
  parsePaintingRateOverlay,
} from './rate-card-overlay'
import { DEFAULT_PAINTING_RATE_CARD } from './pricing'

describe('mergePaintingRateCard', () => {
  it('replaces supplied keys and keeps defaults for the rest', () => {
    const card = mergePaintingRateCard(DEFAULT_PAINTING_RATE_CARD, {
      rate_per_unit: { walls: 30 },
      good_refresh_fraction: 0.8,
      gst_registered: false,
    })
    expect(card.rate_per_unit.walls).toBe(30)
    expect(card.rate_per_unit.ceilings).toBe(DEFAULT_PAINTING_RATE_CARD.rate_per_unit.ceilings)
    expect(card.good_refresh_fraction).toBe(0.8)
    expect(card.gst_registered).toBe(false)
    expect(card.premium_uplift_pct).toBe(DEFAULT_PAINTING_RATE_CARD.premium_uplift_pct)
  })

  it('returns the base when overlay is null', () => {
    expect(mergePaintingRateCard(DEFAULT_PAINTING_RATE_CARD, null)).toBe(DEFAULT_PAINTING_RATE_CARD)
  })
})

describe('effectivePaintingRateCardFromOverlay', () => {
  it('falls back to the default on null / unparseable input', () => {
    expect(effectivePaintingRateCardFromOverlay(null)).toEqual(DEFAULT_PAINTING_RATE_CARD)
    expect(effectivePaintingRateCardFromOverlay('nope')).toEqual(DEFAULT_PAINTING_RATE_CARD)
  })

  it('applies a stored overlay', () => {
    const card = effectivePaintingRateCardFromOverlay({ rate_per_unit: { exterior: 60 }, double_storey_loading_pct: 0.6 })
    expect(card.rate_per_unit.exterior).toBe(60)
    expect(card.double_storey_loading_pct).toBe(0.6)
  })
})

describe('parsePaintingRateOverlay', () => {
  it('rejects an out-of-range rate', () => {
    const r = parsePaintingRateOverlay({ rate_per_unit: { walls: 9999 } })
    expect(r.ok).toBe(false)
  })
  it('accepts an empty object', () => {
    const r = parsePaintingRateOverlay({})
    expect(r.ok).toBe(true)
  })
})

describe('buildPaintingOverlayFromInputs', () => {
  it('drops blanks, coerces strings, and keeps valid values', () => {
    const r = buildPaintingOverlayFromInputs({
      rate_per_unit: { walls: '30', ceilings: '' },
      good_refresh_fraction: 0.8,
      double_storey_loading_pct: '',
      call_out_minimum_ex_gst: '500',
      gst_registered: false,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.overlay.rate_per_unit).toEqual({ walls: 30 })
      expect(r.overlay.good_refresh_fraction).toBe(0.8)
      expect(r.overlay.double_storey_loading_pct).toBeUndefined()
      expect(r.overlay.call_out_minimum_ex_gst).toBe(500)
      expect(r.overlay.gst_registered).toBe(false)
    }
  })

  it('collects validation issues for bad numbers', () => {
    const r = buildPaintingOverlayFromInputs({ rate_per_unit: { walls: '-5' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0].field).toBe('rate_per_unit.walls')
  })

  it('rejects a good-tier fraction over 100%', () => {
    const r = buildPaintingOverlayFromInputs({ good_refresh_fraction: 1.5 })
    expect(r.ok).toBe(false)
  })
})

describe('hourly pricing model', () => {
  it('parses + accepts a pricing_model / hourly_rate / production overlay', () => {
    const r = parsePaintingRateOverlay({
      pricing_model: 'hourly',
      hourly_rate: 90,
      production_rate_per_unit: { walls: 3, exterior: 2 },
    })
    expect(r.ok).toBe(true)
  })

  it('rejects an out-of-range hourly rate', () => {
    expect(parsePaintingRateOverlay({ hourly_rate: 99999 }).ok).toBe(false)
    expect(parsePaintingRateOverlay({ hourly_rate: -1 }).ok).toBe(false)
  })

  it('merges the hourly model onto the default card', () => {
    const card = mergePaintingRateCard(DEFAULT_PAINTING_RATE_CARD, {
      pricing_model: 'hourly',
      hourly_rate: 95,
      production_rate_per_unit: { walls: 5 },
    })
    expect(card.pricing_model).toBe('hourly')
    expect(card.hourly_rate).toBe(95)
    expect(card.production_rate_per_unit?.walls).toBe(5)
    // Unsupplied production scopes fall back to the default card's values.
    expect(card.production_rate_per_unit?.ceilings).toBe(
      DEFAULT_PAINTING_RATE_CARD.production_rate_per_unit?.ceilings,
    )
  })

  it('round-trips an hourly overlay through effectivePaintingRateCardFromOverlay', () => {
    const card = effectivePaintingRateCardFromOverlay({ pricing_model: 'hourly', hourly_rate: 120 })
    expect(card.pricing_model).toBe('hourly')
    expect(card.hourly_rate).toBe(120)
  })

  it('builds an overlay from onboarding-style inputs (model + hourly rate)', () => {
    const r = buildPaintingOverlayFromInputs({ pricing_model: 'hourly', hourly_rate: '110' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.overlay.pricing_model).toBe('hourly')
      expect(r.overlay.hourly_rate).toBe(110)
    }
  })

  it('rejects an invalid pricing_model and a non-positive hourly rate', () => {
    expect(buildPaintingOverlayFromInputs({ pricing_model: 'weekly' as never }).ok).toBe(false)
    expect(buildPaintingOverlayFromInputs({ hourly_rate: '0' }).ok).toBe(false)
  })

  it('omits the hourly rate when left blank (falls back to default at quote time)', () => {
    const r = buildPaintingOverlayFromInputs({ pricing_model: 'sqm', hourly_rate: '' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.overlay.pricing_model).toBe('sqm')
      expect(r.overlay.hourly_rate).toBeUndefined()
    }
  })
})

describe('takeoff card (materials + labour knobs)', () => {
  it('parses and round-trips a takeoff overlay', () => {
    const r = parsePaintingRateOverlay({
      takeoff: {
        sundries_pct: 0.1,
        crew_size: 3,
        price_per_litre: { wall_paint: 18 },
        coverage_per_litre: { exterior_paint: 12 },
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.overlay.takeoff?.sundries_pct).toBe(0.1)
      expect(r.overlay.takeoff?.crew_size).toBe(3)
      expect(r.overlay.takeoff?.price_per_litre?.wall_paint).toBe(18)
    }
  })

  it('rejects out-of-range takeoff values', () => {
    expect(parsePaintingRateOverlay({ takeoff: { sundries_pct: 0.6 } }).ok).toBe(false)
    expect(parsePaintingRateOverlay({ takeoff: { crew_size: 0 } }).ok).toBe(false)
    expect(parsePaintingRateOverlay({ takeoff: { hours_per_day: 20 } }).ok).toBe(false)
    expect(parsePaintingRateOverlay({ takeoff: { coverage_per_litre: { wall_paint: -1 } } }).ok).toBe(false)
  })

  it('merges takeoff knobs onto the default card, record-wise', () => {
    const card = mergePaintingRateCard(DEFAULT_PAINTING_RATE_CARD, {
      takeoff: { crew_size: 3, price_per_litre: { trim_enamel: 25 } },
    })
    expect(card.takeoff?.crew_size).toBe(3)
    expect(card.takeoff?.price_per_litre?.trim_enamel).toBe(25)
    // untouched knobs fall back at compute time — the merged card only
    // carries what the tenant set
    expect(card.takeoff?.sundries_pct).toBeUndefined()
  })

  it('builds a takeoff overlay from editor inputs, coercing strings and dropping blanks', () => {
    const r = buildPaintingOverlayFromInputs({
      takeoff: {
        sundries_pct: '0.12',
        crew_size: '3',
        hours_per_day: '',
        price_per_litre: { wall_paint: '16', ceiling_paint: '' },
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.overlay.takeoff?.sundries_pct).toBe(0.12)
      expect(r.overlay.takeoff?.crew_size).toBe(3)
      expect(r.overlay.takeoff?.hours_per_day).toBeUndefined()
      expect(r.overlay.takeoff?.price_per_litre?.wall_paint).toBe(16)
      expect(r.overlay.takeoff?.price_per_litre?.ceiling_paint).toBeUndefined()
    }
  })

  it('collects issues for bad takeoff editor inputs', () => {
    const r = buildPaintingOverlayFromInputs({
      takeoff: { crew_size: 'lots', sundries_pct: '0.9' },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issues.map((i) => i.field)).toEqual(
        expect.arrayContaining(['takeoff.crew_size', 'takeoff.sundries_pct']),
      )
    }
  })
})

describe('coats / condition multipliers + deposit (new tenant levers)', () => {
  it('accepts, validates and merges onto the numeric-keyed card', () => {
    const built = buildPaintingOverlayFromInputs({
      coats_multiplier: { '1': '0.75', '3': 1.5 },
      condition_multiplier: { bare: 1.6 },
      deposit_pct: '20',
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.overlay.coats_multiplier).toEqual({ '1': 0.75, '3': 1.5 })
    expect(built.overlay.deposit_pct).toBe(20)

    const card = mergePaintingRateCard(DEFAULT_PAINTING_RATE_CARD, built.overlay)
    expect(card.coats_multiplier[1]).toBe(0.75)
    expect(card.coats_multiplier[2]).toBe(DEFAULT_PAINTING_RATE_CARD.coats_multiplier[2]) // untouched
    expect(card.coats_multiplier[3]).toBe(1.5)
    expect(card.condition_multiplier.bare).toBe(1.6)
    expect(card.condition_multiplier.sound).toBe(DEFAULT_PAINTING_RATE_CARD.condition_multiplier.sound)
    expect(paintingDepositPctFromCard(card)).toBe(20)
  })

  it('rejects out-of-range multipliers and deposit field-by-field', () => {
    const built = buildPaintingOverlayFromInputs({
      coats_multiplier: { '2': 5 },
      condition_multiplier: { sound: 0 },
      deposit_pct: 80,
    })
    expect(built.ok).toBe(false)
    if (built.ok) return
    const fields = built.issues.map((i) => i.field)
    expect(fields).toContain('coats_multiplier.2')
    expect(fields).toContain('condition_multiplier.sound')
    expect(fields).toContain('deposit_pct')
  })

  it('write→read symmetry: the stored overlay round-trips the zod parser', () => {
    const built = buildPaintingOverlayFromInputs({
      coats_multiplier: { '1': 0.8, '2': 1.05, '3': 1.4 },
      condition_multiplier: { sound: 1, minor: 1.2, bare: 1.5 },
      deposit_pct: 15,
      pricing_model: 'hourly',
      hourly_rate: 95,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const reparsed = parsePaintingRateOverlay(JSON.parse(JSON.stringify(built.overlay)))
    expect(reparsed.ok).toBe(true)
  })

  it('old stored overlays (no new keys) keep their values; new levers default', () => {
    // Shape a pre-existing tenant overlay would have — none of the new keys.
    const card = effectivePaintingRateCardFromOverlay({
      rate_per_unit: { walls: 32 },
      gst_registered: true,
    })
    expect(card.rate_per_unit.walls).toBe(32)
    expect(card.coats_multiplier).toEqual(DEFAULT_PAINTING_RATE_CARD.coats_multiplier)
    expect(card.condition_multiplier).toEqual(DEFAULT_PAINTING_RATE_CARD.condition_multiplier)
    expect(paintingDepositPctFromCard(card)).toBeNull() // → platform default 30
  })

  it('takeoff hours_per_day + premium uplift round-trip (silent-wipe regression)', () => {
    // The editor previously omitted these two from its save body, so a save
    // replaced the stored takeoff object without them — wiping saved values.
    const built = buildPaintingOverlayFromInputs({
      takeoff: { hours_per_day: 8, premium_price_uplift_pct: 0.3, crew_size: 3 },
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.overlay.takeoff?.hours_per_day).toBe(8)
    expect(built.overlay.takeoff?.premium_price_uplift_pct).toBe(0.3)
  })
})
