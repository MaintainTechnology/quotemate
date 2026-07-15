// Roofing — property-specific candidate overlay for Measurement Results.
//
// This is deliberately a VISUAL FALLBACK, not semantic roof evidence. It uses
// the already-saved building footprint, roof form, and scalar hip/valley counts
// to compute review totals and draw restrained numbered zones over the real
// property aerial. A 2D footprint cannot
// locate true internal ridges, hips, valleys, or roof planes, so the output is
// never persisted, never sent to pricing, and is always labelled candidate-only.

import { layoutMapView } from './layout-overlay-svg'
import type { GeoJSONPolygon, RoofForm } from './types'

export const ROOF_CANDIDATE_KINDS = ['ridge', 'hip', 'valley', 'eave'] as const
export type RoofCandidateKind = (typeof ROOF_CANDIDATE_KINDS)[number]

export const ROOF_CANDIDATE_PRESENTATION: Record<
  RoofCandidateKind,
  { label: string; prefix: string; color: string }
> = {
  ridge: { label: 'Ridge', prefix: 'R', color: '#FF375F' },
  hip: { label: 'Hip', prefix: 'H', color: '#FF9F0A' },
  valley: { label: 'Valley', prefix: 'V', color: '#0A84FF' },
  eave: { label: 'Eave', prefix: 'E', color: '#30D158' },
}

export type RoofCandidateOverlayInput = {
  polygon: GeoJSONPolygon | null | undefined
  form: RoofForm
  hips: number | null | undefined
  valleys: number | null | undefined
  ridgeLm: number | null | undefined
  roofSegmentCount: number | null | undefined
  pitchDegrees: number | null | undefined
  /** Existing quote figures shown beside the guide lengths, never replaced. */
  hipEstimateLm?: number | null
  valleyEstimateLm?: number | null
}

export type RoofCandidateGuide = {
  kind: RoofCandidateKind
  number: number
  tag: string
  color: string
  planLengthM: number
  points: readonly [Point, Point]
}

export type RoofCandidateSummary = {
  kind: RoofCandidateKind
  label: string
  color: string
  /** Existing measured/derived scalar count, when the quote carries one. */
  reportedCount: number | null
  /** Guides that can be located from the 2D footprint. */
  locatedCount: number
  guidePlanLengthM: number
  existingEstimateLm: number | null
}

export type RoofCandidateOverlay = {
  mode: 'footprint_candidate'
  imageSrc: string
  svg: string
  facets: readonly { number: number; color: string }[]
  facetCount: number
  reportedFacetCount: number | null
  facetCountSource: 'solar_segment_count' | 'outline_visualisation'
  guides: readonly RoofCandidateGuide[]
  summaries: readonly RoofCandidateSummary[]
}

type Point = readonly [number, number]
type GeoPoint = readonly [number, number]
type ProjectedVertex = { geo: GeoPoint; point: Point }

const WIDTH = 640
const HEIGHT = 480
const TILE = 256
const MAX_VISUAL_FACETS = 24
const M_PER_DEG_LAT = 110_574
const FACET_COLORS = [
  '#F7C948',
  '#F97393',
  '#5B8DEF',
  '#D977E8',
  '#14B8A6',
  '#FF9F0A',
  '#A78BFA',
  '#22C55E',
] as const

const round1 = (value: number): number => Math.round(value * 10) / 10
const fmt = (value: number): string => (Math.round(value * 100) / 100).toString()

function finiteCount(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null
}

function finiteLength(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? round1(value)
    : null
}

function outerRing(polygon: GeoJSONPolygon | null | undefined): GeoPoint[] | null {
  const raw = polygon?.coordinates?.[0]
  if (!Array.isArray(raw) || raw.length < 4) return null

  const points: GeoPoint[] = []
  for (const coordinate of raw) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) continue
    const [lng, lat] = coordinate
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    points.push([lng, lat])
  }
  if (points.length < 4) return null

  const first = points[0]
  const last = points[points.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) points.pop()
  return points.length >= 3 ? points : null
}

function worldPx(lng: number, lat: number, zoom: number): Point {
  const size = TILE * Math.pow(2, zoom)
  const x = ((lng + 180) / 360) * size
  const sinLat = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999)
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * size
  return [x, y]
}

