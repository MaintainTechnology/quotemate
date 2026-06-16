import { describe, it, expect } from 'vitest'
import { buildSolarPremiumQuote, solarPremiumQuoteEnabled } from './premium-quote'
import { DEFAULT_SOLAR_CONFIG } from './config'
import { STRING_OVERLAY_CAPTION } from './string-overlay'
import { makeFixtureEstimate as makeEstimate } from './__fixtures__/estimate'

describe('solarPremiumQuoteEnabled', () => {
  it("enabled only on 'true' or '1'", () => {
    expect(solarPremiumQuoteEnabled('true')).toBe(true)
    expect(solarPremiumQuoteEnabled('1')).toBe(true)
    expect(solarPremiumQuoteEnabled('false')).toBe(false)
    expect(solarPremiumQuoteEnabled('')).toBe(false)
    expect(solarPremiumQuoteEnabled(undefined)).toBe(false)
  })
})

describe('buildSolarPremiumQuote — phase + requested size rows', () => {
  it('shows the power supply and a clamped requested size', () => {
    const est = makeEstimate()
    est.context = { ...est.context, phase: 'three', requested_system_kw: 14 }
    est.sizing = { ...est.sizing, requested_kw_clamped: true }
    const premium = buildSolarPremiumQuote({
      estimate: est,
      config: DEFAULT_SOLAR_CONFIG,
      theme: 'dark',
    })
    const labels = premium.assumed_values.map((r) => r.label)
    expect(labels).toContain('Power supply')
    expect(
      premium.assumed_values.find((r) => r.label === 'Power supply')?.value,
    ).toBe('3-phase')
    const requested = premium.assumed_values.find((r) => r.label === 'Requested size')
    expect(requested?.value).toContain('capped')
  })

  it("defaults to 'Single-phase' and omits the size row when unset", () => {
    const premium = buildSolarPremiumQuote({
      estimate: makeEstimate(),
      config: DEFAULT_SOLAR_CONFIG,
      theme: 'dark',
    })
    expect(
      premium.assumed_values.find((r) => r.label === 'Power supply')?.value,
    ).toBe('Single-phase')
    expect(premium.assumed_values.some((r) => r.label === 'Requested size')).toBe(false)
  })
})

describe('buildSolarPremiumQuote — Pylon supplement rows', () => {
  it('renders the STC verification badge + zone facts when present', () => {
    const est = makeEstimate()
    est.context = {
      ...est.context,
      pylon_stc_check: {
        checked_at: '2026-06-13T00:00:00Z',
        verified: true,
        tiers: [],
        zone: '3',
        zone_rating: 1.382,
        deeming_period: 5,
      },
    }
    const premium = buildSolarPremiumQuote({
      estimate: est,
      config: DEFAULT_SOLAR_CONFIG,
      theme: 'dark',
    })
    const labels = premium.assumed_values.map((r) => r.label)
    expect(labels).toContain('STC count')
    expect(labels).toContain('STC zone')
    const zoneRow = premium.assumed_values.find((r) => r.label === 'STC zone')!
    expect(zoneRow.value).toBe('Zone 3 · rating 1.382 · 5-yr deeming')
  })

  it('omits the zone row when Pylon never answered', () => {
    const premium = buildSolarPremiumQuote({
      estimate: makeEstimate(),
      config: DEFAULT_SOLAR_CONFIG,
      theme: 'dark',
    })
    expect(premium.assumed_values.map((r) => r.label)).not.toContain('STC zone')
  })
})

