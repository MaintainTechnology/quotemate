// ════════════════════════════════════════════════════════════════════
// Roofing — standalone coloured roof OUTLINE tracing for the customer
// quote PDF (spec specs/roof-pdf-outline-tracing.md).
//
// The live dashboard tracing (app/dashboard/roofing/_components/RoofMap.tsx)
// is MapLibre vector layers composited over satellite tiles and is never
// exported. The quote PDF used to embed a bare Google satellite crop with a
// caption that falsely claimed an outline. This module redraws the SAME
// tracing — filled footprint + outline + classified coloured edges — from the
// stored polygon geometry as a self-contained inline SVG on a PLAIN white
// background, so the PDF leads with a clean drawing instead of an aerial photo.
//
// PURE — no I/O. Reuses lib/roofing/map-utils.ts for the geometry (polygonBBox)
// and edge classification (classifyEdges); the lng/lat→pixel projection mirrors
// map-utils' equirectangular model (edgeLengthM) so distances stay consistent.
//
// White-eave caveat: the dashboard colours eaves #FFFFFF because it draws over
// DARK satellite tiles. On the white PDF page a pure-white edge is invisible,
// so every classified edge is drawn over a thin dark "casing" line first — a
// standard cartographic technique that keeps the exact palette while making the
// white edges legible on white. No colour is changed (spec R2 + R4 reconciled).
// ════════════════════════════════════════════════════════════════════

import type { GeoJSONPolygon, RoofForm } from './types'
import { classifyEdges, polygonBBox, type EdgeKind, type LngLat } from './map-utils'

/** One structure to draw: its footprint polygon, roof form (for edge
 *  classification) and whether it's included/priced (solid) or excluded
 *  (faint + dashed). */
export type RoofOutlineStructure = {
  polygon: GeoJSONPolygon | null | undefined
  form: RoofForm
  included: boolean
}

export type RoofOutlineOptions = {
  width: number
  height: number
  /** Fraction of the canvas reserved as padding on each side. Default 0.1. */
  padFrac?: number
}

// ── Palette (matches RoofMap.tsx) ────────────────────────────────────
const FILL = '#FFC400'
const OUTLINE = '#FFC400'
const EXCLUDED = '#7A8699'
/** Dark ink casing drawn under each coloured edge so white eaves read on white. */
const CASING = '#2B2422'
const EDGE_COLORS: Record<EdgeKind, string> = {
  eave: '#FFFFFF',
  ridge: '#FFD23D',
  hip: '#FFC400',
  valley: '#14B8A6',
  unknown: '#7A8699',
}

// Equirectangular metres-per-degree (same constants as map-utils.edgeLengthM).
const M_PER_DEG_LAT = 110_574
const M_PER_DEG_LNG_EQUATOR = 111_320

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

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString()

/**
 * Build the inline `<svg>` markup for the roof outline tracing, or `null` when
 * no structure carries usable geometry. All drawn structures share one combined
 * bounding box / coordinate frame so their relative position and scale are
 * correct. Excluded structures render first (faint, dashed); included
 * structures render on top (fill + outline + classified coloured edges).
 */
