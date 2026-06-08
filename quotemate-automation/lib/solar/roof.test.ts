import { describe, it, expect } from 'vitest'
import { normaliseSolarRoofFacts, __test_only__ } from './roof'
import { COVERED_INSIGHT, COVERED_RAW_BODY } from './__fixtures__/building-insights'
import { parseBuildingInsights } from '../roofing/solar-api'
import type { SolarCoverageResult } from './types'

const { azimuthToOrientation } = __test_only__

const COVERAGE = {
  covered: true,
  location: { lat: -33.8688, lng: 151.2093 },
  imagery_quality: 'HIGH',
  imagery_date: '2024-03-12',
} satisfies Extract<SolarCoverageResult, { covered: true }>

describe('normaliseSolarRoofFacts', () => {
  const facts = normaliseSolarRoofFacts(
    { ...COVERED_INSIGHT, raw: COVERED_RAW_BODY },
    COVERAGE,
  )

  it('tags the source as google', () => {
    expect(facts.source).toBe('google')
  })

  it('carries usable area = sum of segment areas (120 m²)', () => {
    expect(facts.usable_area_m2).toBe(120)
  })

  it('reports the segment count and planes', () => {
    expect(facts.segment_count).toBe(2)
    expect(facts.planes.length).toBe(2)
  })

  it('picks the largest plane as the primary orientation (north)', () => {
    expect(facts.primary_orientation).toBe('north')
  })

  it('computes the area-weighted mean pitch (20°)', () => {
    expect(facts.mean_pitch_degrees).toBe(20)
  })

  it('reads maxArrayPanelsCount + panelCapacityWatts from the raw body', () => {
    expect(facts.max_panels_count).toBe(30)
    expect(facts.panel_capacity_watts).toBe(400)
  })

  it('reads the three precomputed panel configs', () => {
    expect(facts.panel_configs).toEqual([
      { panels_count: 16, yearly_energy_dc_kwh: 9600 },
      { panels_count: 24, yearly_energy_dc_kwh: 14400 },
      { panels_count: 30, yearly_energy_dc_kwh: 18000 },
    ])
  })

  it('carries imagery metadata through from coverage', () => {
    expect(facts.imagery_quality).toBe('HIGH')
    expect(facts.imagery_date).toBe('2024-03-12')
  })

  it('maps azimuth 0 → north and 180 → south on the planes', () => {
    const norths = facts.planes.filter((p) => p.orientation === 'north')
    const souths = facts.planes.filter((p) => p.orientation === 'south')
    expect(norths.length).toBe(1)
    expect(souths.length).toBe(1)
  })

  it('defaults panel capacity to 400W when the raw body omits it', () => {
    const noCap = normaliseSolarRoofFacts(
      { ...COVERED_INSIGHT, raw: { solarPotential: {} } },
      COVERAGE,
    )
    expect(noCap.panel_capacity_watts).toBe(400)
  })

  it('uses config.default_panel_capacity_watts when provided and API omits capacity', () => {
    const noCap = normaliseSolarRoofFacts(
      { ...COVERED_INSIGHT, raw: { solarPotential: {} } },
      COVERAGE,
      { default_panel_capacity_watts: 415 },
    )
    expect(noCap.panel_capacity_watts).toBe(415)
  })

  it('API panelCapacityWatts takes priority over config default', () => {
    // COVERED_RAW_BODY has panelCapacityWatts=400 explicitly
    const withConfig = normaliseSolarRoofFacts(
      { ...COVERED_INSIGHT, raw: COVERED_RAW_BODY },
      COVERAGE,
      { default_panel_capacity_watts: 415 },
    )
    expect(withConfig.panel_capacity_watts).toBe(400)
  })

  it('sums raw segment areas before rounding (no double-rounding error)', () => {
    // Areas that would produce drift if each area_m2 is rounded before summing:
    // round1(70.05) + round1(50.05) = 70.1 + 50.1 = 120.2 → round1 = 120.2 (WRONG)
    // round1(70.05 + 50.05) = round1(120.1) = 120.1 (CORRECT)
    const driftBody = {
      imageryQuality: 'HIGH',
      imageryDate: { year: 2024, month: 3, day: 12 },
      solarPotential: {
        maxArrayPanelsCount: 30,
        panelCapacityWatts: 400,
        panelHeightMeters: 1.879,
        panelWidthMeters: 1.045,
        roofSegmentStats: [
          { pitchDegrees: 20, azimuthDegrees: 0, stats: { areaMeters2: 70.05 } },
          { pitchDegrees: 20, azimuthDegrees: 180, stats: { areaMeters2: 50.05 } },
        ],
        solarPanelConfigs: [],
      },
    }
    const insight = parseBuildingInsights(driftBody)
    if (!insight) throw new Error('fixture failed to parse')
    const f = normaliseSolarRoofFacts({ ...insight, raw: driftBody }, COVERAGE)
    // 70.05 + 50.05 = 120.1 → round1 = 120.1
    expect(f.usable_area_m2).toBe(120.1)
  })

  it('returns mean_pitch_degrees = null when weightedMeanPitchDegrees is NaN', () => {
    // Inject a synthetic insight with NaN pitch to test the null guard
    const syntheticInsight = {
      ...COVERED_INSIGHT,
      weightedMeanPitchDegrees: NaN,
      raw: COVERED_RAW_BODY,
    }
    const f = normaliseSolarRoofFacts(syntheticInsight, COVERAGE)
    expect(f.mean_pitch_degrees).toBeNull()
  })
})

