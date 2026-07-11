// Self-contained HTML for the customer residential-painting quote PDF,
// rendered by Gotenberg (lib/pdf/gotenberg.ts). White-label Caterpillar
// chrome shared with every trade (lib/pdf/report-chrome.ts). Pure — no
// I/O, unit-tested.
//
// Painting's quote shape is unique: each tier carries a low/high inc-GST
// BAND (from the area-estimate confidence) on top of the point price, and
// the breakdown is a per-surface takeoff (walls/ceilings/trim/exterior).
// We surface the band as the "range, not a single number" the estimate
// honestly is, plus the surface takeoff so the customer sees what's priced.

import type { PaintingEstimate, PaintScope } from './types'
import { customerTakeoff } from './takeoff'
import { customerMeasurementNotes } from './customer-notes'
import {
  renderReportDocument,
  brandingFromName,
  esc,
  aud0,
  type TenantBranding,
} from '../pdf/report-chrome'

export type PaintingReportInput = {
  businessName: string
  /** Full white-label branding; when omitted, derived from businessName. */
  branding?: TenantBranding
  address: string
  estimate: PaintingEstimate
  /** Tiers the tenant's quote_tier_mode exposes (mig 142). Absent ⇒ show all
   *  present tiers. When 'single', only Better renders — matching /q/paint,
   *  so a single-price tenant's PDF never reveals the hidden Good/Best. */
  visibleTierKeys?: Array<'good' | 'better' | 'best'>
  quoteViewUrl?: string | null
  /** Street View frontage photo (data URI) — spec quote-visual-parity R2. */
  streetViewSrc?: string | null
  /** Cached AI repaint preview (data URI); pass ONLY when already rendered —
   *  the PDF path must never trigger a billable Gemini render. */
  afterImageSrc?: string | null
  /** Aerial/satellite view of the property (data URI). */
  aerialSrc?: string | null
  generatedAt?: Date
}

const SCOPE_LABELS: Record<PaintScope, string> = {
  walls: 'Interior walls',
  ceilings: 'Ceilings',
  trim: 'Trim & doors',
  exterior: 'Exterior',
}

/** "$4,200 – $5,100" when the band is meaningfully wide, else "". */
function bandLabel(low: number, high: number, point: number): string {
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= 0) return ''
  // Hide a degenerate band (rounds to the same figure as the point price).
  if (Math.round(low) === Math.round(high)) return ''
  if (Math.round(low) === Math.round(point) && Math.round(high) === Math.round(point)) return ''
  return `${aud0(low)} – ${aud0(high)}`
}

function surfaceRows(estimate: PaintingEstimate): string {
  const lines = estimate.price.breakdown?.surfaces ?? []
  if (lines.length === 0) return ''
  // Cost only, no "rate → line" column: line_ex_gst already folds in the
  // job multipliers (coats/prep/colour/double-storey), so quantity × base
  // rate would NOT equal it. The surface costs sum exactly to the subtotal.
  return lines
    .map((l) => {
      const unit = l.unit === 'lm' ? 'lm' : 'm²'
      return `
      <tr>
        <td>${esc(SCOPE_LABELS[l.scope] ?? l.scope)}</td>
        <td class="num">${Math.round(l.quantity).toLocaleString('en-AU')} ${unit}</td>
        <td class="num">${aud0(l.line_ex_gst)}</td>
      </tr>`
    })
    .join('')
}

/** Per-trade default "Please Note" disclaimers (R7). */
const PAINTING_PLEASE_NOTE = [
  'Headline prices include 10% GST; surface rates are shown ex GST.',
  'Areas are estimated from property data and your inputs — a painter reviews every quote and confirms the final price after an on-site measure.',
  'Prices cover preparation and painting of the surfaces listed; repairs to plaster, render, timber or structural defects are quoted as an extra.',
  'No lead-paint, asbestos or mould remediation is included; if found on site this would be quoted and charged separately.',
  'It is the property owner’s responsibility to move or protect furniture, fittings and floor coverings away from the areas of works.',
  'Paint colours and finishes are confirmed before works commence; an additional coat for strong colour changes may be quoted as an extra.',
]

