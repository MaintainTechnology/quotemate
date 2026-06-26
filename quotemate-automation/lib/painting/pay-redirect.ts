// ════════════════════════════════════════════════════════════════════
// Painting deposit short-link — pure redirect resolution.
//
// Keeps the SMS body small: the message carries /r/paint/<token>/<tier>
// (~60 chars), and the route resolves it to the stored Stripe Checkout URL
// (or, once paid, back to the quote page). Mirrors the solar short-link's
// pure helper so the resolution is unit-tested without a route handler.
// ════════════════════════════════════════════════════════════════════

export const VALID_PAINT_TIERS: ReadonlySet<string> = new Set(['good', 'better', 'best'])

/**
 * PURE — the redirect destination for a painting deposit short-link.
 *   paid  → back to the quote page (don't re-charge a paid deposit)
 *   else  → the stored Stripe Checkout URL for the tier
 * Returns null when there's no stored link (the caller 404s).
 */
export function buildPaintRedirectUrl(args: {
  paid: boolean
  token: string
  tier: string
  stripeUrl: string | null
  appUrl: string
}): string | null {
  const { paid, token, tier, stripeUrl, appUrl } = args
  if (paid) return `${appUrl}/q/paint/${token}?paid=1&tier=${tier}`
  return stripeUrl ?? null
}
