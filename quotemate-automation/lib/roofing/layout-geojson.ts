// ════════════════════════════════════════════════════════════════════
// Roofing — AI layout plan → MapLibre-ready GeoJSON (spec quote-visual-parity
// R6, interactive-map follow-up).
//
// The static figure composited the zones as pixel SVG over a Google Static
// image; the interactive map instead draws GEOGRAPHIC features over Esri
// tiles, so drag-pan / zoom / rotate need no re-projection. Semantics match
// lib/roofing/layout-overlay-svg.ts:
//   'structure' — footprint outline (stacked zones inset inward)
//   'perimeter' — footprint dilated outward, dashed
//   'ridge'     — classified ridge edges (fallback: bbox major axis)
//   'point'     — model-localised feature, clamped inside the footprint bbox
//
// PURE — no I/O, no MapLibre import. Unit-tested.
// ════════════════════════════════════════════════════════════════════

import type { GeoJSONPolygon } from './types'
import { classifyEdges, polygonBBox, polygonCentroid, type LngLat } from './map-utils'
import { ZONE_COLOR_HEX, type LayoutZone } from './layout-plan'
import { layoutMapView, type LayoutOverlayStructure } from './layout-overlay-svg'

const TILE = 256
// Match the static overlay's canvas — point x_pct/y_pct were captured
// relative to the 640×480 fit view, so the inverse projection must use it.
const CANVAS_W = 640
const CANVAS_H = 480

// FIXED-METRE ring offsets. A fractional scale factor pushed the far wings of
// large L-shaped roofs metres away from the roofline (offset grew with the
// vertex's distance from the centroid) — the misaligned-borders report. Each
// vertex now moves a constant distance along its centroid ray instead.
const PERIMETER_OFFSET_M = 1.8
const STACK_INSET_M = 1.4

const M_PER_DEG_LAT = 110_574
const M_PER_DEG_LNG_EQUATOR = 111_320

type LineFeature = {
  type: 'Feature'
  properties: { color: string; dash: 0 | 1 }
  geometry: { type: 'LineString'; coordinates: number[][] }
}
type PolygonFeature = {
  type: 'Feature'
  properties: Record<string, never>
  geometry: GeoJSONPolygon
}
type PointFeature = {
  type: 'Feature'
  properties: { color: string }
  geometry: { type: 'Point'; coordinates: [number, number] }
}
type FC<F> = { type: 'FeatureCollection'; features: F[] }

export type LayoutGeoJson = {
  tints: FC<PolygonFeature>
  lines: FC<LineFeature>
  points: FC<PointFeature>
}

/** A validated, numeric-only outer ring (≥ 4 points), or null. */
function outerRing(polygon: GeoJSONPolygon | null | undefined): LngLat[] | null {
  const ring = polygon?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 4) return null
  const pts: LngLat[] = []
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) continue
    const [lng, lat] = pt
    if (typeof lng !== 'number' || typeof lat !== 'number') continue
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    pts.push([lng, lat])
  }
  return pts.length >= 4 ? pts : null
}

/** Move every vertex a FIXED distance (metres) along its centroid ray —
 *  positive = outward (dilate), negative = inward (inset). Constant ring
 *  spacing regardless of building size or shape. */
function offsetGeoRing(ring: LngLat[], centroid: LngLat, metres: number): number[][] {
  const [cx, cy] = centroid
  const mPerDegLng = M_PER_DEG_LNG_EQUATOR * Math.cos((cy * Math.PI) / 180)
  return ring.map(([lng, lat]) => {
    const dxM = (lng - cx) * mPerDegLng
    const dyM = (lat - cy) * M_PER_DEG_LAT
    const dist = Math.hypot(dxM, dyM)
    if (dist < 1e-6) return [lng, lat]
    // Never invert past the centroid, however deep the stack insets go.
    const k = Math.max(0.2, (dist + metres) / dist)
    return [cx + (lng - cx) * k, cy + (lat - cy) * k]
  })
}

function mercatorForward(lng: number, lat: number, zoom: number): [number, number] {
  const size = TILE * Math.pow(2, zoom)
  const x = ((lng + 180) / 360) * size
  const sinLat = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999)
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * size
  return [x, y]
}

function mercatorInverse(x: number, y: number, zoom: number): [number, number] {
  const size = TILE * Math.pow(2, zoom)
  const lng = (x / size) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI
  return [lng, lat]
}

