import { describe, it, expect } from 'vitest'
import {
  COVERED_INSIGHT,
  COVERED_RAW_BODY,
  UNCOVERED_RAW_BODY,
  MANUAL_INPUT,
} from './building-insights'

describe('solar fixtures', () => {
  it('COVERED_INSIGHT is a parsed SolarRoofInsight with usable segments', () => {
    expect(COVERED_INSIGHT.segmentCount).toBeGreaterThan(0)
    expect(COVERED_INSIGHT.segments.length).toBe(COVERED_INSIGHT.segmentCount)
    expect(COVERED_INSIGHT.imageryQuality).toBe('HIGH')
    expect(COVERED_INSIGHT.totalSegmentAreaM2).toBeGreaterThan(0)
    expect(COVERED_INSIGHT.weightedMeanPitchDegrees).toBeGreaterThan(0)
  })

  it('COVERED_RAW_BODY carries solarPanelConfigs + maxArrayPanelsCount + panelCapacityWatts', () => {
    const sp = (COVERED_RAW_BODY as Record<string, any>).solarPotential
    expect(Array.isArray(sp.solarPanelConfigs)).toBe(true)
    expect(sp.solarPanelConfigs.length).toBeGreaterThan(0)
    expect(sp.maxArrayPanelsCount).toBeGreaterThan(0)
    expect(sp.panelCapacityWatts).toBe(400)
  })

  it('UNCOVERED_RAW_BODY has no usable roof segments', () => {
    const sp = (UNCOVERED_RAW_BODY as Record<string, any>).solarPotential
    expect(sp === undefined || sp === null).toBe(true)
  })

  it('MANUAL_INPUT is a north-facing medium single-storey declaration', () => {
    expect(MANUAL_INPUT.orientation).toBe('north')
    expect(MANUAL_INPUT.roof_size).toBe('medium')
    expect(MANUAL_INPUT.storeys).toBe(1)
  })
})
