// Solar rate-card overlay — parse / merge / validate + the write/read
// symmetry guarantees (the Ricardos-class bug regression suite).

import { describe, expect, it } from 'vitest'
import { DEFAULT_SOLAR_RATE_CARD } from './pricing'
import {
  buildSolarOverlayFromInputs,
  depositPctFromOverlay,
  effectiveSolarRateCardFromOverlay,
  mergeSolarRateCard,
  parseSolarRateOverlay,
  stcPriceFromOverlay,
} from './rate-card-overlay'

describe('parseSolarRateOverlay', () => {
  it('accepts null / undefined / empty as an empty overlay', () => {
    expect(parseSolarRateOverlay(null)).toEqual({ ok: true, overlay: {} })
    expect(parseSolarRateOverlay(undefined)).toEqual({ ok: true, overlay: {} })
    expect(parseSolarRateOverlay({})).toEqual({ ok: true, overlay: {} })
  })

  it('rejects out-of-range values field-by-field', () => {
    const r = parseSolarRateOverlay({
      install_rate_per_kw: { standard_panels: 0 },
      multi_storey_loading_pct: 1.5,
      stc_price_aud: 100,
      deposit_pct: 90,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    const fields = r.issues.map((i) => i.field)
    expect(fields).toContain('install_rate_per_kw.standard_panels')
    expect(fields).toContain('multi_storey_loading_pct')
    expect(fields).toContain('stc_price_aud')
    expect(fields).toContain('deposit_pct')
  })
})

describe('mergeSolarRateCard', () => {
  it('overlay values replace defaults; missing keys keep defaults', () => {
    const card = effectiveSolarRateCardFromOverlay({
      install_rate_per_kw: { standard_panels: 1300 },
      multi_storey_loading_pct: 0.2,
      call_out_minimum_ex_gst: 0,
      gst_registered: false,
    })
    expect(card.install_rate_per_kw.standard_panels).toBe(1300)
    // Untouched keys stay at the defaults.
    expect(card.install_rate_per_kw.premium_panels).toBe(
      DEFAULT_SOLAR_RATE_CARD.install_rate_per_kw.premium_panels,
    )
    expect(card.complex_roof_loading_pct).toBe(DEFAULT_SOLAR_RATE_CARD.complex_roof_loading_pct)
    expect(card.multi_storey_loading_pct).toBe(0.2)
    expect(card.call_out_minimum_ex_gst).toBe(0) // 0 = no floor, meaningful
    expect(card.gst_registered).toBe(false)
  })

  it("the 'unknown' panel sentinel is never overridable", () => {
    const card = mergeSolarRateCard(DEFAULT_SOLAR_RATE_CARD, {
      install_rate_per_kw: { standard_panels: 1300, premium_panels: 1600 },
    })
    expect(card.install_rate_per_kw.unknown).toBe(0)
  })

  it('a malformed stored overlay falls back to pure defaults (never breaks a quote)', () => {
    const card = effectiveSolarRateCardFromOverlay({ install_rate_per_kw: 'garbage' })
    expect(card).toEqual(DEFAULT_SOLAR_RATE_CARD)
  })
})

describe('buildSolarOverlayFromInputs ↔ schema symmetry', () => {
  it('everything the write side accepts, the read side parses (no silent overlay discard)', () => {
    const built = buildSolarOverlayFromInputs({
      install_rate_per_kw: { standard_panels: '1250', premium_panels: 1600 },
      multi_storey_loading_pct: 0.18,
      complex_roof_loading_pct: '0.12',
      call_out_minimum_ex_gst: 4000,
      gst_registered: true,
      stc_price_aud: '40',
      deposit_pct: 25,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    // The exact object the PATCH stores must round-trip the read parser.
    const reparsed = parseSolarRateOverlay(JSON.parse(JSON.stringify(built.overlay)))
    expect(reparsed.ok).toBe(true)
    expect(built.overlay.install_rate_per_kw?.standard_panels).toBe(1250)
    expect(built.overlay.stc_price_aud).toBe(40)
    expect(built.overlay.deposit_pct).toBe(25)
  })

  it('blank fields store no keys — saving never injects values the tradie left blank', () => {
    const built = buildSolarOverlayFromInputs({
      install_rate_per_kw: { standard_panels: '', premium_panels: null },
      multi_storey_loading_pct: '',
      stc_price_aud: null,
      deposit_pct: '',
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(Object.keys(built.overlay)).toEqual([])
  })

  it('rejects out-of-range write values field-by-field', () => {
    const built = buildSolarOverlayFromInputs({
      install_rate_per_kw: { standard_panels: 9999 },
      deposit_pct: 80,
      stc_price_aud: 0,
    })
    expect(built.ok).toBe(false)
    if (built.ok) return
    const fields = built.issues.map((i) => i.field)
    expect(fields).toContain('install_rate_per_kw.standard_panels')
    expect(fields).toContain('deposit_pct')
    expect(fields).toContain('stc_price_aud')
  })
})

describe('overlay readers', () => {
  it('stcPriceFromOverlay / depositPctFromOverlay return null for absent values', () => {
    expect(stcPriceFromOverlay({})).toBeNull()
    expect(depositPctFromOverlay({})).toBeNull()
    expect(stcPriceFromOverlay({ stc_price_aud: 40 })).toBe(40)
    expect(depositPctFromOverlay({ deposit_pct: 25.4 })).toBe(25)
  })
})