function projectRing(
  ring: readonly GeoPoint[],
  center: { lat: number; lng: number },
  zoom: number,
): ProjectedVertex[] | null {
  const [cx, cy] = worldPx(center.lng, center.lat, zoom)
  const projected = ring.map((geo): ProjectedVertex => {
    const [x, y] = worldPx(geo[0], geo[1], zoom)
    return { geo, point: [x - cx + WIDTH / 2, y - cy + HEIGHT / 2] }
  })
  return projected.every(({ point }) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    ? projected
    : null
}

function signedArea(points: readonly Point[]): number {
  let twiceArea = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    twiceArea += current[0] * next[1] - next[0] * current[1]
  }
  return twiceArea / 2
}

function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]
    const b = polygon[j]
    const crosses =
      (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    if (crosses) inside = !inside
  }
  return inside
}

function pointToSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(point[0] - a[0], point[1] - a[1])
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq),
  )
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy))
}

function polygonCentroid(points: readonly Point[]): Point | null {
  const area = signedArea(points)
  if (Math.abs(area) < 1e-6) return null
  let x = 0
  let y = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const cross = current[0] * next[1] - next[0] * current[1]
    x += (current[0] + next[0]) * cross
    y += (current[1] + next[1]) * cross
  }
  return [x / (6 * area), y / (6 * area)]
}

/** Find a stable point inside concave as well as convex footprints. */
function interiorPoint(points: readonly Point[]): Point {
  const centroid = polygonCentroid(points)
  if (centroid && pointInPolygon(centroid, points)) return centroid

  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  let best: Point | null = null
  let bestClearance = -1
  for (let xIndex = 1; xIndex < 12; xIndex += 1) {
    for (let yIndex = 1; yIndex < 12; yIndex += 1) {
      const point: Point = [
        minX + ((maxX - minX) * xIndex) / 12,
        minY + ((maxY - minY) * yIndex) / 12,
      ]
      if (!pointInPolygon(point, points)) continue
      const clearance = Math.min(
        ...points.map((vertex, index) =>
          pointToSegmentDistance(point, vertex, points[(index + 1) % points.length]),
        ),
      )
      if (clearance > bestClearance) {
        best = point
        bestClearance = clearance
      }
    }
  }
  return best ?? points[0]
}

function principalDirection(points: readonly Point[], center: Point): Point {
  let xx = 0
  let xy = 0
  let yy = 0
  for (const point of points) {
    const x = point[0] - center[0]
    const y = point[1] - center[1]
    xx += x * x
    xy += x * y
    yy += y * y
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy)
  const direction: Point = [Math.cos(angle), Math.sin(angle)]
  return Number.isFinite(direction[0]) && Number.isFinite(direction[1])
    ? direction
    : [1, 0]
}

function cross(a: Point, b: Point): number {
  return a[0] * b[1] - a[1] * b[0]
}

/** Parameter t where center + t*direction intersects a finite polygon edge. */
function lineEdgeIntersectionT(
  center: Point,
  direction: Point,
  edgeStart: Point,
  edgeEnd: Point,
): number | null {
  const edge: Point = [edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]]
  const offset: Point = [edgeStart[0] - center[0], edgeStart[1] - center[1]]
  const denominator = cross(direction, edge)
  if (Math.abs(denominator) < 1e-8) return null
  const t = cross(offset, edge) / denominator
  const u = cross(offset, direction) / denominator
  return u >= -1e-7 && u <= 1 + 1e-7 ? t : null
}

function axisSpan(
  center: Point,
  direction: Point,
  points: readonly Point[],
): readonly [number, number] | null {
  const intersections: number[] = []
  for (let index = 0; index < points.length; index += 1) {
    const t = lineEdgeIntersectionT(
      center,
      direction,
      points[index],
      points[(index + 1) % points.length],
    )
    if (t !== null && Number.isFinite(t)) intersections.push(t)
  }
  const negative = intersections.filter((value) => value < -1e-5).sort((a, b) => b - a)[0]
  const positive = intersections.filter((value) => value > 1e-5).sort((a, b) => a - b)[0]
  return negative !== undefined && positive !== undefined ? [negative, positive] : null
}

function pointOnAxis(center: Point, direction: Point, distance: number): Point {
  return [center[0] + direction[0] * distance, center[1] + direction[1] * distance]
}

function closestPointOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return a
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq),
  )
  return [a[0] + t * dx, a[1] + t * dy]
}

