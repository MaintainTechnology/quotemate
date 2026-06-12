// ════════════════════════════════════════════════════════════════════
// Solar — "Sun & shade" customer view model (full-exploitation build
// 2026-06-13). ONE pure assembler turns the persisted sun facts
// (roof.sunshine fields from buildingInsights + context.sun from the
// dataLayers pipeline) into everything the quote page and the PDF render:
//
//   • headline stats (max sun hours, shade-free window, building height,
//     panel lifetime, max array area)
//   • per-plane sun-score rows (orientation + area + label + relative %)
//   • the flux heatmap figure facts (availability, bounds, imagery date)
//
// No dollar figures anywhere → the whole section renders pre-confirm.
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type { SolarEstimate } from './types'
import { deriveSolarSunScores, SUN_SCORE_COPY } from './sun-score'
import { orientationLabel } from './hero-overlay'

export type SolarSunStat = { label: string; value: string; hint?: string }

export type SolarSunPlaneRow = {
  orientation: string
  area_m2: number
  score_copy: string
  relative_pct: number
}

/** A sun-score label pinned ONTO the heatmap image (deterministic —
 *  panel centroids projected through the raster's geo bbox). */
export type SolarSunMarker = {
  /** Position inside the heatmap image, % of width/height. */
  x_pct: number
  y_pct: number
  /** e.g. "North face". */
  orientation: string
  /** e.g. "Excellent sun". */
  score_copy: string
  area_m2: number
  relative_pct: number
  /** True for the sunniest plane — the page renders it in accent. */
  is_best: boolean
}

export type SolarSunView = {
  /** Headline stat cards (only rows with real data are present). */
  stats: SolarSunStat[]
  /** Per-plane sun scores, sunniest first. Empty without quantiles. */
  planes: SolarSunPlaneRow[]
  /** True when a cached flux heatmap PNG exists for this estimate. */
  flux_image_available: boolean
  /** Figure caption for the heatmap (bounds + imagery date). */
  flux_caption: string | null
  /** Sun-score labels pinned onto the heatmap (empty without anchors). */
  markers: SolarSunMarker[]
  /** Hourly sun fractions (0–23) for a future hour-strip view. */
  hourly_sun_fraction: number[] | null
}

/** PURE — 24h hour → compact AU label (9 → '9am', 15 → '3pm'). */
export function hourLabel(hour: number): string {
  const h = ((Math.round(hour) % 24) + 24) % 24
  if (h === 0) return '12am'
  if (h === 12) return '12pm'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

const nf = (n: number) => n.toLocaleString('en-AU')

/**
 * PURE — build the Sun & shade view. Returns null when the estimate
 * carries no sun data at all (manual path / pre-build estimates), so
 * consumers omit the section entirely.
 */
export function buildSolarSunView(estimate: SolarEstimate): SolarSunView | null {
  const roof = estimate.roof
  const sun = estimate.context.sun ?? null
  const scores = deriveSolarSunScores(roof)

  const stats: SolarSunStat[] = []

  if (scores.max_sunshine_hours_per_year != null) {
    stats.push({
      label: 'Sunshine on this roof',
      value: `${nf(Math.round(scores.max_sunshine_hours_per_year))} hrs/yr`,
      hint: 'Maximum usable sunshine, measured by Google Solar',
    })
  }

  if (sun?.shade && sun.shade.shade_free_hours > 0 && sun.shade.shade_free_start_hour != null) {
    stats.push({
      label: 'Shade-free window',
      value: `${hourLabel(sun.shade.shade_free_start_hour)} – ${hourLabel((sun.shade.shade_free_end_hour ?? sun.shade.shade_free_start_hour) + 1)}`,
      hint: 'Hours with direct sun on 90%+ of days, year-round',
    })
  }

  if (sun?.building_height) {
    stats.push({
      label: 'Building height',
      value: `${nf(sun.building_height.height_m)} m`,
      hint: `≈ ${sun.building_height.storeys_hint} store${sun.building_height.storeys_hint === 1 ? 'y' : 'ys'}, from the elevation model`,
    })
  }

  if (roof.panel_lifetime_years != null) {
    stats.push({
      label: 'Panel lifetime assumed',
      value: `${roof.panel_lifetime_years} yrs`,
      hint: "Google Solar's modelled panel life",
    })
  }

  if (roof.max_array_area_m2 != null) {
    stats.push({
      label: 'Max array area',
      value: `${nf(roof.max_array_area_m2)} m²`,
      hint: 'Roof area physically available for panels',
    })
  }

  // Per-plane sun scores, sunniest first.
  const planes: SolarSunPlaneRow[] = scores.planes
    .filter(
      (p): p is typeof p & { relative_pct: number; label: NonNullable<typeof p.label> } =>
        p.relative_pct != null && p.label != null,
    )
    .map((p) => ({
      orientation: orientationLabel(p.orientation),
      area_m2: p.area_m2,
      score_copy: SUN_SCORE_COPY[p.label],
      relative_pct: p.relative_pct,
    }))
    .sort((a, b) => b.relative_pct - a.relative_pct)

  const flux_image_available = Boolean(sun?.flux_image_path)

  // On-image sun-score markers: join the per-plane anchors (projected at
  // asset-generation time) with the derived scores. Only planes that have
  // BOTH an anchor and a score get a label — nothing ever floats.
  const markers: SolarSunMarker[] = []
  if (flux_image_available && sun?.plane_anchors) {
    for (const anchor of sun.plane_anchors) {
      const score = scores.planes[anchor.plane_index]
      if (!score || score.relative_pct == null || score.label == null) continue
      markers.push({
        x_pct: anchor.x_pct,
        y_pct: anchor.y_pct,
        orientation: orientationLabel(score.orientation),
        score_copy: SUN_SCORE_COPY[score.label],
        area_m2: score.area_m2,
        relative_pct: score.relative_pct,
        is_best: scores.best_plane_index === anchor.plane_index,
      })
    }
    // Best plane first so it stacks above neighbours when labels overlap.
    markers.sort((a, b) => Number(b.is_best) - Number(a.is_best))
  }

  const flux_caption = flux_image_available
    ? 'Roof irradiance measured by Google Solar — brighter means more annual sun' +
      (sun?.min_flux != null && sun?.max_flux != null
        ? ` (${nf(Math.round(sun.min_flux))}–${nf(Math.round(sun.max_flux))} kWh/kW/yr)`
        : '') +
      (sun?.imagery_date ? `. Imagery ${sun.imagery_date}.` : '.')
    : null

  if (stats.length === 0 && planes.length === 0 && !flux_image_available) return null

  return {
    stats,
    planes,
    flux_image_available,
    flux_caption,
    markers,
    hourly_sun_fraction: sun?.shade?.hourly_sun_fraction ?? null,
  }
}