export function layoutPlanGeoJson(args: {
  zones: readonly LayoutZone[]
  structures: readonly LayoutOverlayStructure[]
}): LayoutGeoJson {
  const { zones, structures } = args
  const tints: PolygonFeature[] = []
  const lines: LineFeature[] = []
  const points: PointFeature[] = []
  const tinted = new Set<number>()
  const structureOutlines = new Map<number, number>()

  // The fit view the x_pct/y_pct point positions were captured against.
  const view = layoutMapView(structures, { width: CANVAS_W, height: CANVAS_H })

  for (const zone of zones) {
    const structure = structures[zone.structureIndex - 1]
    const ring = structure ? outerRing(structure.polygon) : null
    if (!structure || !ring) continue
    const color = ZONE_COLOR_HEX[zone.color]
    const centroid = polygonCentroid(structure.polygon) ?? ring[0]

    if (!tinted.has(zone.structureIndex - 1)) {
      tinted.add(zone.structureIndex - 1)
      tints.push({
        type: 'Feature',
        properties: {},
        geometry: structure.polygon as GeoJSONPolygon,
      })
    }

    if (zone.placement === 'structure') {
      const stacked = structureOutlines.get(zone.structureIndex) ?? 0
      structureOutlines.set(zone.structureIndex, stacked + 1)
      lines.push({
        type: 'Feature',
        properties: { color, dash: 0 },
        geometry: {
          type: 'LineString',
          coordinates: offsetGeoRing(ring, centroid, -STACK_INSET_M * stacked),
        },
      })
    } else if (zone.placement === 'perimeter') {
      lines.push({
        type: 'Feature',
        properties: { color, dash: 1 },
        geometry: {
          type: 'LineString',
          coordinates: offsetGeoRing(ring, centroid, PERIMETER_OFFSET_M),
        },
      })
    } else if (zone.placement === 'point') {
      // Canvas pct → world px → lng/lat (same fit view the plan was captured
      // against), then clamp inside the structure bbox.
      const bb = polygonBBox(structure.polygon)
      if (!bb) continue
      let lng: number
      let lat: number
      if (view) {
        const [cx, cy] = mercatorForward(view.center.lng, view.center.lat, view.zoom)
        const wx = cx + ((zone.x_pct ?? 50) / 100) * CANVAS_W - CANVAS_W / 2
        const wy = cy + ((zone.y_pct ?? 50) / 100) * CANVAS_H - CANVAS_H / 2
        ;[lng, lat] = mercatorInverse(wx, wy, view.zoom)
      } else {
        ;[lng, lat] = centroid
      }
      lng = Math.min(Math.max(lng, bb.west), bb.east)
      lat = Math.min(Math.max(lat, bb.south), bb.north)
      points.push({
        type: 'Feature',
        properties: { color },
        geometry: { type: 'Point', coordinates: [lng, lat] },
      })
    } else {
      // 'ridge' — classified ridge edges; fallback: bbox major axis.
      const ridges = structure.polygon
        ? classifyEdges(structure.polygon, structure.form).filter((e) => e.kind === 'ridge')
        : []
      if (ridges.length > 0) {
        for (const edge of ridges) {
          lines.push({
            type: 'Feature',
            properties: { color, dash: 0 },
            geometry: { type: 'LineString', coordinates: [edge.from, edge.to] },
          })
        }
      } else {
        const bb = polygonBBox(structure.polygon)
        if (!bb) continue
        const midLng = (bb.west + bb.east) / 2
        const midLat = (bb.south + bb.north) / 2
        const horizontal = bb.east - bb.west >= bb.north - bb.south
        const half = 0.3 * (horizontal ? bb.east - bb.west : bb.north - bb.south)
        const a = horizontal ? [midLng - half, midLat] : [midLng, midLat - half]
        const b = horizontal ? [midLng + half, midLat] : [midLng, midLat + half]
        lines.push({
          type: 'Feature',
          properties: { color, dash: 0 },
          geometry: { type: 'LineString', coordinates: [a, b] },
        })
      }
    }
  }

  return {
    tints: { type: 'FeatureCollection', features: tints },
    lines: { type: 'FeatureCollection', features: lines },
    points: { type: 'FeatureCollection', features: points },
  }
}
