// ════════════════════════════════════════════════════════════════════
// Painting — repaint colour swatches (pure data).
//
// The AU-market colour names the repaint preview offers. Shared by the
// dashboard estimate tool's preview section and the token-page repaint
// picker (/p + /q/paint) so the palettes never drift.
// ════════════════════════════════════════════════════════════════════

export const PAINT_COLOUR_SWATCHES = [
  'Surfmist off-white',
  'Dulux Natural White',
  'Dulux Vivid White',
  'Lexicon Quarter',
  'Hog Bristle',
  'Monument charcoal',
  'Basalt grey',
  'Woodland Grey',
  'Shale Grey',
  'Sage green',
  'Hamptons blue',
  'Terracotta',
  'Heritage red',
  'Charcoal black',
] as const

export type PaintColourSwatch = (typeof PAINT_COLOUR_SWATCHES)[number]