describe('normaliseSolarRoofFacts — malformed solarPanelConfigs', () => {
  it('filters out null entries in solarPanelConfigs', () => {
    const body = {
      imageryQuality: 'HIGH',
      imageryDate: { year: 2024, month: 3, day: 12 },
      solarPotential: {
        maxArrayPanelsCount: 30,
        panelCapacityWatts: 400,
        panelHeightMeters: 1.879,
        panelWidthMeters: 1.045,
        roofSegmentStats: [
          { pitchDegrees: 20, azimuthDegrees: 0, stats: { areaMeters2: 70 } },
        ],
        solarPanelConfigs: [
          null,
          { panelsCount: 16, yearlyEnergyDcKwh: 9600 },
          null,
        ],
      },
    }
    const insight = parseBuildingInsights(body)
    if (!insight) throw new Error('fixture failed to parse')
    const f = normaliseSolarRoofFacts({ ...insight, raw: body }, COVERAGE)
    expect(f.panel_configs).toEqual([
      { panels_count: 16, yearly_energy_dc_kwh: 9600 },
    ])
  })

  it('filters out entries missing panelsCount', () => {
    const body = {
      imageryQuality: 'HIGH',
      imageryDate: { year: 2024, month: 3, day: 12 },
      solarPotential: {
        maxArrayPanelsCount: 30,
        panelCapacityWatts: 400,
        panelHeightMeters: 1.879,
        panelWidthMeters: 1.045,
        roofSegmentStats: [
          { pitchDegrees: 20, azimuthDegrees: 0, stats: { areaMeters2: 70 } },
        ],
        solarPanelConfigs: [
          { yearlyEnergyDcKwh: 9600 }, // missing panelsCount
          { panelsCount: 24, yearlyEnergyDcKwh: 14400 },
        ],
      },
    }
    const insight = parseBuildingInsights(body)
    if (!insight) throw new Error('fixture failed to parse')
    const f = normaliseSolarRoofFacts({ ...insight, raw: body }, COVERAGE)
    expect(f.panel_configs).toEqual([
      { panels_count: 24, yearly_energy_dc_kwh: 14400 },
    ])
  })

  it('filters out entries with non-numeric string panelsCount', () => {
    const body = {
      imageryQuality: 'HIGH',
      imageryDate: { year: 2024, month: 3, day: 12 },
      solarPotential: {
        maxArrayPanelsCount: 30,
        panelCapacityWatts: 400,
        panelHeightMeters: 1.879,
        panelWidthMeters: 1.045,
        roofSegmentStats: [
          { pitchDegrees: 20, azimuthDegrees: 0, stats: { areaMeters2: 70 } },
        ],
        solarPanelConfigs: [
          { panelsCount: 'bad', yearlyEnergyDcKwh: 9600 },
          { panelsCount: 30, yearlyEnergyDcKwh: 18000 },
        ],
      },
    }
    const insight = parseBuildingInsights(body)
    if (!insight) throw new Error('fixture failed to parse')
    const f = normaliseSolarRoofFacts({ ...insight, raw: body }, COVERAGE)
    // 'bad' is non-numeric string → numberOr returns NaN → filtered out
    expect(f.panel_configs).toEqual([
      { panels_count: 30, yearly_energy_dc_kwh: 18000 },
    ])
  })

  it('returns empty panel_configs when all entries are malformed', () => {
    const body = {
      imageryQuality: 'HIGH',
      imageryDate: { year: 2024, month: 3, day: 12 },
      solarPotential: {
        maxArrayPanelsCount: 30,
        panelCapacityWatts: 400,
        panelHeightMeters: 1.879,
        panelWidthMeters: 1.045,
        roofSegmentStats: [
          { pitchDegrees: 20, azimuthDegrees: 0, stats: { areaMeters2: 70 } },
        ],
        solarPanelConfigs: [null, null, {}],
      },
    }
    const insight = parseBuildingInsights(body)
    if (!insight) throw new Error('fixture failed to parse')
    const f = normaliseSolarRoofFacts({ ...insight, raw: body }, COVERAGE)
    expect(f.panel_configs).toEqual([])
  })
})