/** Internal candidate guides must remain inside the roof footprint. Sampling
 *  avoids drawing a straight chord across a courtyard/notch on concave roofs.
 *  Endpoints may sit on the boundary, so only the open segment is tested. */
function segmentInsidePolygon(
  segment: readonly [Point, Point],
  polygon: readonly Point[],
): boolean {
  const [start, end] = segment
  for (let step = 1; step < 24; step += 1) {
    const t = step / 24
    const point: Point = [
      start[0] + (end[0] - start[0]) * t,
      start[1] + (end[1] - start[1]) * t,
    ]
    if (!pointInPolygon(point, polygon)) return false
  }
  return true
}

function vertexKinds(points: readonly Point[]): { convex: number[]; reflex: number[] } {
  const orientation = Math.sign(signedArea(points)) || 1
  const convex: number[] = []
  const reflex: number[] = []
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length]
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const incoming: Point = [current[0] - previous[0], current[1] - previous[1]]
    const outgoing: Point = [next[0] - current[0], next[1] - current[1]]
    const denominator = Math.hypot(...incoming) * Math.hypot(...outgoing)
    if (denominator < 1e-6) continue
    const normalizedTurn = cross(incoming, outgoing) / denominator
    if (Math.abs(normalizedTurn) < 0.18) continue
    if (Math.sign(normalizedTurn) === orientation) convex.push(index)
    else reflex.push(index)
  }
  return { convex, reflex }
}

function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)
}

function pointDistanceM(a: Point, b: Point, metresPerPx: number): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]) * metresPerPx
}

function geographicLengthM(a: GeoPoint, b: GeoPoint): number {
  const lat = (a[1] + b[1]) / 2
  const x = (b[0] - a[0]) * 111_320 * Math.cos((lat * Math.PI) / 180)
  const y = (b[1] - a[1]) * M_PER_DEG_LAT
  return Math.hypot(x, y)
}

function sampleIndices(indices: readonly number[], count: number): number[] {
  if (count <= 0 || indices.length === 0) return []
  if (count >= indices.length) return [...indices]
  const sampled: number[] = []
  for (let index = 0; index < count; index += 1) {
    sampled.push(indices[Math.floor((index * indices.length) / count)])
  }
  return [...new Set(sampled)]
}

function eaveEdgeIndices(vertices: readonly ProjectedVertex[], form: RoofForm): number[] {
  const all = vertices.map((_vertex, index) => index)
  if (form !== 'gable') return all

  // Gable roofs have two long eaves; the short ends are rakes, not gutters.
  return all
    .map((index) => ({
      index,
      length: geographicLengthM(
        vertices[index].geo,
        vertices[(index + 1) % vertices.length].geo,
      ),
    }))
    .sort((a, b) => b.length - a.length)
    .slice(0, 2)
    .map(({ index }) => index)
}

function pointsAttribute(points: readonly Point[]): string {
  return points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ')
}

