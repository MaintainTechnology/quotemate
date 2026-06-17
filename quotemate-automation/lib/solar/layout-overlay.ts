// ════════════════════════════════════════════════════════════════════
// Solar — deterministic "Proposed panel layout" overlay (premium quote
// spec §4.2). Projects each persisted SolarPanelPlacement.center into
// the static map's Web-Mercator pixel space (zoom 20, 640×480 — the
// exact framing /api/solar/q/[token]/static-map requests) and draws an
// engineering-accurate panel rectangle per placement:
//
//   • dimensions from panel_size_m, scaled by latitude-corrected
//     metres-per-pixel at the map zoom,
//   • LANDSCAPE/PORTRAIT swap from the placement's orientation,
//   • rotated to the owning roof plane's compass azimuth,
//   • foreshortened along the slope by cos(pitch) so rectangles sit
//     visually on the pitched roof exactly as the aerial photo does,
//   • colour-keyed per segment_index (the legend names each plane).
//
// The SVG string is shared verbatim by the page (absolutely positioned
// over the <img>) and the Gotenberg PDF. NOT generative — every pixel
// derives from Google Solar API geometry (constraint: anything implying
// engineering precision must come from real geometry).
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type { LatLng, SolarPanelPlacement, SolarRoofPlane } from './types'
import { orientationLabel } from './hero-overlay'

// ── Static-map framing (MUST match /api/solar/q/[token]/static-map) ──
export const OVERLAY_MAP_ZOOM = 20
export const OVERLAY_MAP_WIDTH = 640
export const OVERLAY_MAP_HEIGHT = 480

/** Equatorial metres per pixel at zoom 0 (256-px Web Mercator tile). */
const EARTH_METERS_PER_PX_Z0 = 156543.03392

// Colour palette keyed by segment_index (cycled). Chosen to read on a
// satellite photo in both the dark page and the light PDF.
const SEGMENT_PALETTE = [
  '#FF5F00', // Maintain orange
  '#2DD4BF', // teal
  '#A78BFA', // violet
  '#FACC15', // amber
  '#38BDF8', // sky
  '#FB7185', // rose
  '#4ADE80', // green
  '#F472B6', // pink
] as const

export function segmentColor(segmentIndex: number): string {
  const i = Math.abs(Math.floor(segmentIndex)) % SEGMENT_PALETTE.length
  return SEGMENT_PALETTE[i]
}

// Fraction of each panel's true footprint actually painted. Google places
// modules edge-to-edge, so drawing them at full size makes neighbours touch;
// with translucent fills + hairline strokes the seams smear into one blob and
// READ as overlapping (the #1 complaint). Insetting each module a little leaves
// a thin "walkway" gap so every panel renders as a separate, crisp rectangle —
// which is also physically honest (real arrays carry frame + row gaps). Purely
// cosmetic: it scales the drawn rectangle, never the projected centre, so the
// engineering geometry (centre, azimuth, foreshorten) is unchanged.
export const MODULE_GUTTER = 0.82

// ── Web-Mercator projection ──────────────────────────────────────────

/** PURE — world-pixel coordinate at a zoom (256 × 2^z world). */
export function mercatorWorldPx(p: LatLng, zoom: number): { x: number; y: number } {
  const worldSize = 256 * 2 ** zoom
  const x = ((p.lng + 180) / 360) * worldSize
  const sinLat = Math.sin((p.lat * Math.PI) / 180)
  // Clamp to avoid Infinity at the poles (never hit for AU roofs).
  const clamped = Math.min(0.9999, Math.max(-0.9999, sinLat))
  const y =
    (0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI)) * worldSize
  return { x, y }
}

/** PURE — project a lat/lng to image-pixel space for a map centred at
 *  `center` with the given zoom and CSS-pixel dimensions. */
export function projectToPixel(
  p: LatLng,
  center: LatLng,
  zoom: number = OVERLAY_MAP_ZOOM,
  width: number = OVERLAY_MAP_WIDTH,
  height: number = OVERLAY_MAP_HEIGHT,
): { x: number; y: number } {
  const wp = mercatorWorldPx(p, zoom)
  const wc = mercatorWorldPx(center, zoom)
  return { x: width / 2 + (wp.x - wc.x), y: height / 2 + (wp.y - wc.y) }
}

