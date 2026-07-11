// ════════════════════════════════════════════════════════════════════
// Roofing — deterministic colour-coded work-zone overlay for the AI layout
// plan (spec specs/quote-visual-parity.md R6d).
//
// Draws the parsed LayoutPlan zones OVER the Google static-map aerial as a
// transparent inline SVG, styled after the reference roof-layout map: the
// subject roof is tinted so it pops from the aerial, each zone draws as a
// colour-coded border (structure outline / dilated perimeter ring / ridge
// line / small point marker), and every zone's label renders as a white
// callout box with a matching coloured border stacked down the left/right
// margins. The SVG and the map agree on one centre + zoom, so zone geometry
// (from the stored footprint polygons) lands on the right pixels — the same
// contract as the solar overlays (app/q/solar/[token]/BuildingPicker.tsx +
// lib/solar/static-map-center.ts).
//
// PURE — no I/O, no AI. Zone SEMANTICS (labels, colours, and the rough
// position of 'point' features the model can SEE on the aerial) come from
// the LLM plan; every drawn coordinate is computed here, and point markers
// are clamped into the structure's projected footprint so a mis-localised
// marker can never land off the roof.
// ════════════════════════════════════════════════════════════════════

import type { GeoJSONPolygon, RoofForm } from './types'
import { classifyEdges, type LngLat } from './map-utils'
import { ZONE_COLOR_HEX, type LayoutZone } from './layout-plan'

export type LayoutOverlayStructure = {
  polygon: GeoJSONPolygon | null | undefined
  form: RoofForm
}

export type LayoutOverlayArgs = {
  zones: readonly LayoutZone[]
  /** Index-aligned with the plan's 1-based structureIndex (index 0 = structure 1). */
  structures: readonly LayoutOverlayStructure[]
  /** The static map's centre + zoom — MUST match the underlying image. */
  center: { lat: number; lng: number }
  zoom: number
  width: number
  height: number
}

/** Dark casing under every coloured stroke so light colours read on light roofs. */
const CASING = '#1F2937'
/** Slate-blue roof tint (the reference map's masked-roof look). */
const TINT = '#5B7B8C'

const TILE = 256

// Hairline zone borders — visible over the aerial without reading chunky.
const CASING_W = 3.5
const STROKE_W = 2.5
/** Inward offset (px) between stacked 'structure' outlines on one building,
 *  so a later zone never paints over an earlier one. */
const STACK_INSET_PX = 7

// ── Label callout metrics ────────────────────────────────────────────
const BOX_W = 186
const BOX_PAD = 8
const LINE_H = 15
const FONT_PX = 11.5
const WRAP_CHARS = 26
const MAX_LINES = 4

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString()

/** XML-escape text rendered into the SVG (labels are model-authored). */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Word-wrap a label into ≤ MAX_LINES display lines. */
function wrapLabel(label: string): string[] {
  const words = label.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w
    if (candidate.length <= WRAP_CHARS) {
      line = candidate
    } else {
      if (line) lines.push(line)
      line = w.length > WRAP_CHARS ? w.slice(0, WRAP_CHARS - 1) + '…' : w
    }
  }
  if (line) lines.push(line)
  if (lines.length > MAX_LINES) {
    lines.length = MAX_LINES
    lines[MAX_LINES - 1] = lines[MAX_LINES - 1].replace(/…?$/, '…')
  }
  return lines
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

/** Google-tile Web-Mercator world pixel for a lng/lat at a zoom level. */
function worldPx(lng: number, lat: number, zoom: number): [number, number] {
  const size = TILE * Math.pow(2, zoom)
  const x = ((lng + 180) / 360) * size
  const sinLat = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999)
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * size
  return [x, y]
}

type Pt = [number, number]

const pointsAttr = (pts: Pt[]): string => pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ')

const centroidOf = (pts: Pt[]): Pt => [
  pts.reduce((s, p) => s + p[0], 0) / pts.length,
  pts.reduce((s, p) => s + p[1], 0) / pts.length,
]

/** Move every vertex a FIXED pixel distance along its centroid ray —
 *  positive = outward (dilate), negative = inward (inset). A fractional
 *  scale factor pushed the far wings of large L-shaped roofs much further
 *  than near ones (the misaligned-borders report). */
