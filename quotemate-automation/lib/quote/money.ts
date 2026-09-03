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

/** Stripe refuses AUD charges under $0.50. A deposit or balance that lands
 *  below this is not "a small charge" — it is NO charge, and the caller must
 *  take the skip branch (spec post-visit-money-sequence R8) rather than mint a
 *  Session that throws at Stripe and dead-ends the customer on a 404. */
export const MIN_STRIPE_CHARGE_CENTS = 50

/** QuoteMax's platform fee, as a percentage of the base amount.
 *  Defined HERE (the pure money module) rather than in lib/stripe/connect.ts
 *  so the page, the SMS, the PDF and the Stripe mint all read ONE number —
 *  connect.ts's platformFeeCents delegates to surchargeCents below. */
export const PLATFORM_FEE_PCT = 2

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

// ── Post-site-visit money chain (spec post-visit-money-sequence) ─────
//
// After the $99 site visit is paid, the job splits into two further charges
// carried by their own `quotes` rows: the DEPOSIT (a % of the confirmed
// total, less the $99 already paid) and the BALANCE (everything left).
//
// The reconciliation identity, which holds for EVERY input including the
// zero-deposit edge, is the whole point of computing all three here:
//
//     CREDIT + depositBase + balanceBase === T
//
// so the customer is never charged more or less than the quoted total, and
// the two child charges plus the site visit always add back up to it.
//
// The platform fee is charged ON TOP (Jon's model): the customer pays
// base + surcharge, `application_fee_amount` IS that same surcharge, and the
// tradie therefore nets EXACTLY the base. Writing `round(base × 1.02)` for
// the charge and `platformFeeCents(charged)` for the fee would be two
// roundings of two different bases and would leave the tradie 0.04% short on
// every job — hence one function per quantity, all derived from `base`.

/** QuoteMax's fee for a base amount, in cents — the amount ADDED to what the
 *  customer pays and taken as `application_fee_amount`. One rounding. */
export function surchargeCents(baseCents: number): number {
  if (!Number.isFinite(baseCents) || baseCents <= 0) return 0
  return Math.round(baseCents * (PLATFORM_FEE_PCT / 100))
}

/** What the customer is actually charged for a base amount: base + fee.
 *  `chargedCents(b) - surchargeCents(b) === b` exactly, by construction. */
export function chargedCents(baseCents: number): number {
  if (!Number.isFinite(baseCents) || baseCents <= 0) return 0
  return baseCents + surchargeCents(baseCents)
}

/**
 * The deposit the customer owes now, in cents, BEFORE the platform fee:
 * `pct`% of the confirmed inc-GST total, less the $99 site visit they have
 * already paid. Floored at 0 — a job whose deposit is smaller than the
 * credit is fully covered by the site visit (R8), never a negative charge.
 */
export function finalDepositBaseCents(
  totalIncCents: number,
  depositPct: number | null | undefined,
): number {
  const total = asMoneyNumber(totalIncCents)
  const gross = depositCents(total, clampDepositPct(depositPct))
  return Math.max(0, gross - INSPECTION_FEE_AUD_CENTS)
}

/**
 * The balance owed on completion, in cents, before the platform fee:
 * whatever the total is not already covered by the $99 credit and the
 * deposit. Deliberately NOT floored — the identity above must hold exactly,
 * and a negative result (a total at or under $99) is a real signal that the
 * site visit covered the job. Callers gate the charge on
 * MIN_STRIPE_CHARGE_CENTS instead of clamping here.
 */
export function finalBalanceBaseCents(
  totalIncCents: number,
  depositPct: number | null | undefined,
): number {
  const total = asMoneyNumber(totalIncCents)
  return total - INSPECTION_FEE_AUD_CENTS - finalDepositBaseCents(total, depositPct)
}

/**
 * PURE — the deposit % for a job type, from the tenant's
 * `pricing_book.overlays.deposit_pct_by_job_type` map (spec R2).
 *
 * Exact `intakes.job_type` key first, then the `"default"` key, then the
 * platform default of 30. Every value goes through clampDepositPct, whose
 * documented semantics are FALLBACK not clamp: anything outside 1..90 (a
 * typo'd 100, a 0, a string) becomes 30 rather than being silently squashed
 * to the nearest bound. The seed script rejects out-of-range entries so a
 * misconfiguration is caught at write time, not at charge time.
 */
export function resolveDepositPct(
  map: unknown,
  jobType: string | null | undefined,
): number {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return 30
  const table = map as Record<string, unknown>
  const key = (jobType ?? '').trim()
  // An exact key present with a null/undefined VALUE is not a configured
  // override — it falls through to "default", the same as an absent key.
  // Otherwise {"ev_charger": null, "default": 60} would charge 30, silently
  // ignoring the default the tenant actually set.
  const exact = key && key in table ? table[key] : undefined
  const raw = exact ?? table.default
  if (raw === undefined || raw === null) return 30
  return clampDepositPct(raw as number | string)
}
