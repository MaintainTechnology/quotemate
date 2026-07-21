// Self-contained HTML for the customer roofing quote PDF, rendered by
// Gotenberg (lib/pdf/gotenberg.ts). White-label Caterpillar chrome shared
// with every trade (lib/pdf/report-chrome.ts). The roofing quote is the
// reference exemplar: lettered Part + bulleted scope + numbered priced
// options + a measurement-detail bullet list (spec specs/quote-pdf-branding.md
// R4/R5). Pure — unit-tested.

import type { MultiRoofQuote, RoofStructurePrice, RoofingPriceTier } from './types'
import { ROOF_SCOPE_BULLETS, jobDetailBullets, measurementBullets } from './quote-bullets'
import { applySolarToTiers } from '../sms/roofing-compose'
import type { RoofDisplayRow } from './selection'
import { ZONE_COLOR_HEX, type ZoneColor, type LayoutMaterialItem } from './layout-plan'
import {
  renderReportDocument,
  renderPart,
  renderFigure,
  renderFigurePair,
  renderTradieBlock,
  brandingFromName,
  esc,
  aud0,
  type TenantBranding,
} from '../pdf/report-chrome'

/** The AI work-strategy layout map + deterministic BOM, built ONLY from a cached
 *  plan (roofing_measurements.layout_plan when layout_status = 'ready'). Shared so
 *  the roofing-native report AND the generic quotes-row report render it identically. */
export type RoofLayoutOverlay = {
  header: string
  aerialSrc: string
  overlaySrc: string
  legend: Array<{ color: ZoneColor; label: string }>
  /** Deterministic material estimates (layoutMaterials over the whole-job
   *  metrics) — rendered with each item's basis + use for transparency. */
  materials?: { items: LayoutMaterialItem[]; note: string | null } | null
}

/** Shared HTML for the "Your roof layout map" + "Estimated materials" section, so
 *  a roofing quote's downloadable PDF carries them whichever report builds it. */
export function renderRoofLayoutSectionHtml(lo: RoofLayoutOverlay): string {
  const legend = lo.legend
    .map(
      (l, i) =>
        `<div style="display:flex;align-items:flex-start;gap:8px;margin-top:6px;">` +
        `<span style="font-family:'JetBrains Mono','Courier New',monospace;font-size:9px;font-weight:700;letter-spacing:0.1em;margin-top:2px;color:${ZONE_COLOR_HEX[l.color]};">${String(i + 1).padStart(2, '0')}</span>` +
        `<span style="width:12px;height:12px;flex:0 0 auto;margin-top:2px;display:inline-block;background:${ZONE_COLOR_HEX[l.color]};border:1px solid var(--line);"></span>` +
        `<span style="font-size:11px;line-height:1.45;">${esc(l.label)}</span></div>`,
    )
    .join('')
  let html = `
  <h2>Your roof layout map</h2>
  <p class="note">${esc(lo.header)}</p>
  <div class="figure">
    <div style="position:relative;width:100%;aspect-ratio:4 / 3;overflow:hidden;border:1px solid var(--line);">
      <img src="${lo.aerialSrc}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">
      <img src="${lo.overlaySrc}" alt="" style="position:absolute;inset:0;width:100%;height:100%;">
    </div>
    <div style="padding:8px 10px;border-top:1px solid var(--line);">${legend}</div>
    <figcaption>Colour-coded work zones over the measured aerial — how each part of the job is approached.</figcaption>
  </div>`
  if (lo.materials && lo.materials.items.length > 0) {
    const rows = lo.materials.items
      .map(
        (m) => `
      <tr>
        <td><b>${esc(m.item)}</b><br>
          <span style="font-size:9.5px;color:var(--dim);">How: ${esc(m.basis)}</span><br>
          <span style="font-size:9.5px;color:var(--dim);">Where: ${esc(m.use)}</span></td>
        <td class="num" style="white-space:nowrap;vertical-align:top;"><b>${m.qty.toLocaleString('en-AU')} ${esc(m.unit)}</b></td>
      </tr>`,
      )
      .join('')
    html += `
  <h2>Estimated materials</h2>
  <table>
    <thead><tr><th>Material</th><th class="num">Estimate</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${lo.materials.note ? `<p class="note">${esc(lo.materials.note)}</p>` : ''}
  <p class="note">All quantities are derived from the measured roof geometry — your roofer confirms final counts on site.</p>`
  }
  return html
}

