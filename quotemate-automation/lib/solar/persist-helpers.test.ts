import { describe, it, expect } from 'vitest'
import { buildSolarRowPayloads } from './persist-helpers'
import type { SolarEstimate } from './types'

// Minimal but contract-faithful SolarEstimate fixture.
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
      annual_kwh_low: 7400,
      annual_kwh_high: 11000,
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
    tiers: [
      {
        tier: 'better',
        self_consumed_kwh: 3680,
        exported_kwh: 5520,
        bill_savings_aud: 1104,
        export_earnings_aud: 331,
        annual_savings_aud: 1435,
        payback_years_low: 4.2,
        payback_years_high: 6.8,
      },
    ],
    assumptions: {
      self_consumption_pct: 0.4,
      retail_rate_aud_per_kwh: 0.3,
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

describe('buildSolarRowPayloads', () => {
  const out = buildSolarRowPayloads({
    estimate,
    tenantId: 'TENANT1',
    address: { address: '1 Test St, Sydney', postcode: '2000', state: 'NSW' },
    customer: { name: 'Mia', phone: '+61400000000', email: 'm@x.io' },
  })

  it('stamps the intake with trade=solar and tenant_id', () => {
    expect(out.intake.trade).toBe('solar')
    expect(out.intake.tenant_id).toBe('TENANT1')
    expect(out.intake.job_type).toBe('solar_install')
  })

  it('carries roof facts into intake.scope', () => {
    expect(out.intake.scope.usable_area_m2).toBe(60)
    expect(out.intake.scope.state).toBe('NSW')
  })

  it('sets inspection_required from routing', () => {
    expect(out.intake.inspection_required).toBe(false)
  })

  it('builds a solar_estimates row keyed by the estimate token', () => {
    expect(out.solarEstimate.public_token).toBe('TOKEN123')
    expect(out.solarEstimate.coverage_source).toBe('google')
    expect(out.solarEstimate.confidence_band).toBe('tight')
    expect(out.solarEstimate.config_version).toBe('2026-01-01')
    expect(out.solarEstimate.estimate.token).toBe('TOKEN123')
  })

  it('builds a quote row with the net price + share_token + needs_inspection', () => {
    expect(out.quote.share_token).toBe('TOKEN123')
    expect(out.quote.tenant_id).toBe('TENANT1')
    expect(out.quote.status).toBe('draft')
    expect(out.quote.needs_inspection).toBe(false)
    // Selected tier net ex/inc flow through.
    expect(out.quote.subtotal_ex_gst).toBe(7290)
    expect(out.quote.total_inc_gst).toBe(8019)
    expect(out.quote.routing_decision).toBe('tradie_review')
  })

  it('links intake and quote by leaving intake_id to the caller', () => {
    // intake_id is stamped by the route after the intake insert returns
    // an id; the helper must NOT invent one.
    expect('intake_id' in out.quote).toBe(false)
  })
})
