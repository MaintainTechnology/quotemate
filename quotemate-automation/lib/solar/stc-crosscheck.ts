// ════════════════════════════════════════════════════════════════════
// Solar — Pylon STC cross-check guardrail (premium quote spec §4.5).
//
// For each priced tier, ask Pylon's official /v1/au/stc_amount
// calculator for the STC quantity and compare it to our deterministic
// SolarStcBreakdown.certificates. |Δ| > 1 certificate appends the
// guardrail flag `stc_mismatch_pylon:{tier}` — which the existing flag
// gate turns into "cannot confirm until re-drafted clean". The check
// NEVER changes a price; Pylon is enrichment, the engine is the source
// of truth.
//
// The compare is PURE; the runner does I/O via the injected Pylon
// client opts and never throws (Pylon down ⇒ null result, log only —
// degradation matrix §4.6).
// ════════════════════════════════════════════════════════════════════

import type { SolarEstimate, SolarPriceTier } from './types'
import {
  fetchPylonStcAmount,
  pylonEnabled,
  type PylonClientOpts,
} from '../pylon/client'

/** Allowed certificate drift before flagging (spec §4.5: |Δ| > 1). */
export const STC_MISMATCH_TOLERANCE = 1

export type PylonStcTierCheck = {
  tier: 'good' | 'better' | 'best'
  our_certificates: number
  pylon_stcs: number | null
  /** our − pylon; null when Pylon returned nothing. */
  delta: number | null
  /** The guardrail flag string, or null when within tolerance. */
  flag: string | null
}

export type PylonStcCheck = {
  checked_at: string
  /** True when every tier Pylon answered for sat within tolerance. */
  verified: boolean
  tiers: PylonStcTierCheck[]
  /** Official zone facts from Pylon's calculator (supplements build
   *  2026-06-13) — display-only rebate transparency on the quote. */
  zone?: string | null
  zone_rating?: number | null
  deeming_period?: number | null
}

/** PURE — compare one tier's deterministic certificate count to Pylon's. */
export function compareStcTier(
  tier: Pick<SolarPriceTier, 'tier' | 'stc'>,
  pylonStcs: number | null,
): PylonStcTierCheck {
  const ours = tier.stc.certificates
  if (pylonStcs === null || !Number.isFinite(pylonStcs)) {
    return { tier: tier.tier, our_certificates: ours, pylon_stcs: null, delta: null, flag: null }
  }
  const delta = ours - pylonStcs
  const flag =
    Math.abs(delta) > STC_MISMATCH_TOLERANCE
      ? `stc_mismatch_pylon:${tier.tier}: our STC count (${ours}) differs from ` +
        `Pylon's official calculator (${pylonStcs}) by ${Math.abs(delta)} certificates — ` +
        'verify the zone rating and deeming year before sending.'
      : null
  return { tier: tier.tier, our_certificates: ours, pylon_stcs: pylonStcs, delta, flag }
}

/**
 * Run the cross-check for every priced tier. Returns null when the
 * integration is disabled or the estimate has no priced tiers; otherwise
 * the per-tier results + new guardrail flags. Never throws.
 */
export async function runPylonStcCrossCheck(
  args: {
    estimate: Pick<SolarEstimate, 'price' | 'context'>
    env?: { PYLON_ENABLED?: string; PYLON_API_KEY?: string }
    now?: () => Date
  },
  opts: PylonClientOpts = {},
): Promise<{ check: PylonStcCheck; flags: string[] } | null> {
  const env = args.env ?? {
    PYLON_ENABLED: process.env.PYLON_ENABLED,
    PYLON_API_KEY: process.env.PYLON_API_KEY,
  }
  if (!pylonEnabled(env)) return null

  const tiers = args.estimate.price.tiers
  if (tiers.length === 0) return null

  const clientOpts: PylonClientOpts = { apiKey: env.PYLON_API_KEY, ...opts }
  const results: PylonStcTierCheck[] = []
  // Zone facts are postcode-level (tier-independent) — keep the first
  // answer for display in the assumed-values table.
  let zone: string | null = null
  let zoneRating: number | null = null
  let deemingPeriod: number | null = null
  for (const tier of tiers) {
    let pylonStcs: number | null = null
    const res = await fetchPylonStcAmount(
      {
        output_kw: tier.system_kw_dc,
        site_postcode: args.estimate.context.postcode,
        installation_year: args.estimate.context.install_year,
      },
      clientOpts,
    )
    if (res.ok) {
      pylonStcs = res.data.stcs
      zone = zone ?? res.data.zone
      zoneRating = zoneRating ?? res.data.zone_rating
      deemingPeriod = deemingPeriod ?? res.data.deeming_period
    } else {
      console.warn(`[solar/pylon] stc_amount ${tier.tier} unavailable (${res.code}): ${res.detail}`)
    }
    results.push(compareStcTier(tier, pylonStcs))
  }

  const flags = results.flatMap((r) => (r.flag ? [r.flag] : []))
  const answered = results.filter((r) => r.pylon_stcs !== null)
  return {
    check: {
      checked_at: (args.now ? args.now() : new Date()).toISOString(),
      verified: answered.length > 0 && flags.length === 0,
      tiers: results,
      zone,
      zone_rating: zoneRating,
      deeming_period: deemingPeriod,
    },
    flags,
  }
}
