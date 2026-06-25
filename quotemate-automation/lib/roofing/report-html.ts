// Self-contained HTML for the customer roofing quote PDF, rendered by
// Gotenberg (lib/pdf/gotenberg.ts). White-label Caterpillar chrome shared
// with every trade (lib/pdf/report-chrome.ts). The roofing quote is the
// reference exemplar: lettered Part + bulleted scope + numbered priced
// options + a measurement-detail bullet list (spec specs/quote-pdf-branding.md
// R4/R5). Pure — unit-tested.

import type { MultiRoofQuote, RoofStructurePrice, RoofMetrics, RoofMaterial } from './types'
import type { RoofDisplayRow } from './selection'
import {
  renderReportDocument,
  renderPart,
  renderFigure,
  renderFigurePair,
  brandingFromName,
  esc,
  aud0,
  type TenantBranding,
} from '../pdf/report-chrome'

export type RoofReportInput = {
  businessName: string
  /** Full white-label branding; when omitted, derived from businessName. */
  branding?: TenantBranding
  address: string
  quote: MultiRoofQuote
  /**
   * EVERY detected structure, annotated priced / inspection / excluded
   * (partitionRoofQuote). When supplied, the "Structures measured" table also
   * lists structures the tradie EXCLUDED — marked "not included", never priced
   * into the headline total (`quote` is the narrowed, included-only quote).
   * Omitted ⇒ back-compat: render only `quote.structures` from their own routing.
   */
  displayRows?: RoofDisplayRow[]
  quoteViewUrl?: string | null
  /**
   * Hero roof figure: the coloured outline tracing on a plain background as a
   * data: URI (built by lib/roofing/roof-outline-svg.ts). Null ⇒ no usable
   * geometry; the figure falls back to the aerial reference alone.
   */
  outlineImageSrc?: string | null
  /** Secondary aerial reference thumbnail (already a data: URI or fetchable URL). */
  mapImageSrc?: string | null
  /**
   * One AERIAL image per INCLUDED structure (the caller omits excluded ones),
   * each centred on its building, captioned with the structure label. When 2+
   * are supplied the report shows the combined outline hero followed by one
   * captioned aerial per structure — fixing the old behaviour where only the
   * first structure's aerial appeared. 0–1 entries fall back to the existing
   * outline-hero + single aerial-thumb pair, so single-structure quotes are
   * unchanged. (spec specs/roofing-pdf-multi-structure-images.md R3)
   */
  structureImages?: { label: string; src: string | null }[]
  generatedAt?: Date
}

/** A structure + its display state, for the "Structures measured" table. */
type StructureLine = { structure: RoofStructurePrice; state: 'priced' | 'inspection' | 'excluded' }

