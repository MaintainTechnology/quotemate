import { describe, it, expect } from 'vitest'
import { buildSolarAssumptionsView } from './assumptions-view'
import type { SolarEstimate } from './types'

// Contract-faithful fixture (mirrors persist-helpers.test.ts).
const estimate: SolarEstimate = {
  token: 'TOKEN123',
  context: { postcode: '2000', state: 'NSW', install_year: 2026, network: 'Ausgrid' },
  coverage_source: 'google',
  roof: {
    source: 'google',
    usable_area_m2: 60,
    planes: [],
    segment_count: 2,
    primary_orientation: 'north',
    mean_pitch_degrees: 22,
    max_panels_count: 30,
    panel_capacity_watts: 400,
    panel_configs: [],
    storeys: 1,
    polygon_geojson: null,
    imagery_quality: 'HIGH',
    imagery_date: '2025-03-01',
  },
  sizing: {
    tiers: [
      {
        tier: 'better',
        label: 'Full-size system',
        system_kw_dc: 6.6,
        panels_count: 16,
        panel_type: 'standard_panels',
        source_config: { panels_count: 16, yearly_energy_dc_kwh: 9000 },
        export_limited: false,
      },
    ],
    roof_capacity_kw_dc: 12,
    export_limit_kw_ac: 5,
    routing: { decision: 'tradie_review', reason: 'Solar quote requires tradie sign-off.' },
  },
  production: [
    {
      system_kw_dc: 6.6,
      annual_kwh_ac: 9200,
      annual_kwh_low: 7360,
      annual_kwh_high: 11040,
      derate_applied: 0.81,
      degradation_pct_per_year: 0.005,
      cec_benchmark_kwh_per_kw: 1382,
      within_cec_benchmark: true,
      band: 'tight',
    },
  ],
  price: {
    tiers: [
      {
        tier: 'better',
        label: 'Full-size system',
        system_kw_dc: 6.6,
        gross_ex_gst: 9000,
        gross_inc_gst: 9900,
        stc: {
          system_kw: 6.6,
          zone_rating: 1.382,
          deeming_years: 5,
          certificates: 45,
          stc_price_aud: 38,
          rebate_aud: 1710,
        },
        net_ex_gst: 7290,
        net_inc_gst: 8019,
        scope: '6.6 kW solar install with standard panels.',
      },
    ],
    effective_rate_per_kw: 1500,
    loadings_applied: [],
    routing: { decision: 'tradie_review', reason: 'Solar quote requires tradie sign-off.' },
    call_out_minimum_applied: false,
  },
  economics: {
    tiers: [],
    assumptions: {
      self_consumption_pct: 0.4,
      retail_rate_aud_per_kwh: 0.32,
      feed_in_tariff_aud_per_kwh: 0.06,
      feed_in_network: 'Ausgrid',
    },
  },
  confidence_band: 'tight',
  satellite_image_url: null,
  routing: { decision: 'tradie_review', reason: 'Solar quote requires tradie sign-off.' },
  guardrail_flags: [],
  config_version: '2026-01-01',
}

describe('buildSolarAssumptionsView', () => {
  const view = buildSolarAssumptionsView(estimate)
  const byKey = Object.fromEntries(view.rows.map((r) => [r.key, r]))

  it('produces all seven rows when price + production exist', () => {
    expect(view.rows.map((r) => r.key)).toEqual([
      'self_consumption',
      'retail_rate',
      'feed_in_tariff',
      'stc_rebate',
      'derate',
      'degradation',
      'confidence_band',
    ])
  })

  it('every row carries value, source, meaning and sensitivity', () => {
    for (const row of view.rows) {
      expect(row.value.length).toBeGreaterThan(0)
      expect(row.source.length).toBeGreaterThan(0)
      expect(row.meaning.length).toBeGreaterThan(10)
      expect(row.sensitivity.length).toBeGreaterThan(10)
    }
  })

  it('self-consumption and retail rate come from economics assumptions', () => {
    expect(byKey.self_consumption.value).toBe('40%')
    expect(byKey.retail_rate.value).toBe('$0.32/kWh')
    expect(byKey.self_consumption.source).toContain('2026-01-01')
  })

  it('feed-in tariff names the resolved network', () => {
    expect(byKey.feed_in_tariff.value).toBe('$0.06/kWh')
    expect(byKey.feed_in_tariff.source).toContain('Ausgrid')
  })

  it('STC row recombines the persisted breakdown verbatim', () => {
    expect(byKey.stc_rebate.value).toContain('45 certificates')
    expect(byKey.stc_rebate.value).toContain('$38')
    expect(byKey.stc_rebate.value).toContain('1,710')
    expect(byKey.stc_rebate.source).toContain('1.382')
    expect(byKey.stc_rebate.source).toContain('2000')
    expect(byKey.stc_rebate.source).toContain('5 deeming years')
    expect(byKey.stc_rebate.meaning).toContain('6.6 kW')
  })

  it('derate and degradation come from the headline production entry', () => {
    expect(byKey.derate.value).toBe('× 0.81')
    expect(byKey.degradation.value).toBe('0.5% per year')
  })

  it('confidence band explains ±20% from HIGH imagery', () => {
    expect(byKey.confidence_band.value).toBe('±20%')
    expect(byKey.confidence_band.source).toContain('High-quality satellite')
    expect(byKey.confidence_band.meaning).toContain('7,360–11,040 kWh')
  })

  it('footnote names the config version', () => {
    expect(view.footnote).toContain('2026-01-01')
  })

  it('manual path: band row says ±30% and references provided details', () => {
    const manual: SolarEstimate = {
      ...estimate,
      coverage_source: 'manual',
      roof: { ...estimate.roof, source: 'manual', imagery_quality: null, imagery_date: null },
      production: [
        { ...estimate.production[0], band: 'wide', annual_kwh_low: 6440, annual_kwh_high: 11960 },
      ],
      confidence_band: 'wide',
    }
    const v = buildSolarAssumptionsView(manual)
    const band = v.rows.find((r) => r.key === 'confidence_band')!
    expect(band.value).toBe('±30%')
    expect(band.source).toContain('you provided')
  })

  it('missing price tiers → STC row omitted, no throw', () => {
    const noPrices: SolarEstimate = {
      ...estimate,
      price: { ...estimate.price, tiers: [] },
    }
    const v = buildSolarAssumptionsView(noPrices)
    expect(v.rows.some((r) => r.key === 'stc_rebate')).toBe(false)
    expect(v.rows.some((r) => r.key === 'self_consumption')).toBe(true)
  })

  it('missing production → derate/degradation/band rows omitted, no throw', () => {
    const noProd: SolarEstimate = { ...estimate, production: [] }
    const v = buildSolarAssumptionsView(noProd)
    expect(v.rows.map((r) => r.key)).toEqual([
      'self_consumption',
      'retail_rate',
      'feed_in_tariff',
      'stc_rebate',
    ])
  })
})