export type RoofReportInput = {
  businessName: string
  /** Full white-label branding; when omitted, derived from businessName. */
  branding?: TenantBranding
  address: string
  quote: MultiRoofQuote
  /**
   * Mig 148 — which tier keys to render, from the tenant's quote_tier_mode
   * (dashboard Pricing settings) resolved by resolveVisibleTiers. Omitted ⇒ all
   * of quote.combined.tiers (back-compat). A single visible tier drops the
   * "Good / Better / Best" framing from the eyebrow + intro.
   */
  visibleTierKeys?: ('good' | 'better' | 'best')[]
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
  /**
   * AI work-strategy layout map (spec quote-visual-parity R6e): the aerial +
   * the deterministic colour-coded zone overlay + the plan's legend. Only ever
   * built from a CACHED plan (roofing_measurements.layout_plan when
   * layout_status = 'ready') — the PDF never triggers generation. Null ⇒
   * today's PDF unchanged.
   */
  layoutOverlay?: RoofLayoutOverlay | null
  generatedAt?: Date
}

/** A structure + its display state, for the "Structures measured" table. */
type StructureLine = { structure: RoofStructurePrice; state: 'priced' | 'inspection' | 'excluded' }

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

/** Per-trade default "Please Note" disclaimers (R7), merged with the routing reason. */
const ROOF_PLEASE_NOTE = [
  'Quote is subject to site inspection and customer consultation.',
  'No gutter or downpipe works are included unless expressly stated — please request a quote if required.',
  'Other than what is expressly noted, no electrical, carpentry, painting, ceiling, fascia or structural repairs are included; any such works would be quoted as an extra.',
  'No asbestos removal, air monitoring or decontamination is included; if required this would be quoted and charged as an extra.',
  'It is the property owner’s responsibility to move or protect furniture, pots, ornaments and plants away from the areas of works.',
  'Measured from aerial imagery; a roofer reviews every quote before any works are booked.',
]

/**
 * The DETAILED measurement report — lettered Parts, measured-roof bullets and
 * the per-structure table. This is the tradie-facing document (the same content
 * /q/roof/[token]?full=1 shows on screen); the PDF the CUSTOMER receives over
 * SMS/MMS/email is buildRoofCustomerReportHtml below. Kept exported + tested so
 * re-attaching it (as an appendix, or a tradie-only download) is a one-liner.
 */
export function buildRoofQuoteReportHtml(input: RoofReportInput): string {
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const branding = input.branding ?? brandingFromName(input.businessName)
  const q = input.quote
  const isInspection = q.routing.decision === 'inspection_required'
  // Mig 148 — render only the tier(s) the tenant's mode surfaces (single-price
  // roofers get one option). The full combined.tiers stays in the stored quote.
  // The job-level solar detach & reinstate allowance is applied to the
  // replacement tiers (applySolarToTiers — the same one code path the customer
  // quote page uses), so the printed dollars match the page exactly.
  const visibleTiers = input.visibleTierKeys
    ? q.combined.tiers.filter((t) => input.visibleTierKeys!.includes(t.tier))
    : q.combined.tiers
  const tiers = applySolarToTiers(visibleTiers, q.solar ?? null)
  const solarApplied =
    q.solar?.allowance?.applies === true &&
    q.solar.allowance.inc_gst > 0 &&
    tiers.some((t) => t.tier !== 'good' && t.ex_gst > 0)
  // The "Good / Better / Best" framing only applies when 2+ options are shown.
  const multiTier = tiers.length >= 2

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
    if (solarApplied) {
      priceLines.push(
        `<span class="caveat">Replacement option prices include detaching &amp; reinstating the existing solar panels (+${aud0(q.solar!.allowance!.inc_gst)} including GST); patch / repair excludes it.${q.solar!.allowance!.electrician_note ? ` ${esc(q.solar!.allowance!.electrician_note)}` : ''}</span>`,
      )
    }
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

  // AI work-strategy layout map + estimated materials (shared renderer).
  if (input.layoutOverlay) {
    body += renderRoofLayoutSectionHtml(input.layoutOverlay)
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
    eyebrow: isInspection
      ? 'Roofing quote · Inspection required'
      : multiTier
        ? 'Roofing quote · Good / Better / Best'
        : 'Roofing quote',
    dateLabel: date,
    siteAddress: input.address,
    introHtml: `Thank you for the opportunity to quote for roof works at <strong>${esc(
      input.address,
    )}</strong>. ${
      multiTier
        ? 'See below the scope of works and your re-roof options — the first option is the included re-roof, with the dearer tiers offered as optional upgrades priced separately, and notes to guide you through them.'
        : 'See below the scope of works and your re-roof quote.'
    }`,
    bodyHtml: body,
    pleaseNote,
    closingLine,
  })
}

