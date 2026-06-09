import { payRedirectTarget } from '../quote/booking'

export type SolarPayRedirectKind = 'locked' | 'book' | 'stripe' | 'paid'

export type SolarPayRedirectInput = {
  /** Tradie confirmation timestamp — null means the deposit is locked. */
  confirmedAt: string | null | undefined
  paid: boolean
  scheduledAt: string | null | undefined
  /** Stripe tier key. 'inspection' stays pay-first and skips the gate. */
  tier: string
}

/**
 * PURE — where /r/<token>/<tier> sends a SOLAR customer. Layers the
 * forced-confirmation gate on top of the shared book-first/pay-last
 * funnel (lib/quote/booking.payRedirectTarget):
 *
 *   inspection                 → 'stripe' (pay-first; site-visit fee)
 *   not yet confirmed          → 'locked' (no auto-send; deposit gated)
 *   confirmed, then defer to the shared funnel:
 *     already paid             → 'paid'
 *     not paid, no slot        → 'book'
 *     not paid, slot chosen     → 'stripe'
 */
export function solarPayRedirectTarget(
  input: SolarPayRedirectInput,
): SolarPayRedirectKind {
  if (input.tier === 'inspection') return 'stripe'
  if (!input.confirmedAt) return 'locked'
  return payRedirectTarget({
    paid: input.paid,
    scheduledAt: input.scheduledAt,
    tier: input.tier,
  })
}
