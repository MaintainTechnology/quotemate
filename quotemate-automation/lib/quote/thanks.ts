// Gate + labelling for the thank-you page (spec 2026-07-22 booking three-page
// split, R4). Pure — no DB, no Stripe, no Next — so the gate can't silently
// regress and every funnel resolves it identically.

/**
 * What /thanks should do for this row.
 *
 *   not paid          → 'pay'    (the funnel's pay short-link)
 *   paid, no slot     → 'book'   (pick a time first)
 *   paid + slot       → 'render' (confirmed — the only renderable state)
 *
 * The page must never render a half-state: a "what's booked" card with no
 * booking, or a thank-you for a payment that hasn't happened, is worse than a
 * redirect. Paid is checked FIRST — an unpaid visitor holding a legacy slot
 * still owes money.
 */
export function thanksPageTarget(input: {
  paid: boolean
  scheduledAt: string | null | undefined
  /** quotes.quote_kind (spec post-visit-money-sequence R11). A 'final' or
   *  'balance' child never has a slot, so the 'book' branch below would send
   *  it to a calendar for a visit that already happened. Children are sent to
   *  'pay' — the quote page — whose kind-aware paid state is their real
   *  thank-you surface. */
  quoteKind?: string | null | undefined
}): 'pay' | 'book' | 'render' {
  if (input.quoteKind === 'final' || input.quoteKind === 'balance') return 'pay'
  if (!input.paid) return 'pay'
  return input.scheduledAt ? 'render' : 'book'
}

/** Human-quotable booking reference — the token's first 8 chars, uppercased.
 *  Empty (not a placeholder) when there is no token, so the caller omits the
 *  row rather than printing something the customer can't quote back. */
export function bookingRef(token: string | null | undefined): string {
  return (token ?? '').slice(0, 8).toUpperCase()
}
