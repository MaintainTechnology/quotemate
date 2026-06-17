// ════════════════════════════════════════════════════════════════════
// Solar — "Panel strings & component markings" overlay (premium quote
// spec §4.2). From the SAME per-panel geometry the layout overlay draws,
// chunk the headline tier's panels into INDICATIVE strings:
//
//   • group panels by segment_index (one string never spans planes),
//   • order each plane's panels along the row direction (projected
//     pixel position, de-rotated by the plane azimuth so rows sort
//     naturally), and
//   • split into runs of ≤ string_max_panels (config, default 14 —
//     a typical residential MPPT window).
//
// Each string gets a distinct colour, a polyline through its panel
// centres, and a numbered terminal marker. An inverter marker (with a
// dashed homerun from each string terminal) sits below the array,
// toward the street-facing image edge.
//
// ALWAYS captioned: "Indicative string layout — final stringing is
// confirmed by your installer at site" (spec §4.2 — non-negotiable).
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type { LatLng, SolarPanelPlacement, SolarRoofPlane } from './types'
import {
  projectToPixel,
  OVERLAY_MAP_ZOOM,
  OVERLAY_MAP_WIDTH,
  OVERLAY_MAP_HEIGHT,
  selectPanelsForLayout,
} from './layout-overlay'

/** Mandatory caption (spec §4.2). Tests assert this verbatim. */
export const STRING_OVERLAY_CAPTION =
  'Indicative string layout — final stringing is confirmed by your installer at site.'

/** Default MPPT window when config omits string_max_panels. */
export const DEFAULT_STRING_MAX_PANELS = 14

// String palette — deliberately DIFFERENT from the per-plane layout
// palette so the two figures read as distinct information layers.
const STRING_PALETTE = [
  '#FACC15', // amber
  '#38BDF8', // sky
  '#FB7185', // rose
  '#4ADE80', // green
  '#A78BFA', // violet
  '#F97316', // orange
  '#2DD4BF', // teal
  '#F472B6', // pink
] as const

export function stringColor(stringIndex: number): string {
  const i = Math.abs(Math.floor(stringIndex)) % STRING_PALETTE.length
  return STRING_PALETTE[i]
}

export type SolarStringRun = {
  /** 1-based string number, as labelled on the figure ("S1", "S2", …). */
  string_number: number
  segment_index: number
  panels_count: number
  color: string
}

export type StringOverlay = {
  /** Transparent SVG sized to the static map; position over the <img>. */
  svg: string
  strings: SolarStringRun[]
  caption: string
}

export type StringOverlayInput = {
  panels: SolarPanelPlacement[]
  planes: SolarRoofPlane[]
  /** MUST be the same centre the static map was rendered with. */
  center: LatLng
  /** Headline tier panel count — strings are drawn for ONE system. */
  panel_limit?: number | null
  /** Keep stringing aligned with the cleaner layout overlay selection. */
  prefer_contiguous_layout?: boolean
  /** Max panels per run (config string_max_panels; default 14). */
  string_max_panels?: number | null
  zoom?: number
  width?: number
  height?: number
}

/**
 * PURE — chunk an ordered list of panel indices into runs of ≤ max.
 * Exported for direct unit-testing of the chunking semantics.
 */
export function chunkIntoStrings<T>(items: T[], maxLen: number): T[][] {
  const max = Number.isFinite(maxLen) && maxLen >= 1 ? Math.floor(maxLen) : 1
  const out: T[][] = []
  for (let i = 0; i < items.length; i += max) {
    out.push(items.slice(i, i + max))
  }
  return out
}

/**
 * PURE — build the string-overlay SVG. Returns null when no per-panel
 * geometry exists (manual fallback / pre-premium rows) — consumers omit
 * the section (degradation matrix §4.6).
 */
