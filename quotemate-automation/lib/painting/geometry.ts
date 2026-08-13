// ════════════════════════════════════════════════════════════════════
// Painting — shared geometry primitives.
//
// area.ts (whole-house heuristic) and rooms.ts (per-room schedule) both
// need the same shape factor and the same rounding, and area.ts consumes
// rooms.ts — so these live here rather than in either of them, otherwise
// the two modules import each other in a cycle.
//
// area.ts re-exports roundTo / clamp / K_SHAPE_INTERIOR so every existing
// `from './area'` import keeps working unchanged.
//
// PURE — no I/O. Fully unit-testable.
// ════════════════════════════════════════════════════════════════════

/** Perimeter shape factor — real rooms/houses are oblong, not square. */
export const K_SHAPE_INTERIOR = 1.08

/** Perimeter shape factor for a whole building footprint. */
export const K_SHAPE_EXTERIOR = 1.15

/** PURE — round to N decimal places, predictable. */
export function roundTo(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

/** PURE — clamp n into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}