// ════════════════════════════════════════════════════════════════════
// Customer-view report — the five numbered sections app/q/roof/[token]
// renders for a confirmed customer (Overview · Job details · Your tradie ·
// Your price · Book your site inspection).
//
// This is what the customer gets: the PDF linked in the quote SMS, attached
// as MMS media and emailed from the dashboard. Before this, every one of
// those surfaces served the DETAILED measurement report above — the tradie's
// ?full=1 view — so the document never matched the page the same text linked
// to. Pure — unit-tested.
// ════════════════════════════════════════════════════════════════════

/** Tier names verbatim from app/q/roof/[token] section 04, so the page and the
 *  PDF can never disagree about what an option is called. */
const CUSTOMER_TIER_NAME: Record<'good' | 'better' | 'best', string> = {
  good: 'Patch',
  better: 'Full roof replacement',
  best: 'Upgraded roof replacement',
}

export type RoofCustomerReportInput = {
  businessName: string
  /** Full white-label branding; when omitted, derived from businessName. */
  branding?: TenantBranding
  address: string
  quote: MultiRoofQuote
  /** Tier keys the tenant's quote_tier_mode surfaces (resolveVisibleTiers).
   *  Omitted ⇒ all of quote.combined.tiers. */
  visibleTierKeys?: ('good' | 'better' | 'best')[]
  /** Section 01 aerial figure(s) — already embedded as data: URIs by the caller
   *  (a PDF render must never depend on the network). One entry per included
   *  structure; a blank label renders the page's single-aerial caption. */
  aerials?: { label: string; src: string | null }[]
  /** Section 03 identity, from lib/quote/tradie-profile. Null ⇒ section omitted. */
  tradie?: { name: string; photoSrc: string; blurb: string } | null
  /** Section 05 — the refundable site-visit fee (lib/quote/money INSPECTION_FEE_AUD). */
  inspectionFeeAud: number
  quoteViewUrl?: string | null
  generatedAt?: Date
}

/** Section 04 — the headline price, picked EXACTLY as the customer page picks
 *  it: the 'better' tier when the tenant surfaces it and it carries a price,
 *  else the first priced visible tier, else null (priced on site). */
function featuredTier(
  tiers: RoofingPriceTier[],
  visibleTierKeys?: ('good' | 'better' | 'best')[],
): RoofingPriceTier | null {
  const preferred = visibleTierKeys?.includes('better')
    ? 'better'
    : (visibleTierKeys?.[0] ?? 'better')
  return (
    tiers.find((t) => t.tier === preferred && t.inc_gst > 0) ??
    tiers.find((t) => t.inc_gst > 0) ??
    null
  )
}

