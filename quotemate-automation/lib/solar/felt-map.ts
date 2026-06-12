// ════════════════════════════════════════════════════════════════════
// Solar — Felt map builders (Felt tab spec 2026-06-13 §4.3).
//
// PURE, no I/O. Turns the persisted SolarRoofFacts into the GeoJSON
// layers + Felt Style Language (FSL) styles the provisioning pipeline
// uploads to a Felt map:
//
//   • buildPanelLayoutGeoJson — each proposed panel as a real geo-
//     rectangle, rotated to its plane's azimuth, carrying yearly_kwh.
//   • buildPlaneMarkersGeoJson — one point per roof plane (centroid of
//     its panels) with pitch/azimuth/area + sun-score label.
//   • FSL builders — numeric continuous ramp for panels, raster ramp
//     for the annual flux GeoTIFF, hillshade for the DSM, categorical
//     sun-score colours for the plane markers.
//   • feltMapTitle — NO customer name (unlisted-URL privacy, §4.10).
//
// Display-only — nothing here feeds sizing or pricing.
// ════════════════════════════════════════════════════════════════════

import type { LatLng, SolarEstimate, SolarRoofFacts } from './types'
import { deriveSolarSunScores, SUN_SCORE_COPY, type SolarSunScores } from './sun-score'

/** Metres per degree of latitude (small-area equirectangular approx). */
const M_PER_DEG_LAT = 111_320

export type FeltFeatureCollection = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    properties: Record<string, unknown>
    geometry:
      | { type: 'Polygon'; coordinates: number[][][] }
      | { type: 'Point'; coordinates: number[] }
  }>
}

/** PURE — metre offsets → lat/lng around a centre (roof-scale accuracy). */
export function offsetLatLng(center: LatLng, dxEastM: number, dyNorthM: number): LatLng {
  const lat = center.lat + dyNorthM / M_PER_DEG_LAT
  const lngScale = M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180)
  const lng = center.lng + (lngScale > 0 ? dxEastM / lngScale : 0)
  return { lat, lng }
}

/**
 * PURE — the four corners of a panel rectangle centred at `center`,
 * `widthM` across-slope × `heightM` along-slope, rotated so the panel's
 * "up-slope" axis points at `azimuthDeg` (compass degrees, 0 = N).
 * Returns a closed GeoJSON ring (first point repeated last).
 */
export function panelRectangleRing(
  center: LatLng,
  widthM: number,
  heightM: number,
  azimuthDeg: number,
): number[][] {
  const theta = (azimuthDeg * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const hw = widthM / 2
  const hh = heightM / 2
  // Local frame: x = across-slope (east at azimuth 0), y = up-slope (north
  // at azimuth 0). Rotate clockwise from north by the compass azimuth.
  const corners: Array<[number, number]> = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ]
  const ring = corners.map(([x, y]) => {
    const east = x * cos + y * sin
    const north = -x * sin + y * cos
    const p = offsetLatLng(center, east, north)
    return [round7(p.lng), round7(p.lat)]
  })
  ring.push(ring[0])
  return ring
}

/**
 * PURE — panel placements → GeoJSON polygons. Headline-tier consumers
 * pass `panelCount` to slice Google's energy-ordered array; omit it to
 * render every placement. Returns null when the roof has no per-panel
 * geometry (manual path / pre-premium estimates).
 */
export function buildPanelLayoutGeoJson(
  roof: SolarRoofFacts,
  panelCount?: number,
): FeltFeatureCollection | null {
  const panels = roof.panels ?? []
  if (panels.length === 0) return null
  const size = roof.panel_size_m
  const heightM = size?.height_m && size.height_m > 0 ? size.height_m : 1.879
  const widthM = size?.width_m && size.width_m > 0 ? size.width_m : 1.045

  const slice =
    typeof panelCount === 'number' && panelCount > 0 ? panels.slice(0, panelCount) : panels

  return {
    type: 'FeatureCollection',
    features: slice.map((panel, i) => {
      const plane = roof.planes[panel.segment_index]
      const azimuth = plane?.azimuth_degrees ?? 0
      // LANDSCAPE mounts the long edge across-slope; PORTRAIT along-slope.
      const w = panel.orientation === 'LANDSCAPE' ? heightM : widthM
      const h = panel.orientation === 'LANDSCAPE' ? widthM : heightM
      return {
        type: 'Feature' as const,
        properties: {
          panel_index: i,
          segment_index: panel.segment_index,
          orientation: panel.orientation,
          yearly_kwh: Math.round(panel.yearly_energy_dc_kwh * 10) / 10,
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [panelRectangleRing(panel.center, w, h, azimuth)],
        },
      }
    }),
  }
}

/**
 * PURE — one marker per roof plane at the centroid of its panels,
 * carrying the plane stats + sun-score label. Planes without any panel
 * placements are omitted (no coordinate to anchor the marker to).
 */