const MATERIAL_LABELS: Record<RoofMaterial, string> = {
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
function structureMeasurementBullet(s: RoofStructurePrice): string {
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

function measurementBullets(q: MultiRoofQuote): string[] {
  const out: string[] = [
    `Approx. ~${Math.round(q.combined.area_m2)} m² of sloped roof measured across ${
      q.structures.length
    } structure${q.structures.length === 1 ? '' : 's'} from aerial imagery.`,
  ]
  for (const s of q.structures) out.push(structureMeasurementBullet(s))
  return out
}

function structureRows(lines: StructureLine[]): string {
  return lines
    .map(({ structure: s, state }) => {
      const area = s.metrics?.sloped_area_m2 != null ? `${Math.round(s.metrics.sloped_area_m2)} m²` : '—'
      const better = s.price.tiers?.[1]
      let works: string
      let price: string
      if (state === 'excluded') {
        works = '<span class="flag">not included in this quote</span>'
        price = '—'
      } else if (state === 'inspection') {
        works = '<span class="flag">needs on-site look</span>'
        price = '—'
      } else {
        works = esc(better?.label ?? 'Re-roof')
        price = aud0(better?.inc_gst ?? 0)
      }
      return `
      <tr>
        <td>${esc(s.label)}</td>
        <td class="num">${area}</td>
        <td>${works}</td>
        <td class="num">${price}</td>
      </tr>`
    })
    .join('')
}

/**
 * Display lines for the structures table: the partition rows (which include
 * EXCLUDED structures) when supplied, else back-compat from quote.structures
 * (each priced or flagged by its own routing).
 */
function structureLines(input: RoofReportInput): StructureLine[] {
  if (input.displayRows) {
    return input.displayRows.map((r) => ({ structure: r.structure, state: r.state }))
  }
  return input.quote.structures.map((s) => ({
    structure: s,
    state: s.price.routing.decision === 'inspection_required' ? 'inspection' : 'priced',
  }))
}

/** Standard roofing inclusions — the bulleted scope of works (R4). */
const ROOF_SCOPE_BULLETS = [
  'Install temporary safety rail / fall-arrest and provide all OHS management as required.',
  'Remove existing roof areas as measured and described above.',
  'Replace rotten or insufficient roof battens as required and batten-screw as required.',
  'Provide increased tie-downs from rafters to top plates as required for certification.',
  'Supply and install new roof sheets, flashings and capping; scribe to the profile of sheets.',
  'Supply and install Dektite flashings to roof penetrations as required.',
  'Remove safety rail and all waste from site on completion.',
  'Installation warranty plus manufacturer’s material warranty (see manufacturer for details).',
]

/** Per-trade default "Please Note" disclaimers (R7), merged with the routing reason. */
const ROOF_PLEASE_NOTE = [
  'Quote is subject to site inspection and customer consultation.',
  'No gutter or downpipe works are included unless expressly stated — please request a quote if required.',
  'Other than what is expressly noted, no electrical, carpentry, painting, ceiling, fascia or structural repairs are included; any such works would be quoted as an extra.',
  'No asbestos removal, air monitoring or decontamination is included; if required this would be quoted and charged as an extra.',
  'It is the property owner’s responsibility to move or protect furniture, pots, ornaments and plants away from the areas of works.',
  'Measured from aerial imagery; a roofer reviews every quote before any works are booked.',
]

export function buildRoofQuoteReportHtml(input: RoofReportInput): string {
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const branding = input.branding ?? brandingFromName(input.businessName)
  const q = input.quote
  const isInspection = q.routing.decision === 'inspection_required'
  const tiers = q.combined.tiers

  let body = ''

  if (isInspection) {
    body += renderPart({
      marker: 'A',
      title: 'Next step: on-site inspection',
      note: q.routing.reason ?? 'This roof needs a quick look on site before we can price it accurately.',
      bullets: measurementBullets(q),
    })
  } else {
    // Part A — the main roof works, with bulleted scope and the three
    // priced options as numbered "= $X including GST" lines (reference shape).
    // Option 1 is the included baseline re-roof; dearer tiers are flagged as
    // optional upgrades so the compulsory/optional distinction is visible (R4).
    const priceLines = tiers.map(
      (t, i) =>
        `<span class="price">${esc(t.label)} = ${aud0(t.inc_gst)} including GST</span>` +
        (i > 0 ? ` <span class="chip">Optional upgrade</span>` : '') +
        (t.scope ? ` <span class="caveat">(${esc(t.scope)})</span>` : ''),
    )
    body += renderPart({
      marker: 'A',
      title: 'Roof replacement',
      note: `Includes the roof areas measured below at ${esc(input.address)}.`,
      bullets: ROOF_SCOPE_BULLETS,
      priceLines,
    })

    // Roof measurement detail — descriptive bullets (R5).
    body += `<h2>Roof measurement</h2>`
    body += renderPart({ marker: 'B', title: 'Measured roof detail', bullets: measurementBullets(q) })
  }

  // Roof figure(s). The coloured outline tracing (hero) already draws EVERY
  // structure; the AERIAL photo was the single-structure one (the bug Jon
  // raised). With 2+ per-structure aerials, show the outline hero then one
  // captioned aerial per included structure; with 0–1, keep the existing
  // outline-hero + aerial-thumb pair byte-for-byte so single-structure quotes
  // are unchanged (spec roofing-pdf-multi-structure-images R3; the outline
  // caption no longer claims the aerial photo itself is the outline).
  const aerials = (input.structureImages ?? []).filter((f) => f.src)
  if (aerials.length > 1) {
    body += renderFigure(input.outlineImageSrc, 'Roof outline traced from your measured roof areas.')
    for (const f of aerials) {
      body += renderFigure(f.src, `${f.label} — aerial reference, measured from satellite imagery.`)
    }
  } else {
    body += renderFigurePair({
      heroSrc: input.outlineImageSrc,
      heroCaption: 'Roof outline traced from your measured roof areas.',
      thumbSrc: input.mapImageSrc,
      thumbCaption: 'Aerial reference — measured from satellite imagery.',
    })
  }

  // Per-structure breakdown table (kept from the prior report).
  body += `
  <h2>Structures measured</h2>
  <table>
    <thead><tr><th>Structure</th><th class="num">Sloped area</th><th>Recommended works</th><th class="num">Re-roof (inc GST)</th></tr></thead>
    <tbody>${structureRows(structureLines(input))}</tbody>
  </table>`
  if (q.inspection_structures.length > 0) {
    body += `<p class="note">Needing an on-site look before final pricing: ${q.inspection_structures
      .map(esc)
      .join(', ')}.</p>`
  }

  const pleaseNote = isInspection
    ? ROOF_PLEASE_NOTE
    : [...ROOF_PLEASE_NOTE]

  const closingLine = input.quoteViewUrl
    ? `Roof image, map and live quote: ${input.quoteViewUrl}`
    : null

  return renderReportDocument(branding, {
    docTitle: `Roofing quote — ${branding.businessName}`,
    eyebrow: `Roofing quote · ${isInspection ? 'Inspection required' : 'Good / Better / Best'}`,
    dateLabel: date,
    siteAddress: input.address,
    introHtml: `Thank you for the opportunity to quote for roof works at <strong>${esc(
      input.address,
    )}</strong>. See below the scope of works and your re-roof options — the first option is the included re-roof, with the dearer tiers offered as optional upgrades priced separately, and notes to guide you through them.`,
    bodyHtml: body,
    pleaseNote,
    closingLine,
  })
}