function buildGuides(
  input: RoofCandidateOverlayInput,
  vertices: readonly ProjectedVertex[],
  center: Point,
  direction: Point,
  zoom: number,
): RoofCandidateGuide[] {
  const points = vertices.map(({ point }) => point)
  const perPx = metresPerPixel(
    vertices.reduce((sum, vertex) => sum + vertex.geo[1], 0) / vertices.length,
    zoom,
  )
  const span = axisSpan(center, direction, points)
  const explicitRidgeLength = finiteLength(input.ridgeLm)
  const shouldDrawRidge = explicitRidgeLength === 0
    ? false
    : explicitRidgeLength !== null
      ? explicitRidgeLength > 0
      : input.form === 'gable' || input.form === 'hip' || input.form === 'gable_hip'
  let ridge: readonly [Point, Point] | null = null
  if (span && shouldDrawRidge) {
    const inset = input.form === 'gable' ? 0.08 : input.form === 'hip' ? 0.28 : 0.2
    ridge = [
      pointOnAxis(center, direction, span[0] * (1 - inset)),
      pointOnAxis(center, direction, span[1] * (1 - inset)),
    ]
  }

  const guides: RoofCandidateGuide[] = []
  const pushGuide = (kind: RoofCandidateKind, points: readonly [Point, Point], lengthM?: number) => {
    if (kind !== 'eave' && !segmentInsidePolygon(points, vertices.map((vertex) => vertex.point))) {
      return
    }
    const number = guides.filter((guide) => guide.kind === kind).length + 1
    const presentation = ROOF_CANDIDATE_PRESENTATION[kind]
    guides.push({
      kind,
      number,
      tag: `${presentation.prefix}-${String(number).padStart(2, '0')}`,
      color: presentation.color,
      planLengthM: round1(lengthM ?? pointDistanceM(points[0], points[1], perPx)),
      points,
    })
  }

  if (ridge) pushGuide('ridge', ridge)

  const kinds = vertexKinds(points)
  const hipCount = finiteCount(input.hips) ?? 0
  const valleyCount = finiteCount(input.valleys) ?? 0
  for (const vertexIndex of sampleIndices(kinds.convex, hipCount)) {
    const vertex = points[vertexIndex]
    let target = center
    if (ridge) {
      const projection =
        (vertex[0] - center[0]) * direction[0] + (vertex[1] - center[1]) * direction[1]
      target = projection < 0 ? ridge[0] : ridge[1]
    }
    pushGuide('hip', [target, vertex])
  }

  for (const vertexIndex of sampleIndices(kinds.reflex, valleyCount)) {
    const vertex = points[vertexIndex]
    const target = ridge ? closestPointOnSegment(vertex, ridge[0], ridge[1]) : center
    pushGuide('valley', [vertex, target])
  }

  for (const edgeIndex of eaveEdgeIndices(vertices, input.form)) {
    const nextIndex = (edgeIndex + 1) % vertices.length
    pushGuide(
      'eave',
      [vertices[edgeIndex].point, vertices[nextIndex].point],
      geographicLengthM(vertices[edgeIndex].geo, vertices[nextIndex].geo),
    )
  }

  return guides
}

function rayDistance(center: Point, direction: Point, polygon: readonly Point[]): number {
  const distances: number[] = []
  for (let index = 0; index < polygon.length; index += 1) {
    const t = lineEdgeIntersectionT(
      center,
      direction,
      polygon[index],
      polygon[(index + 1) % polygon.length],
    )
    if (t !== null && t > 0) distances.push(t)
  }
  return distances.length > 0 ? Math.min(...distances) : 0
}

function facetSvg(
  polygon: readonly Point[],
  center: Point,
  direction: Point,
  count: number,
): string {
  if (count === 1) {
    const badge = center
    return (
      `<g clip-path="url(#roof-candidate-clip)">` +
        `<polygon data-facet="1" points="${pointsAttribute(polygon)}" ` +
          `fill="${FACET_COLORS[0]}" fill-opacity="0.3" stroke="${FACET_COLORS[0]}" ` +
          `stroke-opacity="0.28" stroke-width="0.6"/>` +
      `</g>` +
      `<g data-facet-badge="1" transform="translate(${fmt(badge[0])} ${fmt(badge[1])})">` +
        `<circle r="5.4" fill="#FFFFFF" fill-opacity="0.88" stroke="#0A1628" ` +
          `stroke-opacity="0.5" stroke-width="0.55"/>` +
        `<text text-anchor="middle" dominant-baseline="central" fill="#0A1628" ` +
          `font-size="5.2" font-weight="700" font-family="ui-monospace, monospace">01</text>` +
      `</g>`
    )
  }

  const radius = Math.hypot(WIDTH, HEIGHT) * 1.5
  const baseAngle = Math.atan2(direction[1], direction[0])
  const sectors: string[] = []
  const badges: string[] = []
  for (let index = 0; index < count; index += 1) {
    const start = baseAngle + (index * Math.PI * 2) / count
    const end = baseAngle + ((index + 1) * Math.PI * 2) / count
    const middle = (start + end) / 2
    const a: Point = [center[0] + Math.cos(start) * radius, center[1] + Math.sin(start) * radius]
    const b: Point = [center[0] + Math.cos(end) * radius, center[1] + Math.sin(end) * radius]
    // A 180° sector (the common two-plane gable case) needs an extra far
    // midpoint; center/a/b alone are collinear and would produce no fill.
    const sectorPoints: readonly Point[] = count === 2
      ? [
          center,
          a,
          [
            center[0] + Math.cos(middle) * radius * 1.6,
            center[1] + Math.sin(middle) * radius * 1.6,
          ],
          b,
        ]
      : [center, a, b]
    sectors.push(
      `<polygon data-facet="${index + 1}" points="${pointsAttribute(sectorPoints)}" ` +
        `fill="${FACET_COLORS[index % FACET_COLORS.length]}" fill-opacity="0.3" ` +
        `stroke="${FACET_COLORS[index % FACET_COLORS.length]}" stroke-opacity="0.28" stroke-width="0.6"/>`,
    )

    const badgeDirection: Point = [Math.cos(middle), Math.sin(middle)]
    const boundary = rayDistance(center, badgeDirection, polygon)
    const factor = index % 2 === 0 ? 0.58 : 0.72
    const badge: Point = [
      center[0] + badgeDirection[0] * boundary * factor,
      center[1] + badgeDirection[1] * boundary * factor,
    ]
    badges.push(
      `<g data-facet-badge="${index + 1}" transform="translate(${fmt(badge[0])} ${fmt(badge[1])})">` +
        `<circle r="5.4" fill="#FFFFFF" fill-opacity="0.88" stroke="#0A1628" ` +
          `stroke-opacity="0.5" stroke-width="0.55"/>` +
        `<text text-anchor="middle" dominant-baseline="central" fill="#0A1628" ` +
        `font-size="5.2" font-weight="700" font-family="ui-monospace, monospace">${String(index + 1).padStart(2, '0')}</text>` +
      `</g>`,
    )
  }
  return `<g clip-path="url(#roof-candidate-clip)">${sectors.join('')}</g>${badges.join('')}`
}

function imageDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function buildRoofCandidateOverlay(
  input: RoofCandidateOverlayInput,
): RoofCandidateOverlay | null {
  const ring = outerRing(input.polygon)
  if (!ring) return null

  const view = layoutMapView(
    [{ polygon: input.polygon, form: input.form }],
    { width: WIDTH, height: HEIGHT },
  )
  if (!view) return null

  const vertices = projectRing(ring, view.center, view.zoom)
  if (!vertices) return null
  const polygon = vertices.map(({ point }) => point)
  const center = interiorPoint(polygon)
  const direction = principalDirection(polygon, center)
  const suppliedSegments = finiteCount(input.roofSegmentCount)
  const facetCount = Math.min(
    MAX_VISUAL_FACETS,
    Math.max(1, suppliedSegments && suppliedSegments > 0 ? suppliedSegments : polygon.length),
  )
  const facetCountSource = suppliedSegments && suppliedSegments > 0
    ? 'solar_segment_count' as const
    : 'outline_visualisation' as const
  const guides = buildGuides(input, vertices, center, direction, view.zoom)
  const polygonPoints = pointsAttribute(polygon)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" ` +
      `width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="Footprint-derived roof candidate overlay">` +
      `<defs><clipPath id="roof-candidate-clip"><polygon points="${polygonPoints}"/></clipPath></defs>` +
      facetSvg(polygon, center, direction, facetCount) +
      `<polygon data-roof-outline="true" points="${polygonPoints}" fill="none" ` +
        `stroke="#FFFFFF" stroke-opacity="0.38" stroke-width="0.7"/>` +
    `</svg>`

  const summaries = ROOF_CANDIDATE_KINDS.map((kind): RoofCandidateSummary => {
    const kindGuides = guides.filter((guide) => guide.kind === kind)
    const reportedCount =
      kind === 'hip' ? finiteCount(input.hips) :
      kind === 'valley' ? finiteCount(input.valleys) :
      null
    const existingEstimateLm =
      kind === 'ridge' ? finiteLength(input.ridgeLm) :
      kind === 'hip' ? finiteLength(input.hipEstimateLm) :
      kind === 'valley' ? finiteLength(input.valleyEstimateLm) :
      null
    return {
      kind,
      label: ROOF_CANDIDATE_PRESENTATION[kind].label,
      color: ROOF_CANDIDATE_PRESENTATION[kind].color,
      reportedCount,
      locatedCount: kindGuides.length,
      guidePlanLengthM: round1(
        kindGuides.reduce((sum, guide) => sum + guide.planLengthM, 0),
      ),
      existingEstimateLm,
    }
  })

  return {
    mode: 'footprint_candidate',
    imageSrc: imageDataUri(svg),
    svg,
    facets: Array.from({ length: facetCount }, (_value, index) => ({
      number: index + 1,
      color: FACET_COLORS[index % FACET_COLORS.length],
    })),
    facetCount,
    reportedFacetCount: suppliedSegments && suppliedSegments > 0 ? suppliedSegments : null,
    facetCountSource,
    guides,
    summaries,
  }
}
