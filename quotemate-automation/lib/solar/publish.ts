// ════════════════════════════════════════════════════════════════════
// Solar — the publish gate (spec §6 CTA, §7 guardrails, §5 freshness).
//
// Mirrors roofing's confirm-gate: prices are NEVER shown before the
// estimate is confirmed (confirmed_at set). As of docs/strategy.md v12
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

// solarPayRedirectTarget() was removed 2026-07-22 together with
// app/r/solar/[token]/[tier]. That route was unreachable dead code: it selected
// `token`, `paid_at`, `scheduled_at` and `stripe_links` from solar_estimates —
// none of which exist on the table (the real column is `public_token`) — so it
// 404'd before ever reaching its redirect, and its targets
// /q/solar/[token]/{book,paid} were never built. Nothing in the app linked to
// it; solar customers pay and book on the GENERIC quote pages via the twin
// quotes row (lib/solar/persist-helpers.ts writes share_token = the estimate's
// public_token), so they inherit /q/[token] → /book → /thanks for free.
// The tradie-confirmation gate that function layered on top still lives in
// lib/solar/deposit-cta.ts (resolveSolarDepositCta), which is what the solar
// page actually renders its CTAs from.
