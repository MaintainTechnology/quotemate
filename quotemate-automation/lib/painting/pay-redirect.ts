// ════════════════════════════════════════════════════════════════════
// Painting pay short-link — pure redirect resolution.
//
// Keeps the SMS body small: the message carries /r/paint/<token>/<tier>
// (~60 chars). Since spec painting-site-visit-first (2026-08-05) the ONLY
// customer payment is the flat $99 refundable site visit — the route
// redirects legacy G/B/B deposit links onto the inspection mint. Pure
// helpers so the resolution is unit-tested without a route handler.
// ════════════════════════════════════════════════════════════════════

export const VALID_PAINT_TIERS: ReadonlySet<string> = new Set(['good', 'better', 'best'])

/** The literal site-visit tier — painting's only payable tier (spec
 *  painting-site-visit-first). Deliberately NOT in VALID_PAINT_TIERS: those
 *  name the legacy deposit tiers the route now redirects here. */
export const PAINT_INSPECTION_TIER = 'inspection'

export type PaintMintTier =
  /** Legacy G/B/B deposit tier — recognised so old links redirect, never minted. */
  | { kind: 'deposit'; tier: string }
  /** Flat $99 refundable site visit — inspection-routed OR released rows. */
  | { kind: 'inspection' }
  /** Anything else → 4xx, exactly like an unknown tier. */
  | { kind: 'invalid' }

/**
 * PURE — which mint (if any) a /r/paint/<token>/<tier> click may start.
 * The 'inspection' literal is valid when the row is inspection-routed OR the
 * tradie has released it (spec painting-site-visit-first R2) — the $99 visit
 * is the only customer payment either way. A HELD row (priced, unreleased,
 * auto-routed) stays invalid: paying $99 around the tradie's release gate
 * would bypass the review-required design. G/B/B resolve as legacy deposit
 * tiers so the route can redirect them onto the inspection mint.
 */
export function resolvePaintMintTier(
  tier: string,
  routing: string | null | undefined,
  released: boolean,
): PaintMintTier {
  if (VALID_PAINT_TIERS.has(tier)) return { kind: 'deposit', tier }
  if (tier === PAINT_INSPECTION_TIER && (routing === 'inspection_required' || released)) {
    return { kind: 'inspection' }
  }
  return { kind: 'invalid' }
}

/**
 * PURE — the tier the book/thanks pay redirect charges when a visitor lands
 * there unpaid. Always the flat $99 site visit (spec painting-site-visit-first
 * R3): tier deposits are retired from every customer surface, so the old
 * ?tier= param no longer affects payment routing. A held row bounces off the
 * mint's release gate back to the quote page.
 */
export function paintPayRedirectTier(): string {
  return PAINT_INSPECTION_TIER
}

/**
 * PURE — LEGACY: the redirect destination for a per-tier deposit short-link.
 *   paid  → back to the quote page (don't re-charge a paid deposit)
 *   else  → the stored Stripe Checkout URL for the tier
 * Returns null when there's no stored link (the caller 404s).
 * No longer reachable from /r/paint — G/B/B requests redirect to the $99
 * site-visit mint (spec painting-site-visit-first R2). Kept, like the 30%
 * Session creator, as the retired deposit machinery.
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