export function buildPlaneMarkersGeoJson(
  roof: SolarRoofFacts,
  sunScores?: SolarSunScores,
): FeltFeatureCollection | null {
  const panels = roof.panels ?? []
  if (panels.length === 0 || roof.planes.length === 0) return null
  const scores = sunScores ?? deriveSolarSunScores(roof)

  const features: FeltFeatureCollection['features'] = []
  roof.planes.forEach((plane, i) => {
    const planePanels = panels.filter((p) => p.segment_index === i)
    if (planePanels.length === 0) return
    const lat = planePanels.reduce((s, p) => s + p.center.lat, 0) / planePanels.length
    const lng = planePanels.reduce((s, p) => s + p.center.lng, 0) / planePanels.length
    const score = scores.planes[i]
    features.push({
      type: 'Feature',
      properties: {
        plane_index: i,
        orientation: plane.orientation,
        pitch_degrees: Math.round(plane.pitch_degrees * 10) / 10,
        azimuth_degrees:
          plane.azimuth_degrees !== null ? Math.round(plane.azimuth_degrees) : null,
        area_m2: Math.round(plane.area_m2 * 10) / 10,
        panels_count: planePanels.length,
        sun_label: score?.label ? SUN_SCORE_COPY[score.label] : 'Sun data unavailable',
        sun_relative_pct: score?.relative_pct ?? null,
        median_sunshine_kwh_per_kw: score?.median_sunshine ?? null,
      },
      geometry: { type: 'Point', coordinates: [round7(lng), round7(lat)] },
    })
  })

  return features.length > 0 ? { type: 'FeatureCollection', features } : null
}

/** PURE — the property-pin annotation (Felt elements FeatureCollection). */
export function buildPropertyPinGeoJson(
  location: LatLng,
  address: string | null,
): FeltFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          'felt:type': 'Place',
          'felt:symbol': 'home',
          'felt:text': address ?? 'Property',
        },
        geometry: { type: 'Point', coordinates: [round7(location.lng), round7(location.lat)] },
      },
    ],
  }
}

// ── FSL styles (Felt Style Language v2.3) ────────────────────────────
// Colour direction: dim navy → Maintain orange — matches the flux PNG
// ramp the instant path renders and the brand accent (#FF5A1F).

const FLUX_RAMP = ['#1B2433', '#3D3A55', '#7A4A56', '#B85A45', '#E8470F', '#FF7A45', '#FFC83D']

/** Panels: continuous colour ramp on per-panel yearly kWh + popup. */
export function panelLayoutFsl(): Record<string, unknown> {
  return {
    version: '2.3',
    type: 'numeric',
    config: {
      numericAttribute: 'yearly_kwh',
      steps: { type: 'continuous', count: 1 },
    },
    legend: { displayName: { '0': 'Lower output', '1': 'Higher output' } },
    popup: {
      title: 'Panel',
      items: ['yearly_kwh', 'orientation'],
    },
    paint: {
      color: ['#2D3A4F', '#FF5A1F', '#FFC83D'],
      opacity: 0.92,
      strokeColor: '#0E1622',
      strokeWidth: 0.8,
    },
  }
}

/** Annual flux GeoTIFF: continuous raster ramp, band 1, legend. */
export function fluxRasterFsl(minFlux: number | null, maxFlux: number | null): Record<string, unknown> {
  const style: Record<string, unknown> = {
    version: '2.3',
    type: 'numeric',
    config:
      minFlux !== null && maxFlux !== null && maxFlux > minFlux
        ? { band: 1, steps: [minFlux, maxFlux] }
        : { band: 1 },
    legend: { displayName: { '0': 'Low sun', '1': 'High sun' } },
    paint: {
      isSandwiched: false,
      opacity: 0.85,
      color: FLUX_RAMP,
    },
  }
  return style
}

/** DSM GeoTIFF: hillshade relief (NW light, brand-subtle). */
export function dsmHillshadeFsl(): Record<string, unknown> {
  return {
    version: '2.3',
    type: 'hillshade',
    config: { band: 1 },
    legend: {},
    paint: { isSandwiched: false, source: 315, intensity: 0.7 },
  }
}

/** Plane markers: categorical sun-score colours (excellent → limited). */
export function planeMarkersFsl(): Record<string, unknown> {
  return {
    version: '2.3',
    type: 'categorical',
    config: {
      categoricalAttribute: 'sun_label',
      categories: [
        SUN_SCORE_COPY.excellent,
        SUN_SCORE_COPY.good,
        SUN_SCORE_COPY.moderate,
        SUN_SCORE_COPY.limited,
      ],
      labelAttribute: ['sun_label'],
    },
    legend: { displayName: 'auto' },
    popup: {
      title: 'Roof plane',
      items: ['orientation', 'pitch_degrees', 'area_m2', 'panels_count', 'sun_relative_pct'],
    },
    paint: {
      color: ['#FFC83D', '#FF7A45', '#FF5A1F', '#7A8699'],
      size: 12,
      opacity: 0.95,
      strokeColor: '#0E1622',
      strokeWidth: 1,
    },
    label: {
      color: '#FFFFFF',
      fontSize: 12,
      haloColor: '#0E1622',
      haloWidth: 1.5,
    },
  }
}

// ── Map metadata ──────────────────────────────────────────────────────

/**
 * PURE — the Felt map title. Deliberately NO customer name (the map URL
 * is unlisted-but-public, §4.10): suburb-level address fragment + system
 * size only.
 */
export function feltMapTitle(args: {
  state: string | null
  postcode: string | null
  systemKw: number | null
}): string {
  const where = [args.state, args.postcode].filter(Boolean).join(' ')
  const kw =
    typeof args.systemKw === 'number' && Number.isFinite(args.systemKw) && args.systemKw > 0
      ? `${args.systemKw.toFixed(1)} kW`
      : null
  return ['Solar estimate', where || null, kw].filter(Boolean).join(' — ')
}

/** PURE — headline panel count: the largest tier (page hero convention). */
export function headlinePanelCount(estimate: Pick<SolarEstimate, 'sizing'>): number | null {
  const tiers = estimate.sizing?.tiers ?? []
  const last = tiers[tiers.length - 1]
  return last?.panels_count ?? null
}

function round7(n: number): number {
  return Math.round(n * 1e7) / 1e7
}

export const __test_only__ = { M_PER_DEG_LAT, FLUX_RAMP }
