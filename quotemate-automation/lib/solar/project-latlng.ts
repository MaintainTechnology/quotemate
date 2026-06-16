// ════════════════════════════════════════════════════════════════════
// Solar — pure lat/lng → image-percent projection for the multi-roof
// building picker (2026-06-16). Projects a geographic point into the
// Google Static Map image's pixel space (Web Mercator) and returns its
// position as x%/y% of the image — the SAME absolutely-positioned-overlay
// technique SunShadeOverlay uses for sun-score dots.
//
// The picker draws each DetectedBuilding.footprint as an SVG polygon over
// the satellite <img>; this module is the only geometry it needs. The
// percentages are scale-invariant (Google's `scale` doubles width AND
// height equally), so the same path works whether the static-map route
// requested scale 1 or 2.
//
// Mirrors lib/solar/layout-overlay.ts's Web-Mercator math (which projects
// panel placements for the premium-quote layout) so map and overlays stay
// consistent across the codebase.
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type { LatLng } from './types'
import type { GeoJSONPolygon } from '../roofing/types'

/** The Google Static Map framing a projection is computed against. MUST
 *  match the parameters the /api/solar/q/[token]/static-map route (and the
 *  /detect address-form preview) rendered the image with. */
export type StaticMapParams = {
  /** The map centre coordinate (the static-map route's resolved centre). */
  center: LatLng
  /** Google Static Maps zoom level (the route requests 20). */
  zoom: number
  /** Requested logical width in CSS pixels (the route requests 640). */
  width: number
  /** Requested logical height in CSS pixels (the route requests 480). */
  height: number
  /** Retina scale (1 or 2). Doubles both image dimensions equally, so it
   *  does NOT change a point's percentage position — accepted for
   *  completeness / call-site symmetry only. */
  scale?: 1 | 2
}

/** A point inside the image as a percentage of its width/height (0–100,
 *  may fall slightly outside when the geo point is off-frame). */
export type ImagePct = { x_pct: number; y_pct: number }

/** PURE — world-pixel coordinate of a lat/lng at a zoom (256 × 2^zoom
 *  world size, standard Web Mercator). Identical to layout-overlay's
 *  mercatorWorldPx. */
export function mercatorWorldPx(point: LatLng, zoom: number): { x: number; y: number } {
  const worldSize = 256 * 2 ** zoom
  const x = ((point.lng + 180) / 360) * worldSize
  const sinLat = Math.sin((point.lat * Math.PI) / 180)
  // Clamp to avoid Infinity at the poles (never reached for AU roofs).
  const clamped = Math.min(0.9999, Math.max(-0.9999, sinLat))
  const y = (0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI)) * worldSize
  return { x, y }
}

/**
 * PURE — project a lat/lng to x%/y% within the static-map image.
 *
 * Offsets the point's world-pixel from the centre's world-pixel (both at
 * the map zoom), lands it relative to the image centre, and divides by the
 * logical image dimensions → percentages. The centre always projects to
 * 50% / 50% by construction.
 */
export function projectLatLngToImagePct(point: LatLng, mapParams: StaticMapParams): ImagePct {
  const { center, zoom, width, height } = mapParams
  const wp = mercatorWorldPx(point, zoom)
  const wc = mercatorWorldPx(center, zoom)
  // Pixel position within the logical (pre-scale) image.
  const px = width / 2 + (wp.x - wc.x)
  const py = height / 2 + (wp.y - wc.y)
  return {
    x_pct: (px / width) * 100,
    y_pct: (py / height) * 100,
  }
}

/**
 * PURE — project a GeoJSON polygon's outer ring to an array of image-pct
 * points, ready for an SVG <polygon points="…"> (in a 0–100 viewBox) or
 * absolutely-positioned vertices. GeoJSON rings are [lng, lat] pairs.
 *
 * Returns [] when the polygon has no usable outer ring; skips any vertex
 * that is not a finite [lng, lat] pair (so a single bad coordinate never
 * poisons the whole outline). Callers should treat a path shorter than 3
 * points as "not drawable" and omit the outline for that building.
 */
export function polygonToImagePctPath(
  polygon: GeoJSONPolygon | null | undefined,
  mapParams: StaticMapParams,
): ImagePct[] {
  const ring = polygon?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length === 0) return []
  const out: ImagePct[] = []
  for (const v of ring) {
    if (
      !Array.isArray(v) ||
      typeof v[0] !== 'number' ||
      typeof v[1] !== 'number' ||
      !Number.isFinite(v[0]) ||
      !Number.isFinite(v[1])
    ) {
      continue
    }
    out.push(projectLatLngToImagePct({ lat: v[1], lng: v[0] }, mapParams))
  }
  return out
}
