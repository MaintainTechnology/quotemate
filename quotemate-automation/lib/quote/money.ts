// The ONE money module for customer-facing quote pricing
// (spec specs/customer-quote-five-sections.md R9).
//
// Before this module, incGst was re-implemented five separate times
// (app/q/[token]/page.tsx, TradeTiers.tsx, lib/sms/templates.ts,
// lib/quote/report-html.ts, lib/stripe/checkout.ts) and each surface
// disagreed with the others on three axes:
//   • GST: conditional on pricing_book.gst_registered in the DB writes,
//     unconditional ×1.1 everywhere the customer looked (P1);
//   • discount order: dollars-rounded-then-discounted on the page,
//     discounted-then-rounded in TradeTiers, cent-precise in Stripe (P4/P5);
//   • precision: dollar-rounded display vs cent-precise charge (P8).
//
// The canonical order, computed ONCE in cents:
//   1. discount the EX-GST base (a whole-job discount reduces the job,
//      not the tax);
//   2. apply GST only when the tradie is registered;
//   3. round to cents exactly once.
// Display surfaces show dollars(centsAmount); Stripe charges the cents.
// Every surface therefore renders/charges views of the SAME number.
//
// Pure — no DB, no Stripe, no Next. Unit-tested (money.test.ts) and cross-
// surface-tested (price-parity.test.ts).

import { clampDiscountPct } from './early-bird'

/** The $99 refundable site-visit fee — the single source of truth.
 *  Previously defined twice, independently, in two units (9900 cents in
 *  lib/stripe/checkout.ts, 99 dollars in app/api/estimate/draft/route.ts),
 *  with neither derived from the other. Inc-GST by convention. */
export const INSPECTION_FEE_AUD = 99
export const INSPECTION_FEE_AUD_CENTS = INSPECTION_FEE_AUD * 100

export type MoneyOpts = {
  /** Realised early-booking discount % (quotes.applied_discount_pct).
   *  Clamped to the platform cap; 0/null/undefined → no discount. */
  discountPct?: number | null
  /** pricing_book.gst_registered. Defaults TRUE (every live tenant is
   *  registered today) so callers without the flag keep current behaviour;
   *  callers that have it pass it and a non-registered tradie's customer
   *  is no longer shown — or charged — 10% more than the stored total. */
  gstRegistered?: boolean | null
}

export function asMoneyNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? n : 0
}

/**
 * The customer-facing total in CENTS for an ex-GST subtotal: discount the
 * ex-GST base, apply GST when registered, round once.
 */
export function totalIncGstCents(exGst: number | string, opts?: MoneyOpts): number {
  const ex = asMoneyNumber(exGst)
  const pct = clampDiscountPct(opts?.discountPct)
  const discountedEx = pct > 0 ? ex * (1 - pct / 100) : ex
  const rate = (opts?.gstRegistered ?? true) ? 1.1 : 1
  return Math.round(discountedEx * rate * 100)
}

/** Deposit in CENTS from an inc-GST cents total. 0 when pct is unset/invalid. */
export function depositCents(incCents: number, depositPct: number | null | undefined): number {
  const pct = asMoneyNumber(depositPct)
  if (pct <= 0) return 0
  return Math.round((incCents * pct) / 100)
}

/** Whole-dollar view of a cents amount — what every display surface shows. */
export function dollars(cents: number): number {
  return Math.round(cents / 100)
}

/** Whole-dollar customer price for an ex-GST subtotal (display surfaces). */
export function displayIncGst(exGst: number | string, opts?: MoneyOpts): number {
  return dollars(totalIncGstCents(exGst, opts))
}

/** Whole-dollar deposit for an ex-GST subtotal, or null when no deposit. */
export function displayDeposit(
  exGst: number | string,
  depositPct: number | null | undefined,
  opts?: MoneyOpts,
): number | null {
  const dep = depositCents(totalIncGstCents(exGst, opts), depositPct)
  return dep > 0 ? dollars(dep) : null
}

/** en-AU whole-dollar formatting shared by the quote surfaces ("22,000"). */
export function fmtAud(n: number): string {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

/**
 * Per-quote deposit % (quotes.deposit_pct), clamped to the 1..90 range the
 * /r short-link has always enforced; anything else falls back to the DB
 * default of 30. The quote page previously HARDCODED 30 (P2) — a tenant on
 * a 20% rate card saw 30% advertised and was charged 20%.
 */
export function clampDepositPct(v: number | string | null | undefined): number {
  const n = asMoneyNumber(v)
  return Number.isFinite(n) && n >= 1 && n <= 90 ? Math.round(n) : 30
}
