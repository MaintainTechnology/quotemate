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
  quoteViewUrl?: string | null
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
  return lines
    .map((l) => {
      const unit = l.unit === 'lm' ? 'lm' : 'm²'
      return `
      <tr>
        <td>${esc(SCOPE_LABELS[l.scope] ?? l.scope)}</td>
        <td class="num">${Math.round(l.quantity).toLocaleString('en-AU')} ${unit}</td>
        <td class="num">${aud0(l.rate_per_unit)}/${unit}</td>
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
  const tiers = price.tiers
  // After a tradie hand-edits the tier prices (manual_override), the surface
  // takeoff — which sums to the ORIGINAL Better ex-GST — no longer reconciles
  // to the headline, so suppress it rather than print a self-contradicting
  // line-item table on the customer's quote.
  const surfaces = price.manual_override ? '' : surfaceRows(input.estimate)
  const loadings = price.manual_override ? [] : price.loadings_applied ?? []

  let body = ''

  if (isInspection) {
    body += `<h2>Next step: on-site measure</h2>
  <div class="scope">${esc(
    price.routing.reason ?? 'This job needs a quick on-site measure before we can price it accurately.',
  )}</div>`
  } else {
    body += `<h2>Your options (inc GST)</h2>
  <div class="statgrid">
    ${tiers
      .map((t, i) => {
        const band = bandLabel(t.inc_gst_low, t.inc_gst_high, t.inc_gst)
        return `<div class="stat ${i === 1 ? 'stat-selected' : ''}">
      <div class="v">${aud0(t.inc_gst)}</div>
      ${band ? `<div class="band mono" style="font-size:9px;color:var(--dim);margin-top:2px;">range ${band}</div>` : ''}
      <div class="l">${esc(t.label)}</div>
    </div>`
      })
      .join('')}
  </div>
  ${tiers[1]?.scope ? `<div class="scope">${esc(tiers[1].scope)}</div>` : ''}`
  }

  if (surfaces) {
    body += `
  <h2>Surfaces measured</h2>
  <table>
    <thead><tr><th>Surface</th><th class="num">Quantity</th><th class="num">Rate</th><th class="num">Subtotal (ex GST)</th></tr></thead>
    <tbody>${surfaces}</tbody>
  </table>`
  }

  if (loadings.length > 0) {
    body += `<p class="note">Loadings applied: ${loadings.map((l) => esc(l.detail)).join('; ')}.</p>`
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
