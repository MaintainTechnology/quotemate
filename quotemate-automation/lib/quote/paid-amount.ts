// What the customer ACTUALLY paid, for the thank-you page.
//
// The trade tables (roofing_measurements / painting_measurements) historically
// recorded only paid_tier, so a $99 site-visit figure had to be inferred from a
// constant. That is wrong the moment a tenant charges anything else — and the
// sibling bug already shipped once: the five-sections live check found the
// /paid card reading "Paid $22,000.00" on a $99 site-visit payment, because it
// displayed total_inc_gst.
//
// Migration 181 adds paid_amount_cents to both trade tables (quotes already had
// it from mig 160), stamped from the Stripe Session's amount_total. This
// resolver prefers that recorded figure; the fallbacks exist only for rows
// written before the migration, and it returns null rather than guess.

import { INSPECTION_FEE_AUD } from './money'

export function resolvePaidAmount(input: {
  /** Stripe amount_total in cents (mig 181 on the trade tables, mig 160 on quotes). */
  paidAmountCents: number | null | undefined
  paidTier: string | null | undefined
  /** Quote total inc GST — the legacy deposit fallback only. */
  totalIncGst: number | null | undefined
}): number | null {
  const cents = Number(input.paidAmountCents)
  if (Number.isFinite(cents) && cents > 0) return cents / 100

  // Legacy rows: the flat fee is knowable from the tier. Checked BEFORE the
  // quote total so an inspection payment can never display the tier price.
  if (input.paidTier === 'inspection') return INSPECTION_FEE_AUD

  const total = Number(input.totalIncGst)
  if (Number.isFinite(total) && total > 0) return total

  return null
}

/** Display string for the amount, or null so the caller omits the row entirely
 *  rather than printing a placeholder where money should be. */
export function formatPaidAmount(amount: number | null): string | null {
  if (amount == null) return null
  return `$${amount.toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