export function buildStringOverlay(input: StringOverlayInput): StringOverlay | null {
  const { panels, planes, center } = input
  if (!panels || panels.length === 0) return null
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null

  const zoom = input.zoom ?? OVERLAY_MAP_ZOOM
  const width = input.width ?? OVERLAY_MAP_WIDTH
  const height = input.height ?? OVERLAY_MAP_HEIGHT
  const maxLen =
    input.string_max_panels != null && input.string_max_panels >= 1
      ? Math.floor(input.string_max_panels)
      : DEFAULT_STRING_MAX_PANELS

  const limit =
    input.panel_limit != null && input.panel_limit > 0
      ? Math.min(panels.length, Math.floor(input.panel_limit))
      : panels.length
  const used = selectPanelsForLayout(panels, limit, {
    prefer_contiguous_layout: input.prefer_contiguous_layout,
  })

  // Project once; carry the source placement alongside its pixel.
  const projected = used.map((p) => ({
    placement: p,
    px: projectToPixel(p.center, center, zoom, width, height),
  }))

  // Group by plane, preserving segment order.
  const byPlane = new Map<number, typeof projected>()
  for (const item of projected) {
    const k = item.placement.segment_index
    const arr = byPlane.get(k)
    if (arr) arr.push(item)
    else byPlane.set(k, [item])
  }

  const strings: SolarStringRun[] = []
  const shapes: string[] = []
  const terminalPoints: Array<{ x: number; y: number }> = []
  let stringNumber = 0

  for (const [segIdx, items] of [...byPlane.entries()].sort((a, b) => a[0] - b[0])) {
    // Order along the plane: de-rotate pixel coords by the plane azimuth
    // so row-major sorting follows the physical panel rows.
    const azimuth = planes[segIdx]?.azimuth_degrees ?? 0
    const rad = (-normaliseDeg(azimuth) * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const ordered = [...items].sort((a, b) => {
      const ay = a.px.x * sin + a.px.y * cos
      const by = b.px.x * sin + b.px.y * cos
      if (Math.abs(ay - by) > 2) return ay - by // row first (2-px epsilon)
      const ax = a.px.x * cos - a.px.y * sin
      const bx = b.px.x * cos - b.px.y * sin
      return ax - bx // then position within the row
    })

    for (const run of chunkIntoStrings(ordered, maxLen)) {
      stringNumber += 1
      const color = stringColor(stringNumber - 1)
      strings.push({
        string_number: stringNumber,
        segment_index: segIdx,
        panels_count: run.length,
        color,
      })

      const pts = run.map((r) => `${round2(r.px.x)},${round2(r.px.y)}`).join(' ')
      shapes.push(
        `<polyline points="${pts}" fill="none" stroke="${color}" ` +
          `stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`,
      )
      // Panel nodes along the run.
      for (const r of run) {
        shapes.push(
          `<circle cx="${round2(r.px.x)}" cy="${round2(r.px.y)}" r="2.4" ` +
            `fill="${color}" stroke="#0b1220" stroke-width="0.6"/>`,
        )
      }
      // Numbered terminal marker at the run's last panel.
      const last = run[run.length - 1].px
      terminalPoints.push({ x: last.x, y: last.y })
      shapes.push(
        `<g transform="translate(${round2(last.x)} ${round2(last.y)})">` +
          `<circle r="8" fill="#0b1220" stroke="${color}" stroke-width="1.6"/>` +
          `<text y="3" text-anchor="middle" font-family="monospace" font-size="8" ` +
          `font-weight="700" fill="${color}">S${stringNumber}</text></g>`,
      )
    }
  }

  if (strings.length === 0) return null

  // Inverter marker: below the array's lowest drawn panel, nudged toward
  // the bottom (street-facing) edge of the frame; clamped inside it.
  const lowest = projected.reduce((a, b) => (b.px.y > a.px.y ? b : a), projected[0])
  const invX = clamp(lowest.px.x, 24, width - 24)
  const invY = clamp(lowest.px.y + 36, 24, height - 18)

  for (const t of terminalPoints) {
    shapes.push(
      `<line x1="${round2(t.x)}" y1="${round2(t.y)}" x2="${round2(invX)}" y2="${round2(invY - 9)}" ` +
        `stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3 3" opacity="0.65"/>`,
    )
  }
  shapes.push(
    `<g transform="translate(${round2(invX)} ${round2(invY)})">` +
      `<rect x="-22" y="-9" width="44" height="18" fill="#0b1220" stroke="#FF5F00" stroke-width="1.6"/>` +
      `<text y="3.5" text-anchor="middle" font-family="monospace" font-size="8.5" ` +
      `font-weight="700" fill="#FF5F00">INV</text></g>`,
  )

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}" role="img" ` +
    `aria-label="Indicative panel strings — ${strings.length} string${strings.length === 1 ? '' : 's'} across ${byPlane.size} roof plane${byPlane.size === 1 ? '' : 's'}">` +
    shapes.join('') +
    `</svg>`

  return { svg, strings, caption: STRING_OVERLAY_CAPTION }
}

// ── helpers ──────────────────────────────────────────────────────────

function normaliseDeg(d: number): number {
  if (!Number.isFinite(d)) return 0
  return ((d % 360) + 360) % 360
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
