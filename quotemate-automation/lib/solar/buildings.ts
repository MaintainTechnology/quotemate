// ════════════════════════════════════════════════════════════════════
// Solar — property building detection (multi-roof building picker, A).
//
// A solar address can resolve to a property with several structures —
// the dwelling plus a shed / garage / granny flat. Google
// buildingInsights:findClosest only ever returns ONE building per point,
// so to let the customer/tradie pick which roof to estimate we first
// enumerate every structure on the property. Geoscape's measureAll
// (lib/roofing/providers/geoscape.ts) already does exactly this — primary
// dwelling + secondary structures, each with a footprint polygon, area,
// roof shape and storeys — so we reuse it and map the result into the
// lightweight DetectedBuilding shape the picker persists + renders.
//
// This is the CHEAP step (Geoscape only, ~6 credits, no Google Solar
// spend): we detect + outline up front and compute each building's full
// solar analysis lazily, only when it is actually selected.
//
// Degrades safely: no Geoscape key, a provider error, or ≤1 structure all
// resolve to "no picker" — the caller falls back to today's behaviour
// (estimate the building findClosest snaps to at the geocoded address).
//
// I/O (the Geoscape call) is injected so the mapping is fully unit-
// testable with no network. The mapping helpers are PURE and exported.
// ════════════════════════════════════════════════════════════════════

import { GeoscapeProvider } from '../roofing/providers/geoscape'
import type {
  GeoJSONPolygon,
  RoofAddressInput,
  RoofMeasuredBuilding,
  RoofingMultiMeasurementResult,
} from '../roofing/types'
import type { DetectedBuilding, LatLng, SolarAddressInput } from './types'

/** Footprint area (m²) below which a secondary structure is labelled an
 *  "Outbuilding" rather than a "Secondary building" (shed/garage scale). */
export const OUTBUILDING_MAX_AREA_M2 = 40

export type DetectPropertyBuildingsOpts = {
  /**
   * Injected Geoscape multi-structure measurement — defaults to a
   * GeoscapeProvider() bound to env GEOSCAPE_API_KEY. Override in tests.
   */
  measureAll?: (
    input: RoofAddressInput,
  ) => Promise<RoofingMultiMeasurementResult>
}

/**
 * Detect every structure on the property behind an address. Returns the
 * buildings ranked primary-first, each as a DetectedBuilding (lightweight
 * metadata only — full solar is computed lazily on selection).
 *
 * Returns [] when detection is unavailable or inconclusive (no key,
 * provider error, no measurable structure) — the caller treats [] as
 * "single-building path, hide the picker". A SINGLE detected building is
 * still returned (length 1) so the caller can decide whether to show the
 * picker; callers typically hide it below 2.
 */
export async function detectPropertyBuildings(
  input: SolarAddressInput,
  opts: DetectPropertyBuildingsOpts = {},
): Promise<DetectedBuilding[]> {
  const measureAll =
    opts.measureAll ??
    ((addr: RoofAddressInput) => new GeoscapeProvider().measureAll(addr))

  let result: RoofingMultiMeasurementResult
  try {
    result = await measureAll({
      address: input.address,
      postcode: input.postcode,
      state: input.state,
    })
  } catch {
    return []
  }

  if (!result.ok) return []
  return mapMeasuredBuildings(result.buildings)
}

// ── PURE mapping helpers (exported for unit testing) ──────────────────

/**
 * PURE — map Geoscape's measured structures into DetectedBuilding[].
 * Buildings without a derivable centroid (no footprint polygon) are
 * dropped — they cannot seed a Google Solar query. Labels are assigned
 * after filtering so the secondary numbering is contiguous.
 */
