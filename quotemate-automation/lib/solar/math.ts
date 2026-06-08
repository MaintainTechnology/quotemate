// ════════════════════════════════════════════════════════════════════
// lib/solar/math.ts — shared rounding utilities for the solar engine.
//
// Centralises the roundTo helper that was previously duplicated in
// pricing.ts, economics.ts, manual-fallback.ts, sizing.ts, and roof.ts.
// All solar modules that round monetary or physical quantities should
// import from here rather than defining local variants.
//
// Half-up rounding: Math.round(n * 10^dp) / 10^dp.
// Non-finite inputs (Infinity, NaN) return 0 — the same defensive
// behaviour the original per-module implementations used.
//
// PURE — no I/O, no side-effects, no dependencies.
// ════════════════════════════════════════════════════════════════════

/**
 * Round `n` to `dp` decimal places (half-up).
 * Non-finite inputs (NaN, ±Infinity) return 0.
 */
export function roundTo(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

/** Convenience wrapper: round to 1 decimal place. */
export function round1(n: number): number {
  return roundTo(n, 1)
}

/** Convenience wrapper: round to 2 decimal places. */
export function round2(n: number): number {
  return roundTo(n, 2)
}
