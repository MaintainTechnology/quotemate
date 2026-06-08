import { describe, it, expect } from 'vitest'
import { sizeSolarSystem } from './sizing'
import { DEFAULT_SOLAR_CONFIG } from './config'
import { normaliseSolarRoofFacts } from './roof'
import { buildManualRoofFacts } from './manual-fallback'
import { COVERED_INSIGHT, COVERED_RAW_BODY } from './__fixtures__/building-insights'
import type { SolarCoverageResult, SolarEstimateContext } from './types'

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

describe('sizeSolarSystem', () => {
  const result = sizeSolarSystem({
    roof: ROOF,
    panelType: 'standard_panels',
    config: DEFAULT_SOLAR_CONFIG,
    context: CONTEXT,
  })

  it('returns 2–3 tiers in ascending kW order', () => {
    expect(result.tiers.length).toBeGreaterThanOrEqual(2)
    expect(result.tiers.length).toBeLessThanOrEqual(3)
    for (let i = 1; i < result.tiers.length; i++) {
      expect(result.tiers[i].system_kw_dc).toBeGreaterThan(result.tiers[i - 1].system_kw_dc)
    }
  })

  it('labels tiers good→best', () => {
    const tiers = result.tiers.map((t) => t.tier)
    expect(tiers[0]).toBe('good')
    expect(tiers[tiers.length - 1]).toBe('best')
  })

  it('derives kW DC from panels × panelCapacityWatts/1000', () => {
    const t = result.tiers[0]
    expect(t.system_kw_dc).toBe((t.panels_count * ROOF.panel_capacity_watts) / 1000)
  })

  it('never exceeds the roof capacity (30 panels × 400 W = 12 kW)', () => {
    expect(result.roof_capacity_kw_dc).toBe(12)
    for (const t of result.tiers) {
      expect(t.system_kw_dc).toBeLessThanOrEqual(result.roof_capacity_kw_dc)
    }
  })

  it('applies the 5 kW/phase export limit and flags export-limited tiers', () => {
    expect(result.export_limit_kw_ac).toBe(5)
    // With a 0.81 derate, 5 kW AC ≈ 6.17 kW DC ceiling; tiers above are flagged.
    const limited = result.tiers.filter((t) => t.export_limited)
    expect(limited.length).toBeGreaterThan(0)
  })

  it('routes to tradie_review (never auto_quote — high-ticket rule)', () => {
    expect(result.routing.decision).toBe('tradie_review')
  })

  it('carries the requested panel type onto every tier', () => {
    for (const t of result.tiers) expect(t.panel_type).toBe('standard_panels')
  })

  it('falls back to inspection_required when the roof holds no panels', () => {
    const emptyRoof = buildManualRoofFacts({ orientation: 'north', roof_size: 'small', storeys: 1 })
    const tiny = { ...emptyRoof, max_panels_count: 0, panel_configs: [] }
    const r = sizeSolarSystem({
      roof: tiny,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    expect(r.routing.decision).toBe('inspection_required')
    expect(r.tiers.length).toBe(0)
  })

  it('works off the single manual-fallback config (2 tiers minimum)', () => {
    const manual = buildManualRoofFacts({ orientation: 'north', roof_size: 'large', storeys: 1 })
    const r = sizeSolarSystem({
      roof: manual,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: CONTEXT,
    })
    expect(r.tiers.length).toBeGreaterThanOrEqual(2)
  })
})
