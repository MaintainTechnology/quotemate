// Pure presenter for the confidence-band chip on /q/solar/[token].
// Spec §6: ±20% for covered + tight; ±30% + "indicative only" chip for
// the wide band OR any manual-fallback estimate (declared roof). Manual
// coverage always degrades to wide regardless of the stored band.

import type { SolarConfidenceBand, SolarCoverageSource } from './types'

export type SolarConfidenceChip = {
  /** Display width, e.g. '±20%'. */
  bandLabel: string
  /** Maintain colour role for the chip border/text. */
  tone: 'accent' | 'warning'
  /** When true, render the "Indicative only" warning chip. */
  indicativeOnly: boolean
  /** One-line caption shown under the chip. */
  caption: string
}

export function confidenceChip(args: {
  band: SolarConfidenceBand
  coverageSource: SolarCoverageSource
}): SolarConfidenceChip {
  if (args.coverageSource === 'manual') {
    return {
      bandLabel: '±30%',
      tone: 'warning',
      indicativeOnly: true,
      caption:
        'Based on the details you provided — your installer will confirm from a site visit.',
    }
  }
  if (args.band === 'wide') {
    return {
      bandLabel: '±30%',
      tone: 'warning',
      indicativeOnly: true,
      caption: 'Wider ±30% range — your installer will refine this on site.',
    }
  }
  return {
    bandLabel: '±20%',
    tone: 'accent',
    indicativeOnly: false,
    caption: 'Estimate accuracy ±20% based on aerial imagery.',
  }
}