describe('buildSolarPremiumQuote — google path', () => {
  const premium = buildSolarPremiumQuote({
    estimate: makeEstimate(),
    config: DEFAULT_SOLAR_CONFIG,
    theme: 'dark',
  })

  it('builds the layout overlay capped to the headline tier', () => {
    expect(premium.layout).not.toBeNull()
    expect(premium.layout!.panels_drawn).toBe(25)
    expect(premium.layout!.svg).toContain('<svg')
  })

  it('builds string runs with the mandatory caption', () => {
    expect(premium.strings).not.toBeNull()
    // 25 panels on one plane, cap 14 → strings of 14 + 11.
    expect(premium.strings!.strings.map((s) => s.panels_count)).toEqual([14, 11])
    expect(premium.strings!.caption).toBe(STRING_OVERLAY_CAPTION)
  })

  it('derives personal utility costs from the saved bill', () => {
    expect(premium.utility).not.toBeNull()
    expect(premium.utility!.source).toBe('personal')
    expect(premium.utility!.household_annual_kwh).toBe(6000)
  })

  it('builds all four charts', () => {
    expect(premium.charts.monthlyProduction).not.toBeNull()
    expect(premium.charts.utilityCosts).not.toBeNull()
    expect(premium.charts.monthlyBill).not.toBeNull()
    expect(premium.charts.cumulativeSavings).not.toBeNull()
  })

  it('financial summary covers the headline (better) tier', () => {
    expect(premium.financial).not.toBeNull()
    expect(premium.financial!.tier).toBe('better')
    expect(premium.financial!.npv_aud).toBeGreaterThan(0)
    expect(premium.financial!.total_roi_pct).toBeGreaterThan(100)
  })

  it('environmental impact from the carbon factor', () => {
    expect(premium.environmental).not.toBeNull()
    // 10125 kWh × 790 kg/MWh ≈ 8.0 t/yr
    expect(premium.environmental!.tonnes_co2_per_year).toBeCloseTo(8.0, 1)
  })

  it('assumed values carry the Pylon-style facts incl. config version', () => {
    const labels = premium.assumed_values.map((r) => r.label)
    expect(labels).toEqual(
      expect.arrayContaining([
        'DC array power',
        'Panel count',
        'Roof tilt',
        'Primary azimuth',
        'DC→AC derate',
        'Config version',
      ]),
    )
    expect(premium.assumed_values.find((r) => r.label === 'Config version')!.value).toBe(
      'solar-config-2026-06-08',
    )
  })
})

describe('buildSolarPremiumQuote — degradation matrix (§4.6)', () => {
  it('manual fallback (no geometry) → overlays null, page still renders', () => {
    const est = makeEstimate()
    est.coverage_source = 'manual'
    est.roof = {
      ...est.roof,
      source: 'manual',
      panels: [],
      panel_size_m: null,
      carbon_offset_factor_kg_per_mwh: null,
    }
    const premium = buildSolarPremiumQuote({
      estimate: est,
      config: DEFAULT_SOLAR_CONFIG,
      theme: 'light',
    })
    expect(premium.layout).toBeNull()
    expect(premium.strings).toBeNull()
    expect(premium.environmental).toBeNull()
    // Financial + charts still work (they need no geometry).
    expect(premium.financial).not.toBeNull()
    expect(premium.charts.monthlyProduction).not.toBeNull()
  })

  it('pre-premium estimate (panels undefined) → overlays null, no throw', () => {
    const est = makeEstimate()
    delete (est.roof as Record<string, unknown>).panels
    delete (est.roof as Record<string, unknown>).panel_size_m
    delete (est.roof as Record<string, unknown>).carbon_offset_factor_kg_per_mwh
    delete (est.context as Record<string, unknown>).quarterly_bill_aud
    const premium = buildSolarPremiumQuote({
      estimate: est,
      config: DEFAULT_SOLAR_CONFIG,
      theme: 'dark',
    })
    expect(premium.layout).toBeNull()
    expect(premium.strings).toBeNull()
    expect(premium.utility!.source).toBe('modelled')
  })

  it('no bill → modelled utility costs label', () => {
    const est = makeEstimate()
    est.context.quarterly_bill_aud = null
    const premium = buildSolarPremiumQuote({
      estimate: est,
      config: DEFAULT_SOLAR_CONFIG,
      theme: 'dark',
    })
    expect(premium.utility!.source).toBe('modelled')
    expect(premium.charts.utilityCosts!.caption).toContain('Modelled on typical usage')
  })

  it('inspection path (no tiers) → everything null, no throw', () => {
    const est = makeEstimate()
    est.sizing = { ...est.sizing, tiers: [] }
    est.production = []
    est.price = { ...est.price, tiers: [] }
    est.economics = { ...est.economics, tiers: [] }
    const premium = buildSolarPremiumQuote({
      estimate: est,
      config: DEFAULT_SOLAR_CONFIG,
      theme: 'dark',
    })
    expect(premium.financial).toBeNull()
    expect(premium.utility).toBeNull()
    expect(premium.charts.monthlyProduction).toBeNull()
    expect(premium.charts.cumulativeSavings).toBeNull()
  })

  it('no resolvable centre (no panels, no polygon, no location) → overlays null', () => {
    const est = makeEstimate()
    est.context.location = null
    est.roof = { ...est.roof, panels: [], polygon_geojson: null }
    const premium = buildSolarPremiumQuote({
      estimate: est,
      config: DEFAULT_SOLAR_CONFIG,
      theme: 'dark',
    })
    expect(premium.layout).toBeNull()
    expect(premium.strings).toBeNull()
  })
})