export function buildRoofCustomerReportHtml(input: RoofCustomerReportInput): string {
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const branding = input.branding ?? brandingFromName(input.businessName)
  const q = input.quote
  const address = (input.address ?? '').trim()
  // Same tier resolution the page uses — the tenant's visible tiers with the
  // job-level solar detach & reinstate allowance folded in (applySolarToTiers),
  // so the printed dollars match /q/roof to the cent.
  const visibleTiers = input.visibleTierKeys
    ? q.combined.tiers.filter((t) => input.visibleTierKeys!.includes(t.tier))
    : q.combined.tiers
  const tiers = applySolarToTiers(visibleTiers, q.solar ?? null)
  const featured = featuredTier(tiers, input.visibleTierKeys)
  const others = tiers.filter((t) => t.inc_gst > 0 && t !== featured)
  const solarApplied =
    q.solar?.allowance?.applies === true &&
    q.solar.allowance.inc_gst > 0 &&
    tiers.some((t) => t.tier !== 'good' && t.ex_gst > 0)

  // ── 01 Overview ──
  const overviewBits = [
    address ? `Roofing works at ${address}` : 'Your roofing quote',
    `measured at approximately ${Math.round(q.combined.area_m2)} square metres from satellite imagery`,
  ]
  const aerials = (input.aerials ?? []).filter((a) => a.src)
  const figures = aerials
    .map((a) =>
      renderFigure(
        a.src,
        a.label
          ? `${a.label} — aerial view · measured from satellite imagery`
          : 'Aerial view · measured from satellite imagery',
      ),
    )
    .join('')
  // ── 04 Your price ──
  const priceHtml = featured
    ? `
    <div class="mono" style="margin-top:12px;font-weight:800;font-size:26px;line-height:1;">${aud0(
      featured.inc_gst,
    )}</div>
    <div class="eyebrow" style="margin-top:6px;">${esc(
      CUSTOMER_TIER_NAME[featured.tier],
    )} · inc GST</div>` +
      others
        .map(
          (t) => `
    <div style="margin-top:12px;">
      <div class="mono" style="font-weight:800;font-size:17px;line-height:1;">${aud0(t.inc_gst)}</div>
      <div class="eyebrow" style="margin-top:5px;">${esc(CUSTOMER_TIER_NAME[t.tier])} · inc GST</div>
    </div>`,
        )
        .join('') +
      // Never print a solar-inclusive number without saying so — the customer
      // page carries the same disclosure next to its price.
      (solarApplied
        ? `<p class="note" style="margin-top:10px;">Replacement option prices include detaching &amp; reinstating the existing solar panels (+${aud0(
            q.solar!.allowance!.inc_gst,
          )} including GST); patch / repair excludes it.${
            q.solar!.allowance!.electrician_note
              ? ` ${esc(q.solar!.allowance!.electrician_note)}`
              : ''
          }</p>`
        : '')
    : `
    <div class="mono" style="margin-top:12px;font-weight:800;font-size:20px;line-height:1;">Confirmed on site</div>
    <div class="eyebrow" style="margin-top:6px;">Priced after your site visit</div>`

  // Numbered in order — a caller that omits section 03 (no tradie resolved)
  // must not leave a gap in the markers.
  const sections = [
    {
      title: 'Overview',
      note: `${overviewBits.join(', ')}. A licensed roofer confirms everything on site before any work is booked.`,
      html: figures,
    },
    {
      title: 'Job details',
      note: featured?.scope ?? 'Scope confirmed with you at the site visit.',
      // Same bullets the customer page renders (lib/roofing/quote-bullets.ts) —
      // the scope sentence alone left both surfaces thinner than the measured
      // detail we already hold.
      bullets: jobDetailBullets(q, featured?.tier),
    },
    input.tradie ? { title: 'Your tradie', html: renderTradieBlock(input.tradie) } : null,
    { title: 'Your price', html: priceHtml },
    {
      title: 'Book your site inspection',
      note: `Book a site inspection for $${input.inspectionFeeAud} — refundable and credited toward your final quote.`,
      bullets: input.quoteViewUrl ? [`Book online: ${input.quoteViewUrl}`] : [],
    },
  ].filter(Boolean) as Array<{ title: string; note?: string; bullets?: string[]; html?: string }>

  const body = sections
    .map((s, i) => renderPart({ ...s, marker: String(i + 1).padStart(2, '0') }))
    .join('')

  return renderReportDocument(branding, {
    docTitle: `Roofing quote — ${branding.businessName}`,
    eyebrow: 'Roofing quote',
    dateLabel: date,
    siteAddress: address || null,
    introHtml: address
      ? `Thank you for the opportunity to quote for roof works at <strong>${esc(
          address,
        )}</strong>. Your quote is set out below.`
      : 'Thank you for the opportunity to quote for your roof works. Your quote is set out below.',
    bodyHtml: body,
    pleaseNote: ROOF_PLEASE_NOTE,
    closingLine: input.quoteViewUrl ? `Your live quote: ${input.quoteViewUrl}` : null,
  })
}
