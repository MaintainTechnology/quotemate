// ════════════════════════════════════════════════════════════════════
// Solar — AI "panels installed" concept PROMPT (pure, no I/O).
//
// Split out from panels-after.ts so it can be unit-tested without
// pulling in the Supabase / Gemini clients that module instantiates at
// import time (same split as roofing's roof-after-prompt.ts).
//
// The brief is grounded HARD on the quoted system: exactly the tier's
// panel count, AND — when the estimate carries per-panel geometry — the
// SAME per-plane distribution and positions the deterministic "Proposed
// panel layout" / "Panel strings" figures draw (premium quote §4.2).
// deriveSolarLayoutFacts projects the persisted solarPanels[] through
// the IDENTICAL Web-Mercator math as layout-overlay.ts, so the words in
// the prompt describe the exact frame Gemini receives as its source
// image. The output is a clearly-labelled CONCEPT — never a design
// document.
// ════════════════════════════════════════════════════════════════════

import type { LatLng, SolarOrientation, SolarPanelPlacement, SolarRoofPlane } from './types'
import { orientationLabel } from './hero-overlay'
import {
  projectToPixel,
  metersPerPixel,
  OVERLAY_MAP_ZOOM,
  OVERLAY_MAP_WIDTH,
  OVERLAY_MAP_HEIGHT,
} from './layout-overlay'

// ── Layout facts (derived from the SAME data as the layout overlay) ──

export type SolarPanelsLayoutFact = {
  /** e.g. "north-facing plane (pitch 22°)". */
  plane_label: string
  panels_count: number
  /** Distinct panel rows on this plane (≥1). */
  rows: number
  /** Where the cluster sits IN THE SOURCE PHOTO, e.g. "upper-left". */
  region: string
  /** Dominant mounting orientation of the rectangles. */
  panel_orientation: 'portrait' | 'landscape' | 'mixed'
}

/** 3×3 image-grid descriptor for a pixel point. */
function regionFor(x: number, y: number, width: number, height: number): string {
  const col = x < width / 3 ? 'left' : x < (2 * width) / 3 ? 'centre' : 'right'
  const rowBand = y < height / 3 ? 'upper' : y < (2 * height) / 3 ? 'middle' : 'lower'
  if (rowBand === 'middle' && col === 'centre') return 'centre'
  return `${rowBand}-${col}`
}

/**
 * PURE — per-plane placement facts for the prompt, derived from the
 * persisted per-panel geometry with the SAME projection + ordering the
 * deterministic layout figure uses. Empty array when no geometry exists
 * (pre-premium / manual estimates) — the prompt then falls back to the
 * orientation-only brief.
 */