/** PURE — ground metres per CSS pixel at a latitude + zoom. */
export function metersPerPixel(lat: number, zoom: number = OVERLAY_MAP_ZOOM): number {
  return (EARTH_METERS_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
}

// ── Layout overlay builder ───────────────────────────────────────────

export type LayoutOverlayLegendEntry = {
  segment_index: number
  color: string
  panels_count: number
  /** e.g. "North-east · 22°" — plane orientation + pitch when known. */
  plane_label: string
}

export type LayoutOverlay = {
  /** Transparent SVG sized to the static map; position over the <img>. */
  svg: string
  /** Panels actually drawn (after the tier cap). */
  panels_drawn: number
  legend: LayoutOverlayLegendEntry[]
}

export type LayoutOverlayInput = {
  panels: SolarPanelPlacement[]
  panel_size_m: { height_m: number; width_m: number } | null | undefined
  planes: SolarRoofPlane[]
  /** MUST be the same centre the static map was rendered with. */
  center: LatLng
  /** Cap drawn panels to the headline tier's count (Google orders
   *  solarPanels[] by energy, so the first N are the N-panel config). */
  panel_limit?: number | null
  /** Prefer one clean roof face when avoiding a tiny orphan group costs <1%. */
  prefer_contiguous_layout?: boolean
  zoom?: number
  width?: number
  height?: number
}

export type LayoutPanelSelectionOptions = {
  prefer_contiguous_layout?: boolean
  min_segment_panels?: number
  max_loss_pct?: number
}

const DEFAULT_MIN_SEGMENT_PANELS = 3
const DEFAULT_MAX_CONTIGUOUS_LOSS_PCT = 0.01

export function selectPanelsForLayout(
  panels: SolarPanelPlacement[],
  panelLimit: number | null | undefined,
  options: LayoutPanelSelectionOptions = {},
): SolarPanelPlacement[] {
  if (!panels || panels.length === 0) return []

  const limit =
    panelLimit != null && panelLimit > 0
      ? Math.min(panels.length, Math.floor(panelLimit))
      : panels.length
  const baseline = panels.slice(0, limit)

  if (!options.prefer_contiguous_layout || baseline.length === 0) return baseline

  const minSegmentPanels = Math.max(
    1,
    Math.floor(options.min_segment_panels ?? DEFAULT_MIN_SEGMENT_PANELS),
  )
  const counts = new Map<number, number>()
  for (const panel of baseline) {
    counts.set(panel.segment_index, (counts.get(panel.segment_index) ?? 0) + 1)
  }
  const hasTinyOrphan = [...counts.values()].some((count) => count < minSegmentPanels)
  if (!hasTinyOrphan) return baseline

  const baselineEnergy = totalEnergy(baseline)
  if (!(baselineEnergy > 0)) return baseline

  const maxLossPct = Math.max(0, options.max_loss_pct ?? DEFAULT_MAX_CONTIGUOUS_LOSS_PCT)
  let bestSinglePlane: { panels: SolarPanelPlacement[]; energy: number } | null = null
  for (const segmentIndex of new Set(panels.map((panel) => panel.segment_index))) {
    const candidate = panels.filter((panel) => panel.segment_index === segmentIndex).slice(0, limit)
    if (candidate.length < limit) continue
    const energy = totalEnergy(candidate)
    if (!bestSinglePlane || energy > bestSinglePlane.energy) {
      bestSinglePlane = { panels: candidate, energy }
    }
  }

  if (!bestSinglePlane) return baseline
  const lossPct = (baselineEnergy - bestSinglePlane.energy) / baselineEnergy
  return lossPct <= maxLossPct ? bestSinglePlane.panels : baseline
}

/**
 * PURE — build the proposed-panel-layout SVG. Returns null when the
 * estimate has no per-panel geometry or no panel dimensions (manual
 * fallback / pre-premium rows) — consumers then omit the section
 * (degradation matrix §4.6).
 */
export function buildLayoutOverlay(input: LayoutOverlayInput): LayoutOverlay | null {
  const { panels, panel_size_m, planes, center } = input
  if (!panels || panels.length === 0) return null
  if (!panel_size_m || panel_size_m.height_m <= 0 || panel_size_m.width_m <= 0) {
    return null
  }
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null

  const zoom = input.zoom ?? OVERLAY_MAP_ZOOM
  const width = input.width ?? OVERLAY_MAP_WIDTH
  const height = input.height ?? OVERLAY_MAP_HEIGHT

  const limit =
    input.panel_limit != null && input.panel_limit > 0
      ? Math.min(panels.length, Math.floor(input.panel_limit))
      : panels.length
  const drawn = selectPanelsForLayout(panels, limit, {
    prefer_contiguous_layout: input.prefer_contiguous_layout,
  })

  const mpp = metersPerPixel(center.lat, zoom)
  if (!(mpp > 0)) return null

  const rects: string[] = []
  const counts = new Map<number, number>()

  for (const p of drawn) {
    const px = projectToPixel(p.center, center, zoom, width, height)
    const plane = planes[p.segment_index]
    const azimuth = plane?.azimuth_degrees ?? 0
    const pitchDeg = plane?.pitch_degrees ?? 0
    // Foreshorten the slope-direction dimension by cos(pitch): an aerial
    // photo sees a pitched panel compressed along the fall line.
    const foreshorten = Math.cos((Math.min(60, Math.max(0, pitchDeg)) * Math.PI) / 180)

    // PORTRAIT: long side runs up the slope (vertical pre-rotation).
    // LANDSCAPE: long side runs along the row (horizontal pre-rotation).
    const longPx = panel_size_m.height_m / mpp
    const shortPx = panel_size_m.width_m / mpp
    // Inset by the module gutter so adjacent panels keep a visible gap.
    const w = (p.orientation === 'PORTRAIT' ? shortPx : longPx) * MODULE_GUTTER
    const h = (p.orientation === 'PORTRAIT' ? longPx : shortPx) * foreshorten * MODULE_GUTTER

    const color = segmentColor(p.segment_index)
    counts.set(p.segment_index, (counts.get(p.segment_index) ?? 0) + 1)

    // Crisp, near-solid module with a thin white edge so each panel reads as a
    // discrete rectangle against the satellite photo (vs the old translucent
    // edge-touching fill that smeared neighbours together). One <rect> per
    // panel; the gutter — not opacity — does the separating.
    rects.push(
      `<rect x="${round2(px.x - w / 2)}" y="${round2(px.y - h / 2)}" ` +
        `width="${round2(w)}" height="${round2(h)}" rx="0.5" ` +
        `transform="rotate(${round2(normaliseDeg(azimuth))} ${round2(px.x)} ${round2(px.y)})" ` +
        `fill="${color}" fill-opacity="0.85" stroke="#FFFFFF" stroke-width="0.6" stroke-opacity="0.9"/>`,
    )
  }

  const legend: LayoutOverlayLegendEntry[] = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([segment_index, panels_count]) => {
      const plane = planes[segment_index]
      const orient = plane ? orientationLabel(plane.orientation) : 'Plane'
      const pitch =
        plane && Number.isFinite(plane.pitch_degrees)
          ? ` · ${Math.round(plane.pitch_degrees)}°`
          : ''
      return {
        segment_index,
        color: segmentColor(segment_index),
        panels_count,
        plane_label: `${orient}${pitch}`,
      }
    })

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}" role="img" ` +
    `aria-label="Proposed panel layout — ${drawn.length} panels drawn from Google Solar API geometry">` +
    rects.join('') +
    `</svg>`

  return { svg, panels_drawn: drawn.length, legend }
}

// ── helpers ──────────────────────────────────────────────────────────

function normaliseDeg(d: number): number {
  if (!Number.isFinite(d)) return 0
  return ((d % 360) + 360) % 360
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function totalEnergy(panels: SolarPanelPlacement[]): number {
  return panels.reduce((sum, panel) => sum + Math.max(0, panel.yearly_energy_dc_kwh ?? 0), 0)
}

export const __test_only__ = { SEGMENT_PALETTE, EARTH_METERS_PER_PX_Z0 }
