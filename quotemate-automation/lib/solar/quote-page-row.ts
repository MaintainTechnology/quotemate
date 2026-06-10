// Pure load-and-gate logic for /q/solar/[token]. Decides the confirm
// gate, the inspection gate, price visibility, and the headline tier
// (largest sizing tier — last in good→best order) the hero overlays.
// No I/O — the page passes in the persisted estimate + confirmed_at.

import type { SolarEstimate, SolarSystemTier } from './types'

export type SolarQuoteView = {
  confirmed: boolean
  inspectionRequired: boolean
  showPrices: boolean
  headlineTier: SolarSystemTier | null
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
  return { confirmed, inspectionRequired, showPrices, headlineTier }
}
