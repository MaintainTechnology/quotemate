import { describe, expect, it } from 'vitest'
import {
  buildPaintingOverlayFromInputs,
  effectivePaintingRateCardFromOverlay,
  mergePaintingRateCard,
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
