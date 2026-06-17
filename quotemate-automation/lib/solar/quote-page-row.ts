// Pure load-and-gate logic for /q/solar/[token]. Decides the confirm
// gate, the inspection gate, price visibility, and the headline tier
// (largest sizing tier — last in good→best order) the hero overlays.
// No I/O — the page passes in the persisted estimate + confirmed_at.

import type { SolarEstimate, SolarSystemTier } from './types'

/** A short, plain-English explanation shown when the largest system we could
 *  size is SMALLER than what the customer's roof / request implied — so a
 *  "6 kW" result never looks like an unexplained shrink (the export-limit
 *  clamp that confused pilot testers asking for 14 kW on single-phase). */
export type SolarSizeNote = {
  title: string
  body: string
} | null

export type SolarQuoteView = {
  confirmed: boolean
  inspectionRequired: boolean
  showPrices: boolean
  headlineTier: SolarSystemTier | null
  sizeNote: SolarSizeNote
}

export function resolveSolarQuoteView(args: {
  estimate: SolarEstimate
  confirmedAt: string | null
}): SolarQuoteView {
  const confirmed = args.confirmedAt != null
  const inspectionRequired =
    args.estimate.routing.decision === 'inspection_required'
  const showPrices = confirmed && !inspectionRequired
  const tiers = args.estimate.sizing.tiers
  const headlineTier = tiers[tiers.length - 1] ?? null
  return {
    confirmed,
    inspectionRequired,
    showPrices,
    headlineTier,
    sizeNote: resolveSolarSizeNote(args.estimate),
  }
}

/** Round to 1 dp for display; whole numbers drop the decimal. */
function kw1(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/**
 * PURE — explain why the headline system is the size it is, when (and only
 * when) it came out smaller than the customer would expect:
 *
 *   • The top tier is above the standard DNSP export allowance
 *     (`export_limited`). A stated preferred size remains the proposal, but
 *     gets connection/phase confirmation copy instead of being silently
 *     shrunk.
 *   • Otherwise, if the customer asked for a preferred size larger than the
 *     roof physically fits, say the roof is the limit.
 *
 * Returns null when the system is NOT constrained below expectation (no note
 * needed) — e.g. no preferred size and no export cap, or the customer got at
 * least what they asked for.
 */
export function resolveSolarSizeNote(estimate: SolarEstimate): SolarSizeNote {
  const sizing = estimate.sizing
  const tiers = sizing.tiers
  const headline = tiers[tiers.length - 1] ?? null
  if (!headline) return null

  const requested = sizing.requested_size_kw
  const phase = sizing.phase
  const exportLimitAc = sizing.export_limit_kw_ac
  const network = estimate.context?.network ?? 'your network'

  // The proposed system is above the standard export allowance, or the
  // no-preference auto-size was shaped by it. Explain the connection review
  // without implying a preferred request was ignored.
  if (headline.export_limited) {
    const proposed = `${kw1(headline.system_kw_dc)} kW`
    const limit = Number.isFinite(exportLimitAc) ? `${kw1(exportLimitAc)} kW` : null
    const requestDelta =
      requested != null && headline.system_kw_dc < requested - 0.05
        ? ` The ${kw1(requested)} kW you asked for was limited to ${proposed} by the roof or public quote maximum.`
        : ''
    if (phase === 'unknown' || phase == null) {
      return {
        title: `${proposed} needs your power supply confirmed`,
        body:
          `You selected "Not sure", so this proposal keeps the preferred roof layout but flags ${network}'s standard export allowance` +
          `${limit ? ` (${limit})` : ''}. ` +
          `Your installer will confirm the supply phase, export limiting, battery option, or network approval needed for this size.` +
          requestDelta,
      }
    }
    if (phase === 'single') {
      return {
        title: `${proposed} needs export-limit design review`,
        body:
          `This proposal is above the standard single-phase export allowance` +
          `${limit ? ` (${limit})` : ''}. ` +
          `Your installer will confirm whether it needs export limiting, a battery, network approval, or a 3-phase upgrade.` +
          requestDelta,
      }
    }
    return {
      title: `${proposed} needs network export confirmation`,
      body:
        `Your network limits how much solar can be exported to the grid${limit ? ` (${limit})` : ''}. ` +
        `Your installer will confirm the export setting, battery option, or network approval for this system.` +
        requestDelta,
    }
  }

  // Not export-capped, but the roof fits less than the customer requested.
  if (requested != null && headline.system_kw_dc < requested - 0.05) {
    return {
      title: `Your roof fits up to ${kw1(headline.system_kw_dc)} kW`,
      body:
        `That's smaller than the ${kw1(requested)} kW you asked for — it's the most panels that fit on the usable roof area we measured. ` +
        `Your installer can confirm on site.`,
    }
  }

  return null
}