describe('azimuthToOrientation — edge cases', () => {
  it('flat roof (pitch < 5°) returns flat regardless of azimuth', () => {
    expect(azimuthToOrientation(0, 4)).toBe('flat')
    expect(azimuthToOrientation(180, 4.9)).toBe('flat')
    expect(azimuthToOrientation(90, 0)).toBe('flat')
  })

  it('null azimuth returns unknown', () => {
    expect(azimuthToOrientation(null, 20)).toBe('unknown')
  })

  it('non-finite pitch (NaN) returns unknown, not a direction label', () => {
    // A roof whose tilt cannot be determined is not reliably north-facing
    expect(azimuthToOrientation(0, NaN)).toBe('unknown')
    expect(azimuthToOrientation(90, NaN)).toBe('unknown')
  })

  it('non-finite pitch (Infinity) returns unknown', () => {
    expect(azimuthToOrientation(0, Infinity)).toBe('unknown')
    expect(azimuthToOrientation(0, -Infinity)).toBe('unknown')
  })

  it('azimuth exactly on sector boundaries (22.5°) rounds correctly', () => {
    // Math.round(22.5 / 45) = Math.round(0.5) = 1 → north_east
    expect(azimuthToOrientation(22.5, 20)).toBe('north_east')
    // Math.round(67.5 / 45) = Math.round(1.5) = 2 → east
    expect(azimuthToOrientation(67.5, 20)).toBe('east')
  })

  it('negative azimuth is normalised before bucketing', () => {
    // -45 → normalised to 315 → round(315/45)=7 → north_west
    expect(azimuthToOrientation(-45, 20)).toBe('north_west')
  })

  it('azimuth > 360 is normalised before bucketing', () => {
    // 405 → normalised to 45 → round(45/45)=1 → north_east
    expect(azimuthToOrientation(405, 20)).toBe('north_east')
  })

  it('azimuth 0 (due north, normal pitch) returns north', () => {
    expect(azimuthToOrientation(0, 20)).toBe('north')
  })

  it('azimuth 180 (due south) returns south', () => {
    expect(azimuthToOrientation(180, 20)).toBe('south')
  })

  it('azimuth 90 (due east) returns east', () => {
    expect(azimuthToOrientation(90, 20)).toBe('east')
  })

  it('azimuth 270 (due west) returns west', () => {
    expect(azimuthToOrientation(270, 20)).toBe('west')
  })

  it('pitch exactly 5° is not flat (boundary is < 5)', () => {
    expect(azimuthToOrientation(0, 5)).toBe('north')
  })
})
