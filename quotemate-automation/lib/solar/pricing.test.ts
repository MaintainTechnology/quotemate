import { describe, it, expect } from 'vitest'
import { calculateSolarPrice, DEFAULT_SOLAR_RATE_CARD } from './pricing'
import { DEFAULT_SOLAR_CONFIG } from './config'
import { normaliseSolarRoofFacts } from './roof'
import { sizeSolarSystem } from './sizing'
import { COVERED_INSIGHT, COVERED_RAW_BODY } from './__fixtures__/building-insights'
import type { SolarCoverageResult, SolarEstimateContext } from './types'

const COVERAGE = {
  covered: true,
  location: { lat: -33.8688, lng: 151.2093 },
  imagery_quality: 'HIGH',
  imagery_date: '2024-03-12',
} satisfies Extract<SolarCoverageResult, { covered: true }>

const CONTEXT: SolarEstimateContext = {
  postcode: '2000', // zone 1.382 in DEFAULT_SOLAR_CONFIG
  state: 'NSW',
  install_year: 2026, // deeming = 5
  network: 'Ausgrid',
}

const ROOF = normaliseSolarRoofFacts({ ...COVERED_INSIGHT, raw: COVERED_RAW_BODY }, COVERAGE)
const SIZING = sizeSolarSystem({
  roof: ROOF,
  panelType: 'standard_panels',
  config: DEFAULT_SOLAR_CONFIG,
  context: CONTEXT,
})

describe('calculateSolarPrice', () => {
  const price = calculateSolarPrice({
    sizing: SIZING,
    roof: ROOF,
    context: CONTEXT,
    config: DEFAULT_SOLAR_CONFIG,
  })

  it('returns one priced tier per sizing tier in good→best order', () => {
    expect(price.tiers.length).toBe(SIZING.tiers.length)
    expect(price.tiers[0].tier).toBe(SIZING.tiers[0].tier)
  })

  it('computes gross ex-GST = kW × $/kW (standard = $1100/kW)', () => {
    const t = price.tiers[0]
    const kw = SIZING.tiers[0].system_kw_dc
    expect(t.gross_ex_gst).toBe(Math.round(kw * 1100 * 100) / 100)
  })

  it('computes STC certificates = floor(kW × zone × deeming)', () => {
    const t = price.tiers[0]
    const kw = SIZING.tiers[0].system_kw_dc
    expect(t.stc.certificates).toBe(Math.floor(kw * 1.382 * 5))
    expect(t.stc.zone_rating).toBe(1.382)
    expect(t.stc.deeming_years).toBe(5)
  })

  it('computes the STC rebate = certificates × stc_price ($38)', () => {
    const t = price.tiers[0]
    expect(t.stc.stc_price_aud).toBe(38)
    expect(t.stc.rebate_aud).toBe(Math.round(t.stc.certificates * 38 * 100) / 100)
  })

  it('nets the rebate off the gross (net = gross − rebate)', () => {
    const t = price.tiers[0]
    expect(t.net_ex_gst).toBe(Math.round((t.gross_ex_gst - t.stc.rebate_aud) * 100) / 100)
  })

  it('applies GST factor 1.10 to both gross and net', () => {
    const t = price.tiers[0]
    expect(t.gross_inc_gst).toBe(Math.round(t.gross_ex_gst * 1.10 * 100) / 100)
    expect(t.net_inc_gst).toBe(Math.round(t.net_ex_gst * 1.10 * 100) / 100)
  })

  it('uses premium $/kW when the panel type is premium', () => {
    const premiumSizing = sizeSolarSystem({
      roof: ROOF,
      panelType: 'premium_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    const p = calculateSolarPrice({
      sizing: premiumSizing,
      roof: ROOF,
      context: CONTEXT,
      config: DEFAULT_SOLAR_CONFIG,
    })
    const kw = premiumSizing.tiers[0].system_kw_dc
    expect(p.tiers[0].gross_ex_gst).toBe(Math.round(kw * 1450 * 100) / 100)
  })

  it('stacks a multi-storey loading onto the effective $/kW', () => {
    const twoStorey = { ...ROOF, storeys: 2 }
    const p = calculateSolarPrice({
      sizing: SIZING,
      roof: twoStorey,
      context: CONTEXT,
      config: DEFAULT_SOLAR_CONFIG,
    })
    expect(p.loadings_applied.some((l) => l.code === 'multi_storey')).toBe(true)
    expect(p.effective_rate_per_kw).toBe(Math.round(1100 * 1.15 * 100) / 100)
  })

  it('raises a tiny system to the call-out floor and flags it', () => {
    const tinyRoof = { ...ROOF, max_panels_count: 4, panel_configs: [{ panels_count: 4, yearly_energy_dc_kwh: 2400 }] }
    const tinySizing = sizeSolarSystem({
      roof: tinyRoof,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    const p = calculateSolarPrice({
      sizing: tinySizing,
      roof: tinyRoof,
      context: CONTEXT,
      config: DEFAULT_SOLAR_CONFIG,
    })
    expect(p.call_out_minimum_applied).toBe(true)
    expect(p.tiers[0].gross_ex_gst).toBeGreaterThanOrEqual(DEFAULT_SOLAR_RATE_CARD.call_out_minimum_ex_gst!)
  })

  it('carries the sizing routing through unchanged (tradie_review)', () => {
    expect(price.routing.decision).toBe('tradie_review')
  })

  it('throws nothing on an unknown postcode but uses no zone (certificates 0)', () => {
    const offGrid: SolarEstimateContext = { ...CONTEXT, postcode: '9999' }
    const p = calculateSolarPrice({
      sizing: SIZING,
      roof: ROOF,
      context: offGrid,
      config: DEFAULT_SOLAR_CONFIG,
    })
    expect(p.tiers[0].stc.zone_rating).toBe(0)
    expect(p.tiers[0].stc.certificates).toBe(0)
    expect(p.tiers[0].net_ex_gst).toBe(p.tiers[0].gross_ex_gst)
  })
})