export function mapMeasuredBuildings(
  measured: RoofMeasuredBuilding[],
): DetectedBuilding[] {
  const out: DetectedBuilding[] = []
  let secondaryIndex = 0

  for (let i = 0; i < measured.length; i++) {
    const b = measured[i]
    const footprint = b.metrics.polygon_geojson
    const centroid = footprint ? polygonCentroid(footprint) : null
    if (!centroid) continue // no point to query Google Solar with — skip

    const area = b.metrics.footprint_m2 ?? null
    const isPrimary = b.role === 'primary'
    if (!isPrimary) secondaryIndex += 1

    out.push({
      building_id: b.buildingId ?? b.metrics.buildingId ?? `b${i}`,
      role: b.role,
      label: labelForBuilding({
        role: b.role,
        areaM2: area,
        secondaryIndex,
      }),
      centroid,
      footprint,
      area_m2: area,
      roof_shape: b.metrics.form ?? null,
      storeys: b.metrics.storeys ?? null,
      solar_status: 'pending',
    })
  }

  return out
}

/**
 * PURE — friendly picker label. Primary is the dwelling; secondaries are
 * numbered, with small footprints flagged as outbuildings (shed/garage
 * scale) rather than over-claiming a specific structure type.
 */
export function labelForBuilding(args: {
  role: 'primary' | 'secondary'
  areaM2: number | null
  /** 1-based index among the secondary structures. */
  secondaryIndex: number
}): string {
  if (args.role === 'primary') return 'Main building'
  const kind =
    args.areaM2 != null && args.areaM2 < OUTBUILDING_MAX_AREA_M2
      ? 'Outbuilding'
      : 'Secondary building'
  return `${kind} ${args.secondaryIndex}`
}

/**
 * PURE — area-weighted polygon centroid (EPSG:4326) via the shoelace
 * formula on the outer ring, projected to local metres so longitude
 * compression at AU latitudes does not skew the result. Falls back to the
 * vertex mean for degenerate rings. Returns null when the ring is unusable.
 *
 * The centroid is the point we feed to Google findClosest / dataLayers for
 * this building, so it must land INSIDE the footprint — the true area
 * centroid does for the convex-ish footprints Geoscape returns.
 */
export function polygonCentroid(polygon: GeoJSONPolygon | null): LatLng | null {
  const ring = polygon?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 3) return null

  // Mean latitude → local metre scale (equirectangular, exact enough at a
  // building's scale).
  let latSum = 0
  let n = 0
  for (const pt of ring) {
    if (Array.isArray(pt) && typeof pt[1] === 'number') {
      latSum += pt[1]
      n += 1
    }
  }
  if (n === 0) return null
  const lat0 = latSum / n
  const cos = Math.cos((lat0 * Math.PI) / 180)
  const mPerDegLat = 110_574
  const mPerDegLng = 111_320 * cos

  // Shoelace centroid in local metres.
  let area2 = 0 // 2× signed area
  let cx = 0
  let cy = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]
    const b = ring[i + 1]
    if (!Array.isArray(a) || !Array.isArray(b)) return vertexMean(ring)
    const x1 = a[0] * mPerDegLng
    const y1 = a[1] * mPerDegLat
    const x2 = b[0] * mPerDegLng
    const y2 = b[1] * mPerDegLat
    const cross = x1 * y2 - x2 * y1
    area2 += cross
    cx += (x1 + x2) * cross
    cy += (y1 + y2) * cross
  }

  if (Math.abs(area2) < 1e-9) return vertexMean(ring)
  const cxM = cx / (3 * area2)
  const cyM = cy / (3 * area2)
  return { lat: cyM / mPerDegLat, lng: cxM / mPerDegLng }
}

/** PURE — plain mean of ring vertices, the degenerate-ring fallback. */
function vertexMean(ring: number[][]): LatLng | null {
  let latSum = 0
  let lngSum = 0
  let n = 0
  for (const pt of ring) {
    if (Array.isArray(pt) && typeof pt[0] === 'number' && typeof pt[1] === 'number') {
      lngSum += pt[0]
      latSum += pt[1]
      n += 1
    }
  }
  if (n === 0) return null
  return { lat: latSum / n, lng: lngSum / n }
}