function offsetRing(pts: Pt[], px: number): Pt[] {
  const [cx, cy] = centroidOf(pts)
  return pts.map(([x, y]) => {
    const dist = Math.hypot(x - cx, y - cy)
    if (dist < 1e-6) return [x, y] as Pt
    const k = Math.max(0.2, (dist + px) / dist)
    return [cx + (x - cx) * k, cy + (y - cy) * k] as Pt
  })
}

export type LayoutMapView = { center: { lat: number; lng: number }; zoom: number }

/**
 * The ONE centre + integer zoom that frames EVERY measured structure inside a
 * width×height static map (15% padding), clamped to zoom 15–20. The Google
 * image request and the SVG overlay must both use this so they stay aligned —
 * a fixed close-up zoom cropped multi-structure properties. Null when no
 * structure carries geometry (callers fall back to the address-centred map).
 */
export function layoutMapView(
  structures: readonly LayoutOverlayStructure[],
  opts: { width: number; height: number; maxZoom?: number; minZoom?: number },
): LayoutMapView | null {
  const maxZoom = opts.maxZoom ?? 20
  const minZoom = opts.minZoom ?? 15
  const pts: Pt[] = []
  for (const s of structures) {
    const ring = outerRing(s.polygon)
    if (!ring) continue
    for (const [lng, lat] of ring) pts.push(worldPx(lng, lat, 0))
  }
  if (pts.length === 0) return null

  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  // Spans at zoom 0 scale by 2^z — pick the largest integer zoom that fits
  // both axes with padding.
  const spanX = Math.max(maxX - minX, 1e-9)
  const spanY = Math.max(maxY - minY, 1e-9)
  const usableW = opts.width * 0.7
  const usableH = opts.height * 0.7
  const zFit = Math.floor(Math.log2(Math.min(usableW / spanX, usableH / spanY)))
  const zoom = Math.min(maxZoom, Math.max(minZoom, zFit))

  // Inverse Web-Mercator of the bbox midpoint.
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  const lng = (midX / TILE) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * midY) / TILE))) * 180) / Math.PI
  return { center: { lat, lng }, zoom }
}

/**
 * Transparent SVG overlay for the layout plan, or null when no zone has
 * usable geometry. placement semantics:
 *   'structure' — the footprint outline in the zone colour
 *   'perimeter' — the footprint dilated outward (scaffolding / edge works)
 *   'ridge'     — the classified ridge edges (fallback: bbox major axis)
 *   'point'     — a small marker at the model-localised x_pct/y_pct,
 *                 clamped inside the structure's projected footprint bbox
 * Every zone also renders its label as a bordered callout box stacked down
 * the margin nearest to its geometry.
 */
