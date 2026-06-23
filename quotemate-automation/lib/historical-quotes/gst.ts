// GST split for imported historical prices.
//
// Repo convention: store ex-GST, display inc-GST. A historical price arrives as
// a single number plus a (possibly unknown) GST basis. We persist BOTH the ex
// and inc figures so downstream analytics/hints never re-derive GST.

export const GST_RATE = 0.1

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Split an amount into ex- and inc-GST. Returns null for a missing/invalid amount.
 * - gstRegistered = false → ex == inc == amount (no GST applies).
 * - basis 'ex'  → amount is ex-GST; inc = amount × 1.1.
 * - basis 'inc' → amount is inc-GST; ex = amount ÷ 1.1.
 * - basis 'unknown' → DOCUMENTED DEFAULT: treat the stated number as inc-GST
 *   (the tradie-quoting norm), so ex = amount ÷ 1.1.
 */
export function splitGst(
  amount: number | null | undefined,
  basis: 'inc' | 'ex' | 'unknown',
  gstRegistered = true,
): { ex: number; inc: number } | null {
  if (amount == null || !Number.isFinite(amount) || amount < 0) return null
  if (!gstRegistered) return { ex: round2(amount), inc: round2(amount) }
  if (basis === 'ex') return { ex: round2(amount), inc: round2(amount * (1 + GST_RATE)) }
  return { ex: round2(amount / (1 + GST_RATE)), inc: round2(amount) }
}
