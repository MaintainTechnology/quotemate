// ════════════════════════════════════════════════════════════════════
// Painting — the tradie-release gate (mirrors lib/solar/publish.ts).
//
// A painting quote requested over SMS / the self-serve form is DRAFTED and
// held: the customer never sees the price or the deposit links until the
// tradie reviews it and clicks "Send to customer" (which stamps released_at).
// A dashboard-initiated save is tradie-authored already, so it is released
// at save time and shows immediately.
//
// canShowPaintingPrices gates the /q/paint/[token] page; paintingDepositLocked
// gates the /r/paint/[token]/[tier] deposit short-link; paintingRelease
// Eligibility makes the release idempotent (a second Send is a no-op).
//
// PURE — no I/O. Fully unit-testable.
// ════════════════════════════════════════════════════════════════════

export type PaintingPublishGateInput = {
  /** painting_measurements.released_at — null until the tradie sends. */
  releasedAt: string | null | undefined
}

export type PaintingPublishGateResult = {
  /** Whether the customer page may render tier prices + the deposit CTA. */
  showPrices: boolean
  /** Customer-facing reason when withheld; null when prices show. */
  reason: string | null
}

/**
 * PURE — may /q/paint/[token] reveal prices + unlock the deposit links? Only
 * once the tradie has released the quote. Until then the customer sees a
 * holding message, not a number.
 */
export function canShowPaintingPrices(input: PaintingPublishGateInput): PaintingPublishGateResult {
  if (!input.releasedAt) {
    return {
      showPrices: false,
      reason:
        'Your painter is finalising your quote and will send the prices through shortly.',
    }
  }
  return { showPrices: true, reason: null }
}

/**
 * PURE — is the deposit short-link locked? The /r/paint redirect must not
 * resolve to Stripe before the tradie releases the quote (else a customer
 * could pay against an unreviewed price).
 */
export function paintingDepositLocked(releasedAt: string | null | undefined): boolean {
  return !releasedAt
}

export type PaintingReleaseEligibility =
  | { ok: true; stamp: boolean }
  | { ok: false; status: number; error: string }

/**
 * PURE — decide whether a "Send to customer" should stamp released_at.
 *   already released → ok, stamp:false (idempotent no-op; never re-sends)
 *   not released yet → ok, stamp:true  (stamp + send the customer quote)
 * Mirrors lib/solar/release.ts confirmEligibility (painting has no guardrail
 * flags, so there is no blocked case).
 */
export function paintingReleaseEligibility(input: {
  alreadyReleasedAt: string | null | undefined
}): PaintingReleaseEligibility {
  if (input.alreadyReleasedAt) return { ok: true, stamp: false }
  return { ok: true, stamp: true }
}