export function buildLayoutOverlaySvg(args: LayoutOverlayArgs): string | null {
  const { zones, structures, center, zoom, width: W, height: H } = args
  if (!zones.length || !structures.length) return null

  const [cx, cy] = worldPx(center.lng, center.lat, zoom)
  const project = ([lng, lat]: LngLat): Pt | null => {
    const [x, y] = worldPx(lng, lat, zoom)
    const px = x - cx + W / 2
    const py = y - cy + H / 2
    return Number.isFinite(px) && Number.isFinite(py) ? [px, py] : null
  }

  // Project each structure's footprint ring once.
  const projectedRings: Array<Pt[] | null> = structures.map((s) => {
    const ring = outerRing(s.polygon)
    if (!ring) return null
    const pts = ring.map(project).filter((p): p is Pt => p != null)
    return pts.length >= 3 ? pts : null
  })

  const tinted = new Set<number>()
  const geometry: string[] = []
  const markers: string[] = []
  const labelSpecs: Array<{ hex: string; label: string; anchor: Pt }> = []

  const strokedPolygon = (pts: Pt[], hex: string, dash?: string): void => {
    const attr = pointsAttr(pts)
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : ''
    geometry.push(
      `<polygon points="${attr}" fill="none" stroke="${CASING}" stroke-width="${CASING_W}" stroke-linejoin="round"${dashAttr}/>`,
    )
    geometry.push(
      `<polygon points="${attr}" fill="none" stroke="${hex}" stroke-width="${STROKE_W}" stroke-linejoin="round"${dashAttr}/>`,
    )
  }

  const strokedLine = (a: Pt, b: Pt, hex: string): void => {
    const coords = `x1="${fmt(a[0])}" y1="${fmt(a[1])}" x2="${fmt(b[0])}" y2="${fmt(b[1])}"`
    geometry.push(`<line ${coords} stroke="${CASING}" stroke-width="${CASING_W}" stroke-linecap="round"/>`)
    geometry.push(`<line ${coords} stroke="${hex}" stroke-width="${STROKE_W}" stroke-linecap="round"/>`)
  }

  // Count 'structure' outlines already drawn per building — each subsequent
  // one insets inward so stacked zone colours all stay visible.
  const structureOutlines = new Map<number, number>()

  for (const zone of zones) {
    const projected = projectedRings[zone.structureIndex - 1]
    if (!projected) continue
    const hex = ZONE_COLOR_HEX[zone.color]
    tinted.add(zone.structureIndex - 1)
    let anchor: Pt = centroidOf(projected)

    if (zone.placement === 'structure') {
      const stacked = structureOutlines.get(zone.structureIndex) ?? 0
      structureOutlines.set(zone.structureIndex, stacked + 1)
      const ring = stacked > 0 ? offsetRing(projected, -STACK_INSET_PX * stacked) : projected
      strokedPolygon(ring, hex)
    } else if (zone.placement === 'perimeter') {
      // Fixed ~10px outside the footprint — reads as "around the work area",
      // not the roof itself.
      strokedPolygon(offsetRing(projected, 10), hex, '10 6')
    } else if (zone.placement === 'point') {
      // Model-localised feature, clamped into the footprint's bbox so a bad
      // localisation can never mark the neighbour's yard.
      const xs = projected.map((p) => p[0])
      const ys = projected.map((p) => p[1])
      const inset = 6
      const minX = Math.min(...xs) + inset
      const maxX = Math.max(...xs) - inset
      const minY = Math.min(...ys) + inset
      const maxY = Math.max(...ys) - inset
      const px = Math.min(Math.max(((zone.x_pct ?? 50) / 100) * W, minX), Math.max(minX, maxX))
      const py = Math.min(Math.max(((zone.y_pct ?? 50) / 100) * H, minY), Math.max(minY, maxY))
      const mw = 22
      const mh = 14
      markers.push(
        `<rect data-zone-point="1" x="${fmt(px - mw / 2)}" y="${fmt(py - mh / 2)}" width="${mw}" height="${mh}" ` +
          `fill="${hex}" fill-opacity="0.85" stroke="${CASING}" stroke-width="2"/>`,
      )
      anchor = [px, py]
    } else {
      // 'ridge' — classified ridge edges from stored geometry; fallback to the
      // footprint's major axis through the centroid.
      const structure = structures[zone.structureIndex - 1]
      const ridges = structure.polygon
        ? classifyEdges(structure.polygon, structure.form).filter((e) => e.kind === 'ridge')
        : []
      let drew = false
      for (const edge of ridges) {
        const a = project(edge.from)
        const b = project(edge.to)
        if (!a || !b) continue
        strokedLine(a, b, hex)
        if (!drew) anchor = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        drew = true
      }
      if (!drew) {
        const xs = projected.map((p) => p[0])
        const ys = projected.map((p) => p[1])
        const minX = Math.min(...xs)
        const maxX = Math.max(...xs)
        const minY = Math.min(...ys)
        const maxY = Math.max(...ys)
        const cxp = (minX + maxX) / 2
        const cyp = (minY + maxY) / 2
        const horizontal = maxX - minX >= maxY - minY
        const half = 0.3 * (horizontal ? maxX - minX : maxY - minY)
        const a: Pt = horizontal ? [cxp - half, cyp] : [cxp, cyp - half]
        const b: Pt = horizontal ? [cxp + half, cyp] : [cxp, cyp + half]
        strokedLine(a, b, hex)
        anchor = [cxp, cyp]
      }
    }

    labelSpecs.push({ hex, label: zone.label, anchor })
  }

  if (geometry.length === 0 && markers.length === 0) return null

  // Roof tint — only the structures the plan actually zones, drawn UNDER the
  // zone borders (the reference map's highlighted-roof look).
  const tints = [...tinted]
    .map((i) => projectedRings[i])
    .filter((r): r is Pt[] => r != null)
    .map(
      (r) =>
        `<polygon points="${pointsAttr(r)}" fill="${TINT}" fill-opacity="0.4" stroke="none"/>`,
    )

  // Label callouts — QuoteMax Command Centre language: charcoal ink card,
  // 4px zone-colour accent bar on the left edge, mono uppercase ZONE number
  // (ties each callout to the numbered legend below), off-white label text.
  // Alternating left/right columns with even vertical distribution, spilling
  // to the other margin when one fills.
  const HEADER_H = 13
  type Callout = { hex: string; lines: string[]; boxH: number; number: number }
  const callouts: Callout[] = labelSpecs.map((spec, i) => {
    const lines = wrapLabel(spec.label)
    return {
      hex: spec.hex,
      lines,
      boxH: BOX_PAD * 2 + HEADER_H + lines.length * LINE_H - 2,
      number: i + 1,
    }
  })
  const cols: Record<'left' | 'right', Callout[]> = { left: [], right: [] }
  const used: Record<'left' | 'right', number> = { left: 0, right: 0 }
  for (const [i, c] of callouts.entries()) {
    let side: 'left' | 'right' = i % 2 === 0 ? 'right' : 'left'
    const other: 'left' | 'right' = side === 'left' ? 'right' : 'left'
    if (used[side] + c.boxH + 8 > H - 8 && used[other] + c.boxH + 8 <= H - 8) side = other
    cols[side].push(c)
    used[side] += c.boxH + 8
  }

  const labels: string[] = []
  for (const side of ['left', 'right'] as const) {
    const list = cols[side]
    if (list.length === 0) continue
    const bx = side === 'left' ? 8 : W - BOX_W - 8
    const sumH = list.reduce((s, c) => s + c.boxH, 0)
    const gap =
      list.length > 1 ? Math.min(26, Math.max(8, (H - 16 - sumH) / (list.length - 1))) : 0
    let by = 8
    for (const c of list) {
      const eyebrow =
        `<text x="${fmt(bx + BOX_PAD + 6)}" y="${fmt(by + BOX_PAD + 7)}" ` +
        `font-family="'JetBrains Mono', Consolas, monospace" font-size="8" font-weight="700" ` +
        `letter-spacing="1.5" fill="${c.hex}">ZONE ${String(c.number).padStart(2, '0')}</text>`
      const text = c.lines
        .map(
          (line, i) =>
            `<text x="${fmt(bx + BOX_PAD + 6)}" y="${fmt(by + BOX_PAD + HEADER_H + FONT_PX + i * LINE_H - 2)}" ` +
            `font-family="'Manrope', Arial, Helvetica, sans-serif" font-size="${FONT_PX}" font-weight="600" fill="#F2EDE6">${esc(line)}</text>`,
        )
        .join('')
      labels.push(
        `<rect x="${fmt(bx)}" y="${fmt(by)}" width="${BOX_W}" height="${fmt(c.boxH)}" ` +
          `fill="#16120F" fill-opacity="0.92" stroke="#4A4038" stroke-width="1"/>` +
          `<rect x="${fmt(bx)}" y="${fmt(by)}" width="4" height="${fmt(c.boxH)}" fill="${c.hex}" data-accent-bar="1"/>` +
          eyebrow +
          text,
      )
      by += c.boxH + gap
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    tints.join('') +
    geometry.join('') +
    markers.join('') +
    labels.join('') +
    `</svg>`
  )
}

/** UTF-8 → base64 that works in Node (PDF path) AND the browser (the /m
 *  client component) — Buffer doesn't exist client-side. */
function toBase64(s: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64')
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** The overlay as a data URI for `<img>`/PDF embedding, or null. */
export function layoutOverlayImageSrc(args: LayoutOverlayArgs): string | null {
  const svg = buildLayoutOverlaySvg(args)
  if (!svg) return null
  return `data:image/svg+xml;base64,${toBase64(svg)}`
}
