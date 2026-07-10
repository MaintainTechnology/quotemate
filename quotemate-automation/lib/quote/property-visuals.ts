// Spec specs/quote-visual-parity.md R1 — pure derivation of the generic
// report's property-visuals block (satellite image + measurement stat grid)
// from a quotes-row's trade + intake.scope snapshot. Mirrors what the
// customer page already shows: RoofHeroStrip (app/q/[token]/RoofHeroStrip.tsx)
// for roofing, CommercialPaintDetails takeoff summary for commercial painting.
// The IMAGE is I/O and belongs to the caller (lib/quote/pdf.ts): a data URI
// for the PDF, the token-gated proxy URL for the live HTML preview.
// NO I/O here — unit-tested.

import { roofScopeStats, commercialPaintScope } from './trade-scope'
import type { QuoteReportPropertyVisuals } from './report-html'

// Same disclaimer framing the customer page's RoofHeroStrip carries.
const ROOF_DISCLAIMER =
  'The numbers on this quote are calculated from satellite imagery and your declared roof material and pitch. Your final price is locked after our on-site inspection.'

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function quotePropertyVisuals(
  trade: string,
  scope: unknown,
  imageSrc: string | null,
): QuoteReportPropertyVisuals | null {
  if (trade === 'roofing') {
    const s = roofScopeStats(scope)
    const stats: Array<{ label: string; value: string }> = []
    if (s) {
      if (s.area_m2 !== null) stats.push({ label: 'Sloped area', value: `${s.area_m2.toFixed(0)} m²` })
      if (s.material) stats.push({ label: 'Material', value: titleCase(s.material) })
      if (s.form) stats.push({ label: 'Roof form', value: titleCase(s.form) })
      if (s.pitch) stats.push({ label: 'Pitch', value: titleCase(s.pitch) })
      if (s.hips !== null || s.valleys !== null)
        stats.push({ label: 'Hips · valleys', value: `${s.hips ?? '—'} · ${s.valleys ?? '—'}` })
      if (s.ridge_lm !== null) stats.push({ label: 'Ridge', value: `${s.ridge_lm.toFixed(0)} lm` })
      if (s.storeys !== null) stats.push({ label: 'Storeys', value: String(s.storeys) })
      if (s.footprint_m2 !== null)
        stats.push({ label: 'Footprint', value: `${s.footprint_m2.toFixed(0)} m²` })
    }
    if (!imageSrc && stats.length === 0) return null
    return {
      imageSrc,
      caption: 'Your roof, from above · Google Maps satellite',
      stats,
      disclaimer: ROOF_DISCLAIMER,
    }
  }

  if (trade === 'commercial_painting') {
    const s = commercialPaintScope(scope)
    const stats: Array<{ label: string; value: string }> = []
    if (s) {
      if (s.total_m2 !== null)
        stats.push({
          label: 'Measured area',
          value: `${Math.round(s.total_m2).toLocaleString('en-AU')} m²`,
        })
      if (s.surfaces !== null) stats.push({ label: 'Surfaces', value: String(s.surfaces) })
      if (s.labour_hours !== null)
        stats.push({ label: 'Labour hours', value: String(Math.round(s.labour_hours)) })
      if (s.crew_size !== null) stats.push({ label: 'Crew size', value: String(s.crew_size) })
      if (s.estimated_days !== null)
        stats.push({ label: 'Est. days', value: String(s.estimated_days) })
    }
    if (!imageSrc && stats.length === 0) return null
    return { imageSrc, caption: 'Site aerial · Google Maps satellite', stats, disclaimer: null }
  }

  return null
}
