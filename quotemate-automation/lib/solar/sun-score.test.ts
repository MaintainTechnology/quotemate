import { describe, it, expect } from 'vitest'
import {
  deriveSolarSunScores,
  medianOfQuantiles,
  sunScoreLabel,
  SUN_SCORE_COPY,
} from './sun-score'
import { COVERED_ROOF_FACTS } from './__fixtures__/building-insights'
import { buildManualRoofFacts } from './manual-fallback'
import { MANUAL_INPUT } from './__fixtures__/building-insights'

describe('medianOfQuantiles', () => {
  it('returns the middle percentile of an 11-value ascending array', () => {
    expect(medianOfQuantiles([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(5)
  })

  it('returns null for empty / absent / malformed input', () => {
    expect(medianOfQuantiles([])).toBeNull()
    expect(medianOfQuantiles(null)).toBeNull()
    expect(medianOfQuantiles(undefined)).toBeNull()
  })

  it('rounds to one decimal', () => {
    expect(medianOfQuantiles([1, 2.345, 3])).toBe(2.3)
  })
})

describe('sunScoreLabel', () => {
  it('maps the documented thresholds', () => {
    expect(sunScoreLabel(100)).toBe('excellent')
    expect(sunScoreLabel(90)).toBe('excellent')
    expect(sunScoreLabel(89)).toBe('good')
    expect(sunScoreLabel(75)).toBe('good')
    expect(sunScoreLabel(74)).toBe('moderate')
    expect(sunScoreLabel(60)).toBe('moderate')
    expect(sunScoreLabel(59)).toBe('limited')
    expect(sunScoreLabel(0)).toBe('limited')
  })

  it('has display copy for every label', () => {
    for (const label of ['excellent', 'good', 'moderate', 'limited'] as const) {
      expect(SUN_SCORE_COPY[label].length).toBeGreaterThan(0)
    }
  })
})

describe('deriveSolarSunScores', () => {
  const scores = deriveSolarSunScores(COVERED_ROOF_FACTS)

  it('carries maxSunshineHoursPerYear through', () => {
    expect(scores.max_sunshine_hours_per_year).toBe(2400)
  })

  it('computes the whole-roof median (p50 = 1550)', () => {
    expect(scores.whole_roof_median_sunshine).toBe(1550)
  })

  it('picks the north plane as best (median 1600 vs 1200)', () => {
    expect(scores.best_plane_index).toBe(0)
    expect(scores.planes[0].median_sunshine).toBe(1600)
    expect(scores.planes[1].median_sunshine).toBe(1200)
  })

  it('scores the best plane 100% excellent and the south plane 75% good', () => {
    expect(scores.planes[0].relative_pct).toBe(100)
    expect(scores.planes[0].label).toBe('excellent')
    expect(scores.planes[1].relative_pct).toBe(75)
    expect(scores.planes[1].label).toBe('good')
  })

  it('carries plane orientation + area for display', () => {
    expect(scores.planes[0].orientation).toBe('north')
    expect(scores.planes[0].area_m2).toBe(70)
  })

  it('returns null scores on the manual path (no quantiles anywhere)', () => {
    const manual = buildManualRoofFacts(MANUAL_INPUT)
    const s = deriveSolarSunScores(manual)
    expect(s.max_sunshine_hours_per_year).toBeNull()
    expect(s.whole_roof_median_sunshine).toBeNull()
    expect(s.best_plane_index).toBeNull()
    expect(s.planes).toEqual([])
  })

  it('tolerates a single plane without quantiles among scored planes', () => {
    const s = deriveSolarSunScores({
      max_sunshine_hours_per_year: 2000,
      whole_roof_sunshine_quantiles: null,
      planes: [
        {
          pitch_degrees: 20,
          azimuth_degrees: 0,
          area_m2: 40,
          orientation: 'north',
          sunshine_quantiles: [1000, 1500, 2000],
        },
        {
          pitch_degrees: 20,
          azimuth_degrees: 180,
          area_m2: 30,
          orientation: 'south',
          sunshine_quantiles: null,
        },
      ],
    })
    expect(s.planes[0].label).toBe('excellent')
    expect(s.planes[1].median_sunshine).toBeNull()
    expect(s.planes[1].relative_pct).toBeNull()
    expect(s.planes[1].label).toBeNull()
  })
})
