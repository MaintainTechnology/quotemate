// c:/Users/dalig/Downloads/QuoteMate/quoteMate/.claude/worktrees/solar-estimate/quotemate-automation/lib/solar/hero-overlay.ts
// Pure builder for the satellite-hero stats overlay + imagery caption on
// /q/solar/[token] (spec §6). The overlay sits over the REAL Google
// satellite photo (no generative panels). Caption carries the imagery
// date for Google estimates; manual-fallback estimates say "details you
// provided" instead.

import type { SolarOrientation, SolarRoofFacts, SolarSystemTier } from './types'
import { kw, kwh } from './quote-page-format'

const ORIENTATION_LABELS: Record<SolarOrientation, string> = {
  north: 'North',
  north_east: 'North-east',
  east: 'East',
  south_east: 'South-east',
  south: 'South',
  south_west: 'South-west',
  west: 'West',
  north_west: 'North-west',
  flat: 'Flat',
  unknown: 'To confirm',
}

export function orientationLabel(o: SolarOrientation): string {
  return ORIENTATION_LABELS[o] ?? 'To confirm'
}

export type SolarHeroOverlay = {
  stats: Array<{ label: string; value: string }>
  caption: string
}

export function buildHeroOverlay(args: {
  headlineTier: SolarSystemTier | null
  roof: SolarRoofFacts
  annualKwhAc: number
}): SolarHeroOverlay {
  const { headlineTier, roof, annualKwhAc } = args
  const stats = [
    {
      label: 'System size',
      value: headlineTier ? `${kw(headlineTier.system_kw_dc)} kW` : 'To confirm',
    },
    { label: 'Panels', value: headlineTier ? String(headlineTier.panels_count) : 'To confirm' },
    { label: 'Orientation', value: orientationLabel(roof.primary_orientation) },
    {
      label: 'Yearly output',
      value: annualKwhAc > 0 ? `${kwh(annualKwhAc)} kWh` : 'To confirm',
    },
  ]

  let caption: string
  if (roof.source === 'manual') {
    caption = 'Indicative layout based on the roof details you provided.'
  } else {
    // The hero photo is served by Google Maps Static — Google's freshest
    // default satellite tiles, returned with no capture date. roof.imagery_date
    // is the Solar API buildingInsights vintage: a SEPARATE, often-older
    // dataset used only for roof geometry. Printing it here mislabelled a
    // current photo with a stale date (e.g. "27 Oct 2017"), so we don't.
    // (The heatmap caption in sun-view.ts correctly keeps its Solar-API
    // date — that image genuinely IS that dataset.)
    caption = 'Indicative layout based on the latest Google aerial imagery.'
  }

  return { stats, caption }
}
