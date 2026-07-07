// QuoteMax Brand Studio — design tokens (dark "command-centre" register).
// Single source for the render pipeline (next/og templates) AND the studio UI.
// Mirrors the canonical DS (redesign/DesignSystem/tokens) + app/globals.css.
// Marketing assets are ALWAYS the dark command-centre look, regardless of the
// app's light default — so these are the dark-theme values only.

export const QM = {
  inkDeep: '#16120F', // primary canvas
  ink: '#1E1813',
  inkCard: '#2B2422',
  inkLine: '#3A322C',
  accent: '#FFC400', // Caterpillar yellow — the one signal
  accentPress: '#E6AC00',
  accentSoft: '#FFD23D',
  accentInk: '#1C1812', // text/icons ON a yellow fill — never white
  textPri: '#F6F1EA',
  textSec: '#C3B8AC',
  textDim: '#A2968A',
  edgeGlow: '#6E6354',
} as const

export const FONT = {
  display: 'Manrope', // ALL-CAPS display + body
  mono: 'JetBrains Mono', // eyebrows / labels / metadata
} as const

// Duotone recipe (kept here so the offline bake and any docs agree on one recipe).
export const DUOTONE = {
  saturation: 0.5, // partial desaturate
  brightness: 0.86,
  charcoal: { r: 22, g: 18, b: 15, alpha: 0.42 }, // multiply — warms shadows to canvas
  accent: { r: 255, g: 196, b: 0, alpha: 0.12 }, // soft-light — lifts highlights toward yellow
} as const
