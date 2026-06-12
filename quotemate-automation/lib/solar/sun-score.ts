// ════════════════════════════════════════════════════════════════════
// Solar — per-plane sun scores from Google sunshine quantiles.
//
// buildingInsights exposes roofSegmentStats[].stats.sunshineQuantiles —
// the pointwise sun-exposure distribution across each roof plane
// (ascending percentiles, kWh/kW/year) — plus maxSunshineHoursPerYear.
// This module turns those into customer-readable facts:
//
//   • per-plane MEDIAN sunshine (p50 of the quantiles)
//   • a RELATIVE score against the building's best plane (unit-free, so
//     the classification is robust to Google's flux units)
//   • a coarse label: excellent ≥ 90%, good ≥ 75%, moderate ≥ 60%,
//     limited below.
//
// Display-only — sun scores never touch sizing or pricing. PURE, no I/O.
// ════════════════════════════════════════════════════════════════════

import type { SolarOrientation, SolarRoofFacts } from './types'

export type SolarSunScoreLabel = 'excellent' | 'good' | 'moderate' | 'limited'

export type SolarPlaneSunScore = {
  /** Index into SolarRoofFacts.planes. */
  plane_index: number
  orientation: SolarOrientation
  area_m2: number
  /** Median (p50) of the plane's sunshine quantiles, kWh/kW/year. Null
   *  when the plane carries no quantiles. */
  median_sunshine: number | null
  /** This plane's median as a % of the best plane's median (0–100). */
  relative_pct: number | null
  label: SolarSunScoreLabel | null
}

export type SolarSunScores = {
  /** solarPotential.maxSunshineHoursPerYear, hours. */
  max_sunshine_hours_per_year: number | null
  /** Whole-roof median sunshine (p50 of wholeRoofStats quantiles). */
  whole_roof_median_sunshine: number | null
  planes: SolarPlaneSunScore[]
  /** Index of the sunniest plane, or null when no plane has quantiles. */
  best_plane_index: number | null
}

const LABEL_THRESHOLDS: Array<{ min: number; label: SolarSunScoreLabel }> = [
  { min: 90, label: 'excellent' },
  { min: 75, label: 'good' },
  { min: 60, label: 'moderate' },
  { min: 0, label: 'limited' },
]

/** PURE — median of an ascending quantile array (the middle percentile). */
export function medianOfQuantiles(quantiles: number[] | null | undefined): number | null {
  if (!Array.isArray(quantiles) || quantiles.length === 0) return null
  const mid = quantiles[Math.floor(quantiles.length / 2)]
  return Number.isFinite(mid) && mid >= 0 ? round1(mid) : null
}

/** PURE — classify a relative percentage onto the coarse label scale. */
export function sunScoreLabel(relativePct: number): SolarSunScoreLabel {
  for (const t of LABEL_THRESHOLDS) {
    if (relativePct >= t.min) return t.label
  }
  return 'limited'
}

/** Human copy for each label — shared by the quote page and the PDF. */
export const SUN_SCORE_COPY: Record<SolarSunScoreLabel, string> = {
  excellent: 'Excellent sun',
  good: 'Good sun',
  moderate: 'Moderate sun',
  limited: 'Limited sun',
}

/**
 * PURE — derive the sun-score view from roof facts. Returns scores with
 * null medians/labels for planes without quantiles (manual path, old
 * estimates, or Google omitting the field) — consumers omit those rows.
 */
export function deriveSolarSunScores(
  roof: Pick<
    SolarRoofFacts,
    'planes' | 'max_sunshine_hours_per_year' | 'whole_roof_sunshine_quantiles'
  >,
): SolarSunScores {
  const medians = roof.planes.map((p) => medianOfQuantiles(p.sunshine_quantiles))

  let bestIdx: number | null = null
  let bestMedian = 0
  medians.forEach((m, i) => {
    if (m !== null && m > bestMedian) {
      bestMedian = m
      bestIdx = i
    }
  })

  const planes: SolarPlaneSunScore[] = roof.planes.map((p, i) => {
    const median = medians[i]
    const relative =
      median !== null && bestMedian > 0
        ? Math.round(Math.min(100, (median / bestMedian) * 100))
        : null
    return {
      plane_index: i,
      orientation: p.orientation,
      area_m2: p.area_m2,
      median_sunshine: median,
      relative_pct: relative,
      label: relative !== null ? sunScoreLabel(relative) : null,
    }
  })

  return {
    max_sunshine_hours_per_year: roof.max_sunshine_hours_per_year ?? null,
    whole_roof_median_sunshine: medianOfQuantiles(roof.whole_roof_sunshine_quantiles),
    planes,
    best_plane_index: bestIdx,
  }
}

function round1(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10) / 10
}

export const __test_only__ = { LABEL_THRESHOLDS }
