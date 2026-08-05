// Categorical data-viz palette (spec dashboard-premium-pass R0.3).
//
// WHY THIS FILE EXISTS AS TYPESCRIPT
// The ramp is declared as CSS custom properties in app/globals.css, which is
// the right home for anything the DOM paints. But three of its consumers do
// not paint through the DOM:
//   · RoofMap        → MapLibre GL paint expressions (WebGL)
//   · FlyerCanvasEditor → Konva (2D canvas)
//   · PlanOverlay    → canvas-backed pin markers
// None of those resolve `var(--viz-1)`; they need a literal string. So the
// values live here and app/globals.css mirrors them.
//
// ⚠ KEEP IN SYNC with the `--viz-*` block in app/globals.css. There is a
// vitest guard (viz-palette.test.ts) that parses globals.css and fails if the
// two ever drift, so a mismatch is caught rather than shipped.
//
// WHY A SHARED RAMP AT ALL
// The One Signal Rule (DESIGN.md) says Caterpillar yellow is the only accent.
// Categorical encoding is the single sanctioned exception — eight room types
// cannot be encoded in one yellow. Before this, RoofMap, FloorPlanOverlay and
// PlanOverlay each invented their own rainbow (#3a86ff, #8338ec, #ef476f,
// #2ec4b6 …): generic bright hues that fight a warm charcoal canvas and made
// three views of the same product look like three different products.
//
// RULES
// · Warm-biased so it belongs to the canvas. VIZ[1] is the one permitted cool
//   value — with eight categories you need a cool anchor or the warm hues
//   collapse into each other.
// · Every value measured ≥3:1 against --ink-card (#2B2422), the WCAG 1.4.11
//   threshold for non-text graphical objects. Lowest is clay at ~4.0:1.
// · Ordered for maximum adjacent separation, because categories usually land
//   next to their neighbours in a legend.
// · CHROME MUST NOT USE THESE. They mean "this is a data category". An
//   important panel uses .edge-lit; a warning uses --warning-bright.

/** The eight categorical hues, in assignment order. */
export const VIZ = [
  '#FFC400', // 0 accent yellow — category one anchors on brand
  '#8FA3B8', // 1 muted slate — the one permitted cool value
  '#F0816B', // 2 coral
  '#34D27B', // 3 green
  '#D98E4A', // 4 ochre
  '#C3B8AC', // 5 bone
  '#A8785F', // 6 clay
  '#E8B4A0', // 7 blush
] as const

/** Cycle the ramp by index — for lists of unknown length (plan pins). */
export function vizAt(index: number): string {
  return VIZ[((index % VIZ.length) + VIZ.length) % VIZ.length]
}

// ─── Canvas-only chrome ────────────────────────────────────────────────
// Konva and MapLibre cannot read the surface tokens either. These mirror the
// DARK-theme values of --ink-line / --ink-deep. Canvas chrome does not follow
// the light theme today; that is a known limitation, not an oversight — the
// flyer editor and the roof map both render on a fixed dark working surface
// regardless of the app theme, so a literal is honest here.
export const CANVAS_HAIRLINE = '#3A322C' // --ink-line (dark theme)
export const CANVAS_SURFACE = '#16120F' // --ink-deep (dark theme)
