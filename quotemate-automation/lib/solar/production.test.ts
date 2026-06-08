import { describe, it, expect } from 'vitest'
import { estimateSolarProduction } from './production'
import { DEFAULT_SOLAR_CONFIG } from './config'
import { normaliseSolarRoofFacts } from './roof'
import { COVERED_INSIGHT, COVERED_RAW_BODY } from './__fixtures__/building-insights'
import type {
  SolarCoverageResult,
  SolarEstimateContext,
  SolarSystemTier,
} from './types'

const COVERAGE = {
  covered: true,
  location: { lat: -33.8688, lng: 151.2093 },
  imagery_quality: 'HIGH',
  imagery_date: '2024-03-12',
} satisfies Extract<SolarCoverageResult, { covered: true }>

const CONTEXT: SolarEstimateContext = {
  postcode: '2000',
  state: 'NSW',
  install_year: 2026,
  network: 'Ausgrid',
}

const ROOF = normaliseSolarRoofFacts({ ...COVERED_INSIGHT, raw: COVERED_RAW_BODY }, COVERAGE)

// 16-panel config from the fixture: 16 × 400 / 1000 = 6.4 kW DC,
// yearly_energy_dc_kwh = 9600.
const TIER: SolarSystemTier = {
  tier: 'good',
  label: '6.4 kW starter system',
  system_kw_dc: 6.4,
  panels_count: 16,
  panel_type: 'standard_panels',
  source_config: { panels_count: 16, yearly_energy_dc_kwh: 9600 },
  export_limited: false,
}

describe('estimateSolarProduction', () => {
  const p = estimateSolarProduction({ tier: TIER, roof: ROOF, config: DEFAULT_SOLAR_CONFIG, context: CONTEXT })

  it('applies the configured DC→AC derate (0.81)', () => {
    expect(p.derate_applied).toBe(0.81)
  })

  it('derates the config DC energy to AC (9600 × 0.81 = 7776 kWh/yr)', () => {
    expect(p.annual_kwh_ac).toBe(7776)
  })

  it('reports the system kW DC on the result', () => {
    expect(p.system_kw_dc).toBe(6.4)
  })

  it('attaches a ±band around the point estimate', () => {
    expect(p.annual_kwh_low).toBeLessThan(p.annual_kwh_ac)
    expect(p.annual_kwh_high).toBeGreaterThan(p.annual_kwh_ac)
  })

  it('uses a tight ±20% band for HIGH imagery (covered google path)', () => {
    expect(p.band).toBe('tight')
    expect(p.annual_kwh_low).toBe(Math.round(7776 * 0.80))
    expect(p.annual_kwh_high).toBe(Math.round(7776 * 1.20))
  })

  it('carries the 0.5%/yr degradation fraction', () => {
    expect(p.degradation_pct_per_year).toBe(0.005)
  })

  it('cross-checks against the CEC benchmark and flags within ±35%', () => {
    // 7776 AC / 6.4 kW = 1215 kWh/kW/yr — within ±35% of an ~1382 Sydney benchmark.
    expect(p.cec_benchmark_kwh_per_kw).toBeGreaterThan(0)
    expect(p.within_cec_benchmark).toBe(true)
  })

  it('widens to a wide band on the manual path (no panel-config DC)', () => {
    const manualTier: SolarSystemTier = {
      ...TIER,
      source_config: { panels_count: 16, yearly_energy_dc_kwh: 8960 },
    }
    const manualRoof = { ...ROOF, source: 'manual' as const, imagery_quality: null }
    const mp = estimateSolarProduction({
      tier: manualTier,
      roof: manualRoof,
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    expect(mp.band).toBe('wide')
    expect(mp.annual_kwh_low).toBe(Math.round(mp.annual_kwh_ac * 0.70))
    expect(mp.annual_kwh_high).toBe(Math.round(mp.annual_kwh_ac * 1.30))
  })

  it('flags within_cec_benchmark=false for an absurd AC/kW yield', () => {
    const absurd: SolarSystemTier = {
      ...TIER,
      source_config: { panels_count: 16, yearly_energy_dc_kwh: 40000 },
    }
    const ap = estimateSolarProduction({ tier: absurd, roof: ROOF, config: DEFAULT_SOLAR_CONFIG, context: CONTEXT })
    expect(ap.within_cec_benchmark).toBe(false)
  })
})