export function deriveSolarLayoutFacts(args: {
  panels: SolarPanelPlacement[]
  planes: SolarRoofPlane[]
  center: LatLng
  /** Headline tier's count — Google orders solarPanels[] by energy. */
  panel_limit?: number | null
  panel_size_m?: { height_m: number; width_m: number } | null
  zoom?: number
  width?: number
  height?: number
}): SolarPanelsLayoutFact[] {
  const { panels, planes, center } = args
  if (!panels || panels.length === 0) return []
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return []

  const zoom = args.zoom ?? OVERLAY_MAP_ZOOM
  const width = args.width ?? OVERLAY_MAP_WIDTH
  const height = args.height ?? OVERLAY_MAP_HEIGHT
  const limit =
    args.panel_limit != null && args.panel_limit > 0
      ? Math.min(panels.length, Math.floor(args.panel_limit))
      : panels.length
  const used = panels.slice(0, limit)

  // Row-gap threshold: just over half a panel's long side in pixels, so
  // adjacent rows split and intra-row jitter doesn't.
  const mpp = metersPerPixel(center.lat, zoom)
  const longSidePx =
    args.panel_size_m && args.panel_size_m.height_m > 0 && mpp > 0
      ? args.panel_size_m.height_m / mpp
      : 15
  const rowGapPx = Math.max(4, longSidePx * 0.6)

  // Group by plane, preserving segment order (same as the figures).
  const byPlane = new Map<number, Array<{ p: SolarPanelPlacement; px: { x: number; y: number } }>>()
  for (const p of used) {
    const px = projectToPixel(p.center, center, zoom, width, height)
    const arr = byPlane.get(p.segment_index)
    if (arr) arr.push({ p, px })
    else byPlane.set(p.segment_index, [{ p, px }])
  }

  const facts: SolarPanelsLayoutFact[] = []
  for (const [segIdx, items] of [...byPlane.entries()].sort((a, b) => a[0] - b[0])) {
    const plane = planes[segIdx]

    // De-rotate by the plane azimuth so "rows" follow the physical racking
    // (identical maths to string-overlay's run ordering).
    const azimuth = plane?.azimuth_degrees ?? 0
    const rad = (-(((azimuth % 360) + 360) % 360) * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const rowCoords = items
      .map((i) => i.px.x * sin + i.px.y * cos)
      .sort((a, b) => a - b)
    let rows = 1
    for (let i = 1; i < rowCoords.length; i++) {
      if (rowCoords[i] - rowCoords[i - 1] > rowGapPx) rows += 1
    }

    // Cluster centroid → coarse photo region.
    const cx = items.reduce((a, i) => a + i.px.x, 0) / items.length
    const cy = items.reduce((a, i) => a + i.px.y, 0) / items.length

    // Dominant rectangle orientation (mixed when the minority is ≥ 25%).
    const portrait = items.filter((i) => i.p.orientation === 'PORTRAIT').length
    const landscape = items.length - portrait
    const minority = Math.min(portrait, landscape)
    const panel_orientation: SolarPanelsLayoutFact['panel_orientation'] =
      minority / items.length >= 0.25
        ? 'mixed'
        : portrait >= landscape
          ? 'portrait'
          : 'landscape'

    const orientLabel = plane
      ? orientationLabel(plane.orientation).toLowerCase()
      : 'main'
    const pitch =
      plane && Number.isFinite(plane.pitch_degrees)
        ? ` (pitch ${Math.round(plane.pitch_degrees)}°)`
        : ''

    facts.push({
      plane_label: `${orientLabel}-facing plane${pitch}`,
      panels_count: items.length,
      rows,
      region: regionFor(cx, cy, width, height),
      panel_orientation,
    })
  }
  return facts
}

// ── Prompt builder ────────────────────────────────────────────────────

export type SolarPanelsAfterBrief = {
  /** Panels to render — the headline tier's exact count. */
  panelsCount: number
  /** DC system size, for the brief's context line. */
  systemKwDc: number
  /** Primary array orientation from the roof facts. */
  orientation: SolarOrientation
  /**
   * Per-plane placement facts from deriveSolarLayoutFacts — the SAME
   * data the Proposed Panel Layout / string figures draw. When present,
   * the render must follow this distribution exactly; when absent
   * (pre-premium estimates) the brief falls back to orientation-only.
   */
  layout?: SolarPanelsLayoutFact[]
}

/** Label for the CLEAN aerial attached as reference in box-replacement
 *  mode (where the marked plan is the SOURCE being edited). */
export const CLEAN_REFERENCE_LABEL =
  'REFERENCE — ORIGINAL PHOTO: the same aerial without any markings. ' +
  'Everywhere OUTSIDE the panel rectangles, the output must match this ' +
  'original exactly — same roof colour and texture, same ground, trees, ' +
  'driveway, vehicles and lighting.'

/**
 * PURE — the box-replacement brief: the SOURCE image Gemini edits IS the
 * panel-marked plan (the Proposed Panel Layout frame), and the task is
 * pure local replacement — turn every orange rectangle into one
 * photorealistic panel of exactly that footprint, erase the markings,
 * change nothing else. Direct replacement on visible pixels is the most
 * compliant grounding an image editor accepts. `visionNotes` (the
 * Claude vision pre-step's description of the plan) ride along when
 * available; the deterministic layout facts are the fallback wording.
 */
export function buildSolarBoxReplacementPrompt(args: {
  panelsCount: number
  systemKwDc: number
  layout?: SolarPanelsLayoutFact[]
  visionNotes?: string | null
  /** Real panel dimensions from the estimate — calibrates panel scale. */
  panelSizeM?: { height_m: number; width_m: number } | null
}): { system: string; user: string } {
  const count = Math.max(1, Math.round(args.panelsCount))

  // Absolute size calibration: the estimate's real panel dimensions when
  // available, else the standard residential module. An absolute figure
  // stops the generator ballooning panels even if it misreads a rectangle.
  const size =
    args.panelSizeM && args.panelSizeM.height_m > 0 && args.panelSizeM.width_m > 0
      ? `${args.panelSizeM.width_m.toFixed(1)} m × ${args.panelSizeM.height_m.toFixed(1)} m`
      : '1.0 m × 1.7 m'

  const system =
    'You are a photo-editing specialist working on a real top-down ' +
    'satellite aerial photo of a property. The photo carries an approved ' +
    'solar placement plan drawn on the roof as orange rectangles. ' +
    'Recreate the photo exactly as-is with ONE change — local replacement: ' +
    'each orange rectangle becomes one photorealistic dark monocrystalline ' +
    "solar panel that fills exactly that rectangle's footprint (same " +
    'position, same size, same rotation, same portrait/landscape ' +
    'orientation), and every trace of orange is removed. Each rectangle ' +
    `is drawn to true scale for a standard residential panel (about ${size} ` +
    'relative to the house) — never enlarge or shrink the panels. ' +
    'Everywhere outside the rectangles the output must match the original ' +
    'photo exactly.'

  // Placement wording: prefer the vision pre-step's pixel-grounded notes
  // (SCENE + PLACEMENT sections), else the deterministic per-plane facts.
  let layoutNotes = ''
  if (args.visionNotes && args.visionNotes.trim().length > 0) {
    layoutNotes = `${args.visionNotes.trim()} `
  } else if (args.layout && args.layout.length > 0) {
    const lines = args.layout.map((f, i) => {
      const orient =
        f.panel_orientation === 'mixed'
          ? 'a mix of portrait and landscape'
          : `${f.panel_orientation} orientation`
      return (
        `${i + 1}. ${f.plane_label}: ${f.panels_count} rectangle` +
        `${f.panels_count === 1 ? '' : 's'} in ${f.rows} row` +
        `${f.rows === 1 ? '' : 's'} (${orient}) on the ${f.region} part of the frame.`
      )
    })
    layoutNotes = `PLACEMENT (from the plan): ${lines.join(' ')} `
  }

  const user =
    `This aerial carries the approved Proposed Panel Layout for a ` +
    `${args.systemKwDc.toFixed(1)} kW system: exactly ${count} orange ` +
    'rectangles drawn on the roof. ' +
    layoutNotes +
    `Follow the Proposed Panel Layout exactly: replace EVERY orange rectangle ` +
    'with one photorealistic dark monocrystalline solar panel that fills ' +
    "exactly that rectangle's footprint — thin silver aluminium frames, " +
    'subtle sun glint, lighting and shadows consistent with the photo. ' +
    `Do NOT add panels anywhere there is no rectangle. TOTAL: exactly ${count} ` +
    'panels — count them. Remove ALL orange markings: no orange outlines, ' +
    'fills, or tint may remain anywhere in the output. ' +
    'Keep everything else identical to the original photo: building ' +
    'footprint and roof shape, roof colour and texture, ridges and ' +
    'valleys, ground, lawn, driveway, trees, pool, fences, vehicles, ' +
    'neighbouring buildings, lighting, shadows, camera angle, zoom and ' +
    'the satellite-photo look. No text, labels, watermarks or people. ' +
    'The result must read as the SAME property photographed after the ' +
    'solar installation.'

  return { system, user }
}

/**
 * PURE — the system+user brief for the "panels installed" render.
 * Grounded on "add ONLY solar panels" so Gemini doesn't reinvent the
 * building or its surroundings (it's an aerial of a REAL property).
 */
export function buildSolarPanelsAfterPrompt(
  brief: SolarPanelsAfterBrief,
): { system: string; user: string } {
  const count = Math.max(1, Math.round(brief.panelsCount))
  const label = orientationLabel(brief.orientation).toLowerCase()

  const system =
    'You are an architectural visualiser editing a real top-down satellite ' +
    'aerial photo of a property. You make ONE change only: install ' +
    'residential solar panels on the existing roof. Everything else stays ' +
    'pixel-faithful to the source photo.'

  // Placement: per-plane engineering facts when geometry exists, else
  // the legacy orientation-only sentence. (When per-panel geometry is
  // available, callers should prefer buildSolarBoxReplacementPrompt —
  // the marked-plan edit is the stronger grounding.)
  let placementBlock: string
  if (brief.layout && brief.layout.length > 0) {
    const lines = brief.layout.map((f, i) => {
      const orient =
        f.panel_orientation === 'mixed'
          ? 'a mix of portrait and landscape'
          : `${f.panel_orientation} orientation`
      return (
        `${i + 1}. ${f.plane_label}: exactly ${f.panels_count} panel` +
        `${f.panels_count === 1 ? '' : 's'} arranged in ${f.rows} neat ` +
        `row${f.rows === 1 ? '' : 's'}, ${orient}, positioned on the ` +
        `${f.region} part of the roof as seen in this photo.`
      )
    })
    placementBlock =
      'PANEL PLACEMENT — follow this engineering layout exactly (it comes ' +
      'from the signed-off panel plan for this roof): ' +
      lines.join(' ') +
      ` TOTAL: exactly ${count} panels across the whole roof — count them; ` +
      'no more, no fewer, and do not place panels on any other roof plane. '
  } else {
    const placement =
      brief.orientation === 'flat' || brief.orientation === 'unknown'
        ? 'on the largest unobstructed roof area'
        : `concentrated on the ${label}-facing roof plane(s)`
    placementBlock =
      `neatly installed in a realistic rectangular grid layout, ${placement}, ` +
      "following the roof's existing ridge lines and leaving sensible edge setbacks. "
  }

  const user =
    `Render this exact aerial with ${count} dark monocrystalline solar ` +
    `panels (about ${brief.systemKwDc.toFixed(1)} kW) ` +
    placementBlock +
    'STRICT RULES: keep the exact same building footprint, roof shape, ' +
    'ridges, valleys and number of structures; keep the ground, driveway, ' +
    'trees, pool, fences, vehicles, neighbouring buildings and the camera ' +
    'angle / zoom completely unchanged. Do NOT re-roof or recolour the ' +
    'roof surface, do NOT add or remove buildings, do NOT rotate or ' +
    're-frame, do NOT add text, labels, watermarks or people. ' +
    'Photorealistic panels with consistent lighting and shadows matching ' +
    'the original aerial. The result must read as the SAME property ' +
    'photographed after the solar installation.'
  return { system, user }
}
