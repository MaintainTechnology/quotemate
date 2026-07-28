// Reconciling price breakdown for the customer "Your price" section.
//
// THE PROBLEM. Quote line items are stored EX-GST (quotes.good/better/best
// jsonb → line_items[].total_ex_gst) while every headline the customer sees is
// INC-GST and whole-dollar. Every existing breakdown surface (the PDF table in
// lib/quote/report-html.ts, the old <details> on /q/[token]) therefore prints
// ex-GST rows under an inc-GST total, and the rows deliberately do NOT add up.
// A "detailed breakdown that shows how the individual costs sum to the total"
// cannot do that — a customer who adds the column up must land on the headline.
//
// WHY NOT JUST GROSS UP EACH ROW. Calling displayIncGst() per line and summing
// rounds n times independently and drifts up to ±n/2 dollars from the headline
// (that is the P4 class of bug recorded in app/q/[token]/page.tsx). And the
// estimator's line totals are not guaranteed to sum to subtotal_ex_gst — no
// invariant, assertion or test enforces it anywhere.
//
// THE RULE HERE. Compute the inc-GST total ONCE through lib/quote/money (the
// one sanctioned path: discount the ex-GST base → GST when registered → round
// once), then APPORTION that exact number across the rows by each row's share
// of the summed line ex-GST, settling the rounding with largest-remainder.
// Σ rows === the headline by construction, on every quote, with no drift.
//
// Pure — no DB, no React. Unit-tested in line-allocation.test.ts.

import { asMoneyNumber, displayIncGst, dollars, totalIncGstCents, type MoneyOpts } from './money'
import { clampDiscountPct } from './early-bird'

/** The only field an allocation needs off a line item. */
export type AllocatableLine = { total_ex_gst?: number | string | null }

/**
 * Apportion `totalDollars` across `lines` in proportion to each line's ex-GST
 * total, as whole dollars that sum EXACTLY to `totalDollars`.
 *
 * Largest-remainder (Hare quota): floor every share, then hand the leftover
 * dollars one each to the largest fractional parts. Deterministic — ties break
 * on the earlier line, so the same quote always renders the same rows.
 *
 * Degenerate inputs are handled rather than hidden:
 *   • no lines            → []
 *   • every line ex-GST 0 → spread equally (a $0-rated job still reconciles)
 *   • negative total      → clamped to 0 (a credit is not representable here)
 */
export function allocateIncGst(
  lines: ReadonlyArray<AllocatableLine>,
  totalDollars: number,
): number[] {
  const n = lines.length
  if (n === 0) return []

  const total = Math.max(0, Math.round(asMoneyNumber(totalDollars)))

  // Negative line totals would let one row steal dollars from another and
  // break monotonicity; clamp each weight at 0.
  const weights = lines.map((li) => Math.max(0, asMoneyNumber(li.total_ex_gst)))
  const sum = weights.reduce((a, b) => a + b, 0)

  // All-zero weights: equal shares. Not sum || 1 — that would give line 0 the
  // whole total and every other line $0.
  const raw = sum > 0 ? weights.map((w) => (total * w) / sum) : weights.map(() => total / n)

  const shown = raw.map((v) => Math.floor(v))
  let left = total - shown.reduce((a, b) => a + b, 0)

  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)

  for (const { i } of order) {
    if (left <= 0) break
    shown[i] += 1
    left -= 1
  }

  return shown
}

/** The Subtotal / Discount / GST / Total stack under a breakdown table. */
export type PriceStack = {
  /** Ex-GST base before any discount, whole dollars. */
  baseExDollars: number
  /** Dollars taken off by the early-booking discount (0 when none). */
  discountDollars: number
  /** Ex-GST base AFTER discount — what GST is charged on. */
  netExDollars: number
  /** GST component, derived as the residual so the stack always adds up. */
  gstDollars: number
  /** The headline. Identical to displayIncGst(exGst, opts) by construction. */
  totalDollars: number
  /** True when the tradie is GST-registered (gstDollars is 0 when not). */
  gstApplies: boolean
  /** The clamped discount % actually applied. */
  discountPct: number
}

/**
 * Build the reconciling money stack for one tier.
 *
 * `gstDollars` is deliberately the RESIDUAL (total − net ex), never an
 * independent ×0.1: computing subtotal and GST separately and hoping they add
 * to the total is exactly how the pre-money.ts surfaces drifted a dollar apart.
 */
export function priceStack(exGst: number | string, opts?: MoneyOpts): PriceStack {
  const base = asMoneyNumber(exGst)
  const discountPct = clampDiscountPct(opts?.discountPct)
  const gstApplies = (opts?.gstRegistered ?? true) === true

  const netEx = discountPct > 0 ? base * (1 - discountPct / 100) : base
  // Round the net through the same cents path money.ts uses, so the residual
  // GST can never absorb a half-cent that the headline resolved the other way.
  const netExDollars = dollars(Math.round(netEx * 100))
  const baseExDollars = dollars(Math.round(base * 100))
  const totalDollars = displayIncGst(base, opts)

  return {
    baseExDollars,
    discountDollars: Math.max(0, baseExDollars - netExDollars),
    netExDollars,
    gstDollars: totalDollars - netExDollars,
    totalDollars,
    gstApplies,
    discountPct,
  }
}

/**
 * Convenience: the inc-GST total in cents for a tier, for callers that need to
 * cross-check an allocation against the charged amount.
 */
export function tierTotalCents(exGst: number | string, opts?: MoneyOpts): number {
  return totalIncGstCents(exGst, opts)
}
