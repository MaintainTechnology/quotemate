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

/** Format an ISO YYYY-MM-DD as e.g. '14 Mar 2025'; null on bad input. */
function formatImageryDate(iso: string | null): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  const monthIdx = Number(m[2]) - 1
  if (monthIdx < 0 || monthIdx > 11) return null
  return `${Number(m[3])} ${months[monthIdx]} ${m[1]}`
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
    const date = formatImageryDate(roof.imagery_date)
    caption = date
      ? `Indicative layout based on Google aerial imagery, ${date}.`
      : 'Indicative layout based on Google aerial imagery.'
  }

  return { stats, caption }
}
