// ════════════════════════════════════════════════════════════════════
// Solar — deterministic output check (spec §7).
//
// Solar's analogue of the strict-grounding validator. Every published
// estimate must satisfy: net = gross − STC, gross within sane $/kW
// bounds, payback within years bounds, AC/kW within ±35% of the CEC
// benchmark. Any violation appends a human string to guardrail_flags;
// flagged estimates route to tradie review and NEVER publish silently.
//
// PURE — no I/O. Fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type { SolarPriceTier } from './types'

/** Allowed rounding drift between net and (gross − rebate), in dollars. */
const NET_IDENTITY_TOLERANCE_AUD = 0.011

/**
 * PURE — verify net_ex_gst === gross_ex_gst − stc.rebate_aud for one tier.
 * Returns [] when the identity holds (within a 1-cent tolerance), or a
 * one-element array describing the breach.
 */
export function checkNetIdentity(tier: SolarPriceTier): string[] {
  const expectedNet = tier.gross_ex_gst - tier.stc.rebate_aud
  const drift = Math.abs(tier.net_ex_gst - expectedNet)
  if (drift <= NET_IDENTITY_TOLERANCE_AUD) return []
  return [
    `${tier.tier}: net price ($${tier.net_ex_gst.toFixed(2)}) does not equal ` +
      `gross − STC ($${tier.gross_ex_gst.toFixed(2)} − $${tier.stc.rebate_aud.toFixed(2)} ` +
      `= $${expectedNet.toFixed(2)}).`,
  ]
}