export function buildPaintingQuoteReportHtml(input: PaintingReportInput): string {
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const branding = input.branding ?? brandingFromName(input.businessName)
  const price = input.estimate.price
  const isInspection = price.routing.decision === 'inspection_required'
  // Honour the tenant's tier mode (mig 142) so a single-price tenant's PDF
  // shows one option, exactly like /q/paint — never revealing hidden tiers.
  const allTiers = price.tiers
  const visKeys =
    input.visibleTierKeys ??
    (['good', 'better', 'best'] as const).filter((k) => allTiers.some((t) => t.tier === k))
  const tiers = allTiers.filter((t) => visKeys.includes(t.tier))
  // The highlighted / scope-quoted tier: Better when visible, else the middle
  // visible tier (single mode surfaces exactly one).
  const featuredTier = tiers.find((t) => t.tier === 'better') ?? tiers[Math.floor(tiers.length / 2)]
  // After a tradie hand-edits the tier prices (manual_override), the surface
  // takeoff — which sums to the ORIGINAL Better ex-GST — no longer reconciles
  // to the headline, so suppress it rather than print a self-contradicting
  // line-item table on the customer's quote.
  const surfaces = price.manual_override ? '' : surfaceRows(input.estimate)
  const loadings = price.manual_override ? [] : price.loadings_applied ?? []

  let body = ''

  // Property imagery — the same organisation the /p and /q/paint pages use
  // (spec quote-visual-parity R2). Top row: the real photos (Street View
  // frontage + aerial). Below: the before/after pair — the property today
  // beside the AI repaint in the customer's chosen colour. Omitted cleanly
  // when unavailable.
  const figureRow = (figs: Array<{ src: string; caption: string }>) =>
    `<div style="display:flex;gap:10px;margin:0 0 14px;">${figs
      .map(
        (f) => `<figure style="margin:0;flex:1;min-width:0;"><img src="${f.src}" alt="${esc(
          f.caption,
        )}" style="width:100%;display:block;" /><figcaption class="mono" style="font-size:9px;color:var(--dim);margin-top:4px;">${esc(
          f.caption,
        )}</figcaption></figure>`,
      )
      .join('')}</div>`

  const photos: Array<{ src: string; caption: string }> = []
  if (input.streetViewSrc)
    photos.push({ src: input.streetViewSrc, caption: 'Front of the property · Google Street View' })
  if (input.aerialSrc)
    photos.push({ src: input.aerialSrc, caption: 'Aerial view · Google Maps' })
  if (photos.length > 0) body += figureRow(photos)
  if (input.afterImageSrc) {
    body += `<div class="mono" style="font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:var(--dim);margin:0 0 6px;">See it in a new colour</div>`
    body += figureRow([
      ...(input.streetViewSrc
        ? [{ src: input.streetViewSrc, caption: 'Today · Google Street View' }]
        : []),
      { src: input.afterImageSrc, caption: 'Fresh repaint · AI preview' },
    ])
  }

  if (isInspection) {
    body += `<h2>Next step: on-site measure</h2>
  <div class="scope">${esc(
    price.routing.reason ?? 'This job needs a quick on-site measure before we can price it accurately.',
  )}</div>`
  } else {
    body += `<h2>${tiers.length === 1 ? 'Your option (inc GST)' : 'Your options (inc GST)'}</h2>
  <div class="statgrid">
    ${tiers
      .map((t) => {
        const band = bandLabel(t.inc_gst_low, t.inc_gst_high, t.inc_gst)
        return `<div class="stat ${t.tier === featuredTier?.tier ? 'stat-selected' : ''}">
      <div class="v">${aud0(t.inc_gst)}</div>
      ${band ? `<div class="band mono" style="font-size:9px;color:var(--dim);margin-top:2px;">range ${band}</div>` : ''}
      <div class="l">${esc(t.label)}</div>
    </div>`
      })
      .join('')}
  </div>
  ${featuredTier?.scope ? `<div class="scope">${esc(featuredTier.scope)}</div>` : ''}`
  }

  // How your price was built — the customer-safe derivation (mirrors the
  // /q/paint page section). Each surface shows its already-computed ex-GST
  // COST (coats/prep/colour/access are baked into line_ex_gst), so the costs
  // sum EXACTLY to the subtotal — no separate multiplier step (that would
  // double-count). Tier-relation rows show only when the call-out floor did
  // not override them. Suppressed entirely after a manual tier edit.
  const bd = price.manual_override ? null : price.breakdown ?? null
  if (surfaces && bd) {
    const floorApplied = !!price.call_out_minimum_applied
    const tail: string[] = []
    const row = (label: string, value: string, bold = false) =>
      `<tr><td colspan="2">${bold ? `<strong>${label}</strong>` : label}</td><td class="num">${
        bold ? `<strong>${value}</strong>` : value
      }</td></tr>`
    if (Number.isFinite(bd.better_ex_gst)) {
      tail.push(row('Subtotal (ex GST)', aud0(bd.better_ex_gst), true))
    }
    const label = (k: 'good' | 'better' | 'best') => tiers.find((t) => t.tier === k)?.label
    const betterLabel = label('better') ?? 'Better'
    if (!floorApplied && label('good') && Number.isFinite(bd.good_refresh_fraction)) {
      tail.push(
        row(
          esc(`${label('good')} = ${betterLabel} × ${Math.round(bd.good_refresh_fraction * 100)}%`),
          '',
        ),
      )
    }
    if (!floorApplied && label('best') && Number.isFinite(bd.premium_uplift_pct)) {
      tail.push(
        row(
          esc(`${label('best')} = ${betterLabel} × ${Math.round((1 + bd.premium_uplift_pct) * 100)}%`),
          '',
        ),
      )
    }
    if (Number.isFinite(bd.gst_factor) && bd.gst_factor > 1) {
      tail.push(row('GST', `+ ${Math.round((bd.gst_factor - 1) * 100)}%`))
    }
    if (floorApplied && Number.isFinite(bd.call_out_minimum_ex_gst) && bd.call_out_minimum_ex_gst > 0) {
      tail.push(row('Call-out minimum applied', aud0(bd.call_out_minimum_ex_gst)))
    }
    body += `
  <h2>How your price was built</h2>
  <p class="note" style="margin:0 0 6px;">Each surface cost includes the coats, surface preparation and prep consumables for this job; headline prices above include GST.</p>
  <table>
    <thead><tr><th>Surface</th><th class="num">Area</th><th class="num">Cost (ex GST)</th></tr></thead>
    <tbody>${surfaces}${tail.join('')}</tbody>
  </table>`
  }

  // How we measured — the engine's derivation notes, filtered to the
  // customer-safe sentences (customerMeasurementNotes strips the
  // tradie-directed instructions).
  const measuredNotes = customerMeasurementNotes(input.estimate.measurement?.notes)
  if (measuredNotes.length > 0) {
    body += `
  <h2>How we measured</h2>
  ${measuredNotes.map((n) => `<p class="note" style="margin:2px 0;">${esc(n)}</p>`).join('')}
  <p class="note" style="margin:2px 0;">A painter confirms all measurements on site before works commence.</p>`
  }

  if (loadings.length > 0) {
    body += `<p class="note">Loadings applied: ${loadings.map((l) => esc(l.detail)).join('; ')}.</p>`
  }

  // Materials & time on site — the CUSTOMER-safe take-off (quantities and
  // duration only; internal costs/rates/margin never leave the tradie
  // surfaces). Quantities survive a manual price edit, so no override gate.
  // Filtered to the visible tiers so a single-price tenant's PDF shows one
  // materials row, matching /q/paint.
  const custTiers = isInspection
    ? []
    : customerTakeoff(input.estimate.takeoff).filter((c) => visKeys.includes(c.tier))
  if (custTiers.length > 0) {
    body += `
  <h2>Materials &amp; time on site</h2>
  <table>
    <thead><tr><th>Option</th><th>Paint required</th><th class="num">Time on site</th></tr></thead>
    <tbody>${custTiers
      .map((c) => {
        const label = tiers.find((t) => t.tier === c.tier)?.label ?? c.tier
        return `
      <tr>
        <td>${esc(label)}</td>
        <td>${c.materials.map(esc).join('<br/>')}</td>
        <td class="num">${esc(c.time_on_site)}</td>
      </tr>`
      })
      .join('')}
    </tbody>
  </table>
  <p class="note">Litres round up to whole retail packs; time on site is an estimate at standard working days and is confirmed before works commence.</p>`
  }

  const meta = `~${Math.round(price.total_area_m2)} m² paintable · ${esc(price.confidence)} confidence`

  return renderReportDocument(branding, {
    docTitle: `Painting quote — ${branding.businessName}`,
    eyebrow: `Painting estimate · ${isInspection ? 'Inspection required' : 'Good / Better / Best'}`,
    dateLabel: date,
    siteAddress: input.address,
    customerContact: meta,
    introHtml: `Thank you for the opportunity to quote for painting at <strong>${esc(
      input.address,
    )}</strong>. ${
      isInspection
        ? 'A quick on-site measure is the next step so we can price the job accurately.'
        : 'Your Good / Better / Best options are set out below, with the surfaces measured for this quote.'
    }`,
    bodyHtml: body,
    pleaseNote: PAINTING_PLEASE_NOTE,
    closingLine: input.quoteViewUrl ? `Live quote: ${input.quoteViewUrl}` : null,
  })
}
