// ════════════════════════════════════════════════════════════════════
// Solar — the publish gate (spec §6 CTA, §7 guardrails, §5 freshness).
//
// Mirrors roofing's confirm-gate: prices are NEVER shown before the
// estimate is confirmed (confirmed_at set). As of docs/strategy.md v10
// (2026-06-16) a CLEAN estimate confirms automatically at creation (Path
// B), so this gate opens on its own for it; a FLAGGED estimate stays
// unconfirmed until the tradie reviews. On top of confirmation, prices are
// also withheld if any deterministic output check flagged the estimate, or
// the solar config is stale. Each block carries a customer-facing reason
// for the /q/solar/[token] page.
//
// PURE — no I/O. Fully unit-testable.
// ════════════════════════════════════════════════════════════════════

export type PublishGateInput = {
  /** quotes/solar_estimates confirmed_at — null until the tradie signs off. */
  confirmedAt: string | null | undefined
  /** SolarEstimate.guardrail_flags — non-empty blocks publish. */
  guardrailFlags: string[]
  /** True when validateSolarConfig() returned ok:false (spec §5). */
  configStale: boolean
}

export type PublishGateResult = {
  /** Whether the customer page may render tier prices + the deposit CTA. */
  showPrices: boolean
  /** Customer-facing reason when withheld; null when prices show. */
  reason: string | null
}

/**
 * PURE — decide whether /q/solar/[token] may reveal prices + unlock the
 * deposit. Confirmation is necessary but not sufficient: a flagged or
 * stale estimate stays hidden so a bad number can never reach a customer.
 */
export function canShowPrices(input: PublishGateInput): PublishGateResult {
  if (input.configStale) {
    return {
      showPrices: false,
      reason: 'Our solar pricing data is being refreshed — your installer will be in touch shortly.',
    }
  }
  if (input.guardrailFlags.length > 0) {
    return {
      showPrices: false,
      reason: 'This estimate needs a few checks from your installer before we can show pricing.',
    }
  }
  if (!input.confirmedAt) {
    return {
      showPrices: false,
      reason:
        'We have estimated the system size and output. Your installer will review the price before it is released.',
    }
  }
  return { showPrices: true, reason: null }
}

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
