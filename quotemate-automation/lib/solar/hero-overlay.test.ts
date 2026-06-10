// c:/Users/dalig/Downloads/QuoteMate/quoteMate/.claude/worktrees/solar-estimate/quotemate-automation/lib/solar/hero-overlay.test.ts
import { describe, expect, it } from 'vitest'
import { buildHeroOverlay, orientationLabel } from './hero-overlay'
import type { SolarRoofFacts, SolarSystemTier } from './types'

const headlineTier = {
  tier: 'better',
  label: 'Full-size system',
  system_kw_dc: 10,
  panels_count: 25,
  panel_type: 'standard_panels',
  source_config: { panels_count: 25, yearly_energy_dc_kwh: 14800 },
  export_limited: false,
} as unknown as SolarSystemTier

const googleRoof = {
  source: 'google',
  primary_orientation: 'north_east',
  imagery_date: '2025-03-14',
} as unknown as SolarRoofFacts

const manualRoof = {
  source: 'manual',
  primary_orientation: 'north',
  imagery_date: null,
} as unknown as SolarRoofFacts

describe('orientationLabel', () => {
  it('humanises compound directions', () => {
    expect(orientationLabel('north_east')).toBe('North-east')
  })
  it('humanises flat and unknown', () => {
    expect(orientationLabel('flat')).toBe('Flat')
    expect(orientationLabel('unknown')).toBe('To confirm')
  })
})

describe('buildHeroOverlay', () => {
  it('builds the four overlay stats from the headline tier + roof', () => {
    const overlay = buildHeroOverlay({
      headlineTier,
      roof: googleRoof,
      annualKwhAc: 11988,
    })
    expect(overlay.stats).toEqual([
      { label: 'System size', value: '10.0 kW' },
      { label: 'Panels', value: '25' },
      { label: 'Orientation', value: 'North-east' },
      { label: 'Yearly output', value: '11,988 kWh' },
    ])
  })

  it('captions a Google estimate with the imagery date', () => {
    const overlay = buildHeroOverlay({
      headlineTier,
      roof: googleRoof,
      annualKwhAc: 11988,
    })
    expect(overlay.caption).toBe(
      'Indicative layout based on Google aerial imagery, 14 Mar 2025.',
    )
  })

  it('omits the aerial caption for a manual-fallback estimate', () => {
    const overlay = buildHeroOverlay({
      headlineTier,
      roof: manualRoof,
      annualKwhAc: 9000,
    })
    expect(overlay.caption).toBe(
      'Indicative layout based on the roof details you provided.',
    )
  })

  it('captions a Google estimate without a date gracefully', () => {
    const overlay = buildHeroOverlay({
      headlineTier,
      roof: { ...googleRoof, imagery_date: null } as unknown as SolarRoofFacts,
      annualKwhAc: 11988,
    })
    expect(overlay.caption).toBe(
      'Indicative layout based on Google aerial imagery.',
    )
  })

  it('renders confirm placeholders when no tier was produced', () => {
    const overlay = buildHeroOverlay({
      headlineTier: null,
      roof: manualRoof,
      annualKwhAc: 0,
    })
    expect(overlay.stats).toEqual([
      { label: 'System size', value: 'To confirm' },
      { label: 'Panels', value: 'To confirm' },
      { label: 'Orientation', value: 'North' },
      { label: 'Yearly output', value: 'To confirm' },
    ])
  })
})
