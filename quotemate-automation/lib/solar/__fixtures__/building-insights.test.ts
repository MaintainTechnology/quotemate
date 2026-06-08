import { describe, it, expect } from 'vitest'
import {
  COVERED_INSIGHT,
  COVERED_RAW_BODY,
  COVERED_ROOF_FACTS,
  UNCOVERED_RAW_BODY,
  MANUAL_INPUT,
  SOLAR_CONFIG_FIXTURE,
  SMALL_PANEL_CONFIG,
  DEGENERATE_RAW_BODY,
  ZERO_AREA_RAW_BODY,
} from './building-insights'
import { parseBuildingInsights } from '../../roofing/solar-api'

describe('solar fixtures', () => {
  it('COVERED_INSIGHT is a parsed SolarRoofInsight with usable segments', () => {
    expect(COVERED_INSIGHT.segmentCount).toBeGreaterThan(0)
    expect(COVERED_INSIGHT.segments.length).toBe(COVERED_INSIGHT.segmentCount)
    expect(COVERED_INSIGHT.imageryQuality).toBe('HIGH')
    expect(COVERED_INSIGHT.totalSegmentAreaM2).toBeGreaterThan(0)
    expect(COVERED_INSIGHT.weightedMeanPitchDegrees).toBeGreaterThan(0)
  })

  it('COVERED_INSIGHT has the exact imagery metadata downstream tests depend on', () => {
    // These exact values are asserted here so that any drift in
    // COVERED_RAW_BODY or parseBuildingInsights surfaces immediately.
    expect(COVERED_INSIGHT.imageryDate).toBe('2024-03-12')
    expect(COVERED_INSIGHT.weightedMeanPitchDegrees).toBe(20)
    expect(COVERED_INSIGHT.totalSegmentAreaM2).toBe(120)
  })

  it('COVERED_RAW_BODY carries solarPanelConfigs + maxArrayPanelsCount + panelCapacityWatts', () => {
    const sp = (COVERED_RAW_BODY as Record<string, any>).solarPotential
    expect(Array.isArray(sp.solarPanelConfigs)).toBe(true)
    expect(sp.solarPanelConfigs.length).toBeGreaterThan(0)
    expect(sp.maxArrayPanelsCount).toBeGreaterThan(0)
    expect(sp.panelCapacityWatts).toBe(400)
  })

  it('COVERED_ROOF_FACTS is a well-formed SolarRoofFacts with correct hand-worked values', () => {
    expect(COVERED_ROOF_FACTS.source).toBe('google')
    expect(COVERED_ROOF_FACTS.usable_area_m2).toBe(120)
    expect(COVERED_ROOF_FACTS.segment_count).toBe(2)
    expect(COVERED_ROOF_FACTS.planes.length).toBe(2)
    expect(COVERED_ROOF_FACTS.primary_orientation).toBe('north')
    expect(COVERED_ROOF_FACTS.mean_pitch_degrees).toBe(20)
    expect(COVERED_ROOF_FACTS.max_panels_count).toBe(30)
    expect(COVERED_ROOF_FACTS.panel_capacity_watts).toBe(400)
    expect(COVERED_ROOF_FACTS.panel_configs).toEqual([
      { panels_count: 16, yearly_energy_dc_kwh: 9600 },
      { panels_count: 24, yearly_energy_dc_kwh: 14400 },
      { panels_count: 30, yearly_energy_dc_kwh: 18000 },
    ])
    expect(COVERED_ROOF_FACTS.imagery_quality).toBe('HIGH')
    expect(COVERED_ROOF_FACTS.imagery_date).toBe('2024-03-12')
  })

  it('UNCOVERED_RAW_BODY has no usable roof segments', () => {
    const sp = (UNCOVERED_RAW_BODY as Record<string, any>).solarPotential
    expect(sp === undefined || sp === null).toBe(true)
  })

  it('parseBuildingInsights returns null for UNCOVERED_RAW_BODY', () => {
    expect(parseBuildingInsights(UNCOVERED_RAW_BODY)).toBeNull()
  })

  it('MANUAL_INPUT is a north-facing medium single-storey declaration', () => {
    expect(MANUAL_INPUT.orientation).toBe('north')
    expect(MANUAL_INPUT.roof_size).toBe('medium')
    expect(MANUAL_INPUT.storeys).toBe(1)
  })

  it('SOLAR_CONFIG_FIXTURE is a complete SolarConfig consistent with COVERED_RAW_BODY', () => {
    // postcode 2000 must be in the zone_table
    expect(SOLAR_CONFIG_FIXTURE.zone_table['2000']).toBeDefined()
    // install_year 2026 must have a deeming entry
    expect(SOLAR_CONFIG_FIXTURE.deeming_schedule[2026]).toBeDefined()
    expect(typeof SOLAR_CONFIG_FIXTURE.stc_price_aud).toBe('number')
    expect(SOLAR_CONFIG_FIXTURE.stc_price_aud).toBeGreaterThan(0)
    expect(SOLAR_CONFIG_FIXTURE.derate_factor).toBeGreaterThan(0)
    expect(SOLAR_CONFIG_FIXTURE.derate_factor).toBeLessThanOrEqual(1)
    expect(typeof SOLAR_CONFIG_FIXTURE.feed_in.by_network).toBe('object')
  })

  // ── Pinned exact values ──────────────────────────────────────────────
  // These toBe assertions lock the hand-worked constants that downstream
  // pricing / production / economics tests derive their expected values from.
  // Any drift in these fixtures will surface here immediately.

  it('SOLAR_CONFIG_FIXTURE pins deeming_schedule[2026] === 5', () => {
    expect(SOLAR_CONFIG_FIXTURE.deeming_schedule[2026]).toBe(5)
  })

  it('SOLAR_CONFIG_FIXTURE pins zone_table["2000"] === 1.382', () => {
    expect(SOLAR_CONFIG_FIXTURE.zone_table['2000']).toBe(1.382)
  })

  it('SOLAR_CONFIG_FIXTURE pins stc_price_aud === 38', () => {
    expect(SOLAR_CONFIG_FIXTURE.stc_price_aud).toBe(38)
  })

  it('SOLAR_CONFIG_FIXTURE pins derate_factor === 0.80 (fixture real default)', () => {
    expect(SOLAR_CONFIG_FIXTURE.derate_factor).toBe(0.80)
  })

  it('SMALL_PANEL_CONFIG produces < 5 kW AC (non-export-limited path)', () => {
    // 10 panels × 400 W = 4 kW DC; 4 kW × 0.80 derate = 3.2 kW AC < 5 kW limit.
    // Use COVERED_ROOF_FACTS.panel_capacity_watts (400 W) rather than a literal
    // so that a panel-capacity model-year change is reflected here automatically.
    const kw_dc = (SMALL_PANEL_CONFIG.panels_count * COVERED_ROOF_FACTS.panel_capacity_watts) / 1000
    const kw_ac = kw_dc * 0.80
    expect(kw_dc).toBe(4)
    expect(kw_ac).toBeLessThan(5)
  })

  it('DEGENERATE_RAW_BODY parses successfully with a single north-facing segment', () => {
    const insight = parseBuildingInsights(DEGENERATE_RAW_BODY)
    expect(insight).not.toBeNull()
    if (insight) {
      expect(insight.segmentCount).toBe(1)
      expect(insight.segments[0].azimuthDegrees).toBe(0)
    }
  })

  it('parseBuildingInsights returns null for ZERO_AREA_RAW_BODY', () => {
    expect(parseBuildingInsights(ZERO_AREA_RAW_BODY)).toBeNull()
  })
})