export function buildRoofOutlineSvg(
  structures: readonly RoofOutlineStructure[],
  opts: RoofOutlineOptions,
): string | null {
  const W = opts.width
  const H = opts.height
  const pad = opts.padFrac ?? 0.1

  // Validate geometry once; keep the original polygon for classifyEdges.
  const items = (structures ?? [])
    .map((s) => ({ ring: outerRing(s.polygon), polygon: s.polygon!, form: s.form, included: s.included }))
    .filter((s): s is { ring: LngLat[]; polygon: GeoJSONPolygon; form: RoofForm; included: boolean } =>
      s.ring != null,
    )
  if (items.length === 0) return null

  // Union bounding box across every drawn structure (reuses polygonBBox).
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const it of items) {
    const bb = polygonBBox(it.polygon)
    if (!bb) continue
    if (bb.west < west) west = bb.west
    if (bb.east > east) east = bb.east
    if (bb.south < south) south = bb.south
    if (bb.north > north) north = bb.north
  }
  if (!Number.isFinite(west) || !Number.isFinite(north)) return null

  const latMid = (north + south) / 2
  const mPerDegLng = M_PER_DEG_LNG_EQUATOR * Math.cos((latMid * Math.PI) / 180)
  const widthM = (east - west) * mPerDegLng
  const heightM = (north - south) * M_PER_DEG_LAT
  if (widthM <= 0 && heightM <= 0) return null

  // Fit metres → canvas, aspect-ratio-preserving, padded, centred.
  const availW = W * (1 - 2 * pad)
  const availH = H * (1 - 2 * pad)
  const scale = Math.min(
    widthM > 0 ? availW / widthM : Infinity,
    heightM > 0 ? availH / heightM : Infinity,
  )
  if (!Number.isFinite(scale) || scale <= 0) return null
  const drawnW = widthM * scale
  const drawnH = heightM * scale
  const offX = (W - drawnW) / 2
  const offY = (H - drawnH) / 2

  // North-up: y grows downward from the northern edge (negated latitude).
  const project = ([lng, lat]: LngLat): [number, number] | null => {
    const x = offX + (lng - west) * mPerDegLng * scale
    const y = offY + (north - lat) * M_PER_DEG_LAT * scale
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
  }

  const pointsAttr = (ring: LngLat[]): string | null => {
    const xy = ring.map(project).filter((p): p is [number, number] => p != null)
    if (xy.length < 3) return null
    return xy.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ')
  }

  const excludedSvg: string[] = []
  const includedSvg: string[] = []

  for (const it of items) {
    const pts = pointsAttr(it.ring)
    if (!pts) continue

    if (!it.included) {
      // Faint, dashed — present for context, never the focus.
      excludedSvg.push(
        `<polygon points="${pts}" fill="${EXCLUDED}" fill-opacity="0.05" ` +
          `stroke="${EXCLUDED}" stroke-width="1.5" stroke-dasharray="6 5" ` +
          `stroke-linejoin="round" opacity="0.7"/>`,
      )
      continue
    }

    // Footprint fill + outline.
    includedSvg.push(
      `<polygon points="${pts}" fill="${FILL}" fill-opacity="0.18" ` +
        `stroke="${OUTLINE}" stroke-width="2.5" stroke-linejoin="round"/>`,
    )

    // Classified coloured edges (4px) over a dark casing (5.5px) for legibility.
    for (const edge of classifyEdges(it.polygon, it.form)) {
      const a = project(edge.from)
      const b = project(edge.to)
      if (!a || !b) continue
      const coords = `x1="${fmt(a[0])}" y1="${fmt(a[1])}" x2="${fmt(b[0])}" y2="${fmt(b[1])}"`
      includedSvg.push(`<line ${coords} stroke="${CASING}" stroke-width="5.5" stroke-linecap="round"/>`)
      includedSvg.push(
        `<line ${coords} stroke="${EDGE_COLORS[edge.kind]}" stroke-width="4" stroke-linecap="round"/>`,
      )
    }
  }

  if (excludedSvg.length === 0 && includedSvg.length === 0) return null

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#FFFFFF"/>` +
    excludedSvg.join('') +
    includedSvg.join('') +
    `</svg>`
  )
}

/**
 * The roof outline tracing as a `data:image/svg+xml;base64,…` URI ready to drop
 * into an `<img src>`, or `null` when there's no usable geometry. Self-contained
 * — no network fetch, no `prepareImage()` re-encoding needed.
 */
export function roofOutlineImageSrc(
  structures: readonly RoofOutlineStructure[],
  opts: RoofOutlineOptions,
): string | null {
  const svg = buildRoofOutlineSvg(structures, opts)
  if (!svg) return null
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}
