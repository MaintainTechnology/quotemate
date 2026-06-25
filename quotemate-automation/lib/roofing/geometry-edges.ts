// ════════════════════════════════════════════════════════════════════
// Roofing — footprint-geometry edge estimation.
//
// Hips and valleys are stored as COUNTS, derived by the roof-form
// classifier (lib/roofing/providers/geoscape.ts estimate*FromForm). When
// Geoscape can't classify the roof shape it returns form 'unknown'
// (or 'complex'), and those counts come back NULL — which the UI renders
// as "?". That is the "hips and valleys not showing" bug.
//
// This module fills that gap from the footprint POLYGON itself, which is
// always present on a successful measurement:
//   • Hips form at the CONVEX (external) corners of a roof with sloped
//     ends — a simple rectangular hip roof has 4.
//   • Valleys form at the REFLEX (internal / re-entrant) corners — the
//     inside corner of an L-shaped roof has 1.
// Gable / skillion ends are vertical, so they contribute no hips.
//
// PURE — no I/O. Fully unit-tested.
// ════════════════════════════════════════════════════════════════════

import type { GeoJSONPolygon, PitchBucket, RoofForm, RoofMetrics } from './types'
import { deriveEdgeWorks } from './pricing'

/** Ignore near-straight vertices (collinear points on a traced outline). */
const MIN_TURN_DEG = 25

/**
 * PURE — classify a footprint polygon's corners into convex vs reflex
 * counts. Projects lng/lat to local metres so turn signs are meaningful,
 * uses the ring winding to decide which turn direction is "convex", and
 * ignores near-straight vertices.
 */
export function polygonCornerCounts(
  polygon: GeoJSONPolygon | null | undefined,
): { convex: number; reflex: number } {
  const ring = polygon?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 4) return { convex: 0, reflex: 0 }

  // Drop the closing duplicate vertex if present.
  const pts = ring.slice()
  if (pts.length > 1) {
    const a = pts[0]
    const b = pts[pts.length - 1]
    if (a[0] === b[0] && a[1] === b[1]) pts.pop()
  }
  const n = pts.length
  if (n < 3) return { convex: 0, reflex: 0 }

  // Equirectangular projection to metres (angle-preserving enough locally).
  let lat0 = 0
  for (const p of pts) lat0 += p[1]
  lat0 /= n
  const cosLat = Math.cos((lat0 * Math.PI) / 180)
  const X = pts.map((p) => p[0] * 111_320 * cosLat)
  const Y = pts.map((p) => p[1] * 110_574)

  // Signed area → winding (positive = counter-clockwise).
  let area2 = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area2 += X[i] * Y[j] - X[j] * Y[i]
  }
  const ccw = area2 > 0

  let convex = 0
  let reflex = 0
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n
    const next = (i + 1) % n
    const ax = X[i] - X[prev]
    const ay = Y[i] - Y[prev]
    const bx = X[next] - X[i]
    const by = Y[next] - Y[i]
    const cross = ax * by - ay * bx
    const dot = ax * bx + ay * by
    const turnDeg = Math.abs((Math.atan2(cross, dot) * 180) / Math.PI)
    if (turnDeg < MIN_TURN_DEG) continue // basically straight → not a corner
    // For a CCW ring, a left turn (cross > 0) is convex.
    const isConvex = ccw ? cross > 0 : cross < 0
    if (isConvex) convex++
    else reflex++
  }
  return { convex, reflex }
}

/**
 * PURE — estimate hip / valley counts from the footprint geometry. Hips
 * only apply to roofs with sloped ends (not gable / skillion); valleys
 * are the reflex corners regardless of form.
 */
export function edgesFromGeometry(
  polygon: GeoJSONPolygon | null | undefined,
  form: RoofForm,
): { hips: number; valleys: number } {
  const { convex, reflex } = polygonCornerCounts(polygon)
  const hippable = form !== 'gable' && form !== 'skillion'
  return { hips: hippable ? convex : 0, valleys: reflex }
}

/**
 * PURE — fill NULL hip / valley counts from the footprint geometry so
 * every measured building surfaces real numbers instead of "?". Counts
 * the roof-form classifier already produced (non-null) are left untouched.
 */
export function fillEdgesFromGeometry(metrics: RoofMetrics): RoofMetrics {
  if (metrics.hips != null && metrics.valleys != null) return metrics
  // Complex roofs route to inspection (a tradie measures on site), so we
  // deliberately do NOT guess their hip/valley counts — leave them null.
  if (metrics.form === 'complex') return metrics
  const geo = edgesFromGeometry(metrics.polygon_geojson, metrics.form)
  return {
    ...metrics,
    hips: metrics.hips ?? geo.hips,
    valleys: metrics.valleys ?? geo.valleys,
  }
}

/** Display-ready hip / valley figures: filled counts + derived linear metres. */
export type EdgeStat = {
  hips: number | null
  valleys: number | null
  hips_lm: number | null
  valleys_lm: number | null
}

/**
 * PURE — the hip / valley figures a UI surface should show: counts filled
 * from geometry when the classifier left them null, plus the geometry-
 * derived linear metres (the actual measurement). Works on a freshly
 * measured metrics object AND on a persisted one (older quotes whose
 * counts were stored null), since it reads the always-present polygon.
 */
export function edgeStat(metrics: RoofMetrics, pitch: PitchBucket = 'standard'): EdgeStat {
  const filled = fillEdgesFromGeometry(metrics)
  const ew = deriveEdgeWorks(filled, pitch)
  return {
    hips: filled.hips,
    valleys: filled.valleys,
    hips_lm: ew.hips_lm,
    valleys_lm: ew.valleys_lm,
  }
}
