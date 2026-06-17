// ════════════════════════════════════════════════════════════════════
// Solar — panel-marked reference image for the AI concept render.
//
// Words alone do not make a generative model place panels correctly, so
// the Gemini brief now ships a SECOND image: the same satellite frame
// with every panel rectangle drawn at its exact geo position via Google
// Static Maps `path` parameters. The rectangles are the SAME shapes the
// deterministic layout overlay draws — identical centre, dimensions,
// plane-azimuth rotation, and cos(pitch) foreshortening — just rendered
// by Google's raster pipeline instead of our SVG, so the reference and
// the figures agree by construction.
//
// PURE — corner math + path building only; the caller owns the URL/key.
// ════════════════════════════════════════════════════════════════════

import type { LatLng, SolarPanelPlacement, SolarRoofPlane } from './types'
import { selectPanelsForLayout } from './layout-overlay'

/** Metres per degree of latitude (WGS-84 mean). */
const METERS_PER_DEG_LAT = 111_320

/**
 * PURE — the four geo corners of one panel rectangle, matching the
 * layout overlay's screen rectangle exactly:
 *   • PORTRAIT: long side runs up the slope; LANDSCAPE: along the row.
 *   • Slope dimension foreshortened by cos(pitch) (aerial view).
 *   • Rotated to the plane azimuth (screen-clockwise == compass).
 * Null when the panel size is unusable.
 */
export function panelRectangleGeoCorners(args: {
  panel: SolarPanelPlacement
  plane: SolarRoofPlane | undefined
  panel_size_m: { height_m: number; width_m: number }
}): LatLng[] | null {
  const { panel, plane, panel_size_m } = args
  if (!(panel_size_m.height_m > 0) || !(panel_size_m.width_m > 0)) return null
  const { lat, lng } = panel.center
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const pitchDeg = Math.min(60, Math.max(0, plane?.pitch_degrees ?? 0))
  const foreshorten = Math.cos((pitchDeg * Math.PI) / 180)

  // Pre-rotation: x = across the row (screen east), y = down the slope
  // (screen south). Same convention as layout-overlay's <rect>.
  const long = panel_size_m.height_m
  const short = panel_size_m.width_m
  const w = panel.orientation === 'PORTRAIT' ? short : long
  const h = (panel.orientation === 'PORTRAIT' ? long : short) * foreshorten

  // SVG rotate(θ) in y-down screen space: x' = x cosθ − y sinθ,
  // y' = x sinθ + y cosθ. Screen east = +x → +lng; screen south = +y → −lat.
  const theta = (normaliseDeg(plane?.azimuth_degrees ?? 0) * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)

  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)
  if (!(metersPerDegLng > 0)) return null

  const corners: LatLng[] = []
  for (const [cx, cy] of [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ] as const) {
    const xr = cx * cos - cy * sin // metres east
    const yr = cx * sin + cy * cos // metres south
    corners.push({
      lat: lat - yr / METERS_PER_DEG_LAT,
      lng: lng + xr / metersPerDegLng,
    })
  }
  return corners
}

export type StaticMapPath = {
  points: LatLng[]
  color?: string
  fillColor?: string
  weight?: number
}

/**
 * PURE — one closed Static Maps path per panel (capped to the headline
 * tier's count), in the Maintain orange so the markers are unambiguous
 * against any roof. Empty when geometry/dimensions are missing — the
 * caller then skips the marked reference entirely (degradation §4.6).
 */
export function buildPanelMarkupPaths(args: {
  panels: SolarPanelPlacement[]
  planes: SolarRoofPlane[]
  panel_size_m: { height_m: number; width_m: number } | null | undefined
  panel_limit?: number | null
  /** Match the quote layout's cleaner one-face preference when safe. */
  prefer_contiguous_layout?: boolean
}): StaticMapPath[] {
  const { panels, planes, panel_size_m } = args
  if (!panels || panels.length === 0 || !panel_size_m) return []

  const limit =
    args.panel_limit != null && args.panel_limit > 0
      ? Math.min(panels.length, Math.floor(args.panel_limit))
      : panels.length

  const selected = selectPanelsForLayout(panels, limit, {
    prefer_contiguous_layout: args.prefer_contiguous_layout,
  })

  const paths: StaticMapPath[] = []
  for (const panel of selected) {
    const corners = panelRectangleGeoCorners({
      panel,
      plane: planes[panel.segment_index],
      panel_size_m,
    })
    if (!corners) continue
    paths.push({
      // Close the ring so Static Maps fills the rectangle.
      points: [...corners, corners[0]],
      color: '0xFF5F00FF',
      fillColor: '0xFF5F0090',
      weight: 1,
    })
  }
  return paths
}

function normaliseDeg(d: number): number {
  if (!Number.isFinite(d)) return 0
  return ((d % 360) + 360) % 360
}
