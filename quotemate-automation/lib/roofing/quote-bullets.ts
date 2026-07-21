// Customer-facing roofing bullet text — ONE source for the quote pages
// (/q/[token], /q/roof/[token]) and the PDF (lib/roofing/report-html.ts).
//
// These builders used to be private to report-html.ts, so the customer PAGE
// showed only the one-line scope sentence while the PDF carried the full
// measured detail. Moved here (leaf module, imports ./types only) so a server
// component can render them without pulling in the Gotenberg/PDF graph, and so
// the page and the PDF can never drift apart. Pure — unit-tested.

import type { MultiRoofQuote, RoofMaterial, RoofMetrics, RoofStructurePrice } from './types'

export const MATERIAL_LABELS: Record<RoofMaterial, string> = {
  colorbond_corrugated: 'COLORBOND corrugated',
  colorbond_trimdek: 'COLORBOND Trimdek',
  colorbond_spandek: 'COLORBOND Spandek',
  colorbond_kliplok: 'COLORBOND Kliplok',
  concrete_tile: 'concrete tile',
  terracotta_tile: 'terracotta tile',
  cement_sheet: 'cement sheet',
  unknown: 'existing material',
}

const FORM_LABELS: Record<string, string> = {
  gable: 'gable',
  hip: 'hip',
  skillion: 'skillion',
  gable_hip: 'gable/hip',
  complex: 'complex',
  unknown: '',
}

/** Per-structure measurement bullets — only the fields the provider returned. */
export function structureMeasurementBullet(s: RoofStructurePrice): string {
  const m: Partial<RoofMetrics> = s.metrics ?? {}
  const bits: string[] = []
  if (m.sloped_area_m2 != null) bits.push(`~${Math.round(m.sloped_area_m2)} m² sloped area`)
  else if (m.footprint_m2 != null) bits.push(`~${Math.round(m.footprint_m2)} m² footprint`)
  const form = m.form ? FORM_LABELS[m.form] : ''
  if (form) bits.push(`${form} roof form`)
  if (m.pitch_degrees != null) bits.push(`~${Math.round(m.pitch_degrees)}° pitch`)
  if (m.storeys != null) bits.push(`${m.storeys}-storey`)
  if (m.ridge_lm != null) bits.push(`~${Math.round(m.ridge_lm)} lm ridge/hip`)
  const mat = s.inputs?.material ? MATERIAL_LABELS[s.inputs.material] : ''
  if (mat) bits.push(mat)
  return `${s.label}: ${bits.length ? bits.join(', ') : 'measured from aerial imagery'}`
}

export function measurementBullets(q: MultiRoofQuote): string[] {
  const area = q.combined?.area_m2 ?? 0
  const n = q.structures.length
  const out: string[] = []
  // ponytail: an all-inspection job totals 0 m² — skip the summary line rather
  // than print "~0 m² of sloped roof" at the customer.
  if (area > 0) {
    out.push(
      `Approx. ~${Math.round(area)} m² of sloped roof measured across ${n} structure${
        n === 1 ? '' : 's'
      } from aerial imagery.`,
    )
  }
  for (const s of q.structures) out.push(structureMeasurementBullet(s))
  return out
}

/** Standard roofing inclusions — the bulleted scope of works (R4). */
export const ROOF_SCOPE_BULLETS = [
  'Install temporary safety rail / fall-arrest and provide all OHS management as required.',
  'Remove existing roof areas as measured and described above.',
  'Replace rotten or insufficient roof battens as required and batten-screw as required.',
  'Provide increased tie-downs from rafters to top plates as required for certification.',
  'Supply and install new roof sheets, flashings and capping; scribe to the profile of sheets.',
  'Supply and install Dektite flashings to roof penetrations as required.',
  'Remove safety rail and all waste from site on completion.',
  'Installation warranty plus manufacturer’s material warranty (see manufacturer for details).',
]

/**
 * Customer section 02 "Job details": what we'll do, then what we measured.
 * ONE builder for both quote pages and the PDF.
 *
 * A patch/repair featured tier ('good') skips the inclusions — they describe a
 * full strip-and-replace ("Remove existing roof areas", "install new roof
 * sheets"), which would misdescribe a patch job to the customer.
 *
 * Callers MUST pass the narrowed quote (included structures only), never the
 * full measurement — otherwise the bullets would describe sheds the customer
 * isn't being charged for.
 */
export function jobDetailBullets(
  q: MultiRoofQuote | null | undefined,
  tier?: 'good' | 'better' | 'best' | null,
): string[] {
  if (!q?.structures?.length) return []
  return [...(tier === 'good' ? [] : ROOF_SCOPE_BULLETS), ...measurementBullets(q)]
}
