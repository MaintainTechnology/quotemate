// Self-contained HTML for the commercial-painting customer TENDER PDF,
// rendered by Gotenberg (lib/pdf/gotenberg.ts). White-label Caterpillar
// chrome shared with every trade (lib/pdf/report-chrome.ts). The body keeps
// its native tender shape: crew stat grid + scope/materials/equipment/
// separate-price tables + the priced-economics totals + assumptions /
// exclusions (spec specs/quote-pdf-branding.md). AU formatting. Pure —
// unit-tested.

import type { PricedPaintBom } from './types'
import {
  renderReportDocument,
  brandingFromName,
  esc,
  type TenantBranding,
} from '../pdf/report-chrome'

/** Full AU currency, matching the tender's historic ex/inc-GST formatting. */
function aud(n: number): string {
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })
}

/** Per-trade default "Please Note" disclaimers for a commercial paint tender. */
const PAINT_PLEASE_NOTE = [
  'This tender is valid for 30 days and is subject to site verification of access and substrate condition.',
  'Prices include 10% GST; the line tables above are shown ex GST.',
  'Quantities are taken off the supplied plans and measurements; final pricing is confirmed on site and variations to the scope are quoted separately.',
  'Paint products are supplied to equivalent specification where a named brand or colour is unavailable.',
  'Separate prices listed are optional and are NOT included in the tender total unless accepted in writing.',
  'No making-good of other trades, no asbestos handling and no structural or substrate repair is included unless expressly stated.',
]

export function buildPaintTenderReportHtml(input: {
  businessName: string
  jobName?: string | null
  siteAddress?: string | null
  bom: PricedPaintBom
  quoteViewUrl?: string | null
  generatedAt?: Date
  /** Full white-label branding; when omitted, derived from businessName. */
  branding?: TenantBranding
}): string {
  const { jobName, siteAddress, bom } = input
  const branding = input.branding ?? brandingFromName(input.businessName)
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const lineRows = bom.lines
    .map(
      (l) => `
      <tr>
        <td>${esc(l.room)} — ${esc(l.surface)}</td>
        <td class="num">${l.quantity}${l.unit === 'm2' ? ' m²' : ''} × ${l.coats}c</td>
        <td class="num">${l.labourHours} h</td>
        <td class="num">${aud(l.lineExGst)}</td>
      </tr>`,
    )
    .join('')

  const materialRows = bom.materials
    .map(
      (m) => `
      <tr>
        <td>${esc(m.product)}</td>
        <td class="num">${m.litres} L</td>
        <td class="num">${aud(m.pricePerL)}/L</td>
        <td class="num">${aud(m.costExGst)}</td>
      </tr>`,
    )
    .join('')

  const equipmentRows = bom.equipment
    .map(
      (e) => `
      <tr>
        <td>${esc(e.label)}<br /><span class="note">${esc(e.reason)}</span></td>
        <td class="num">${e.days} day${e.days === 1 ? '' : 's'}</td>
        <td class="num">${aud(e.dayRate)}/day</td>
        <td class="num">${aud(e.costExGst)}</td>
      </tr>`,
    )
    .join('')

  const separateRows = bom.separate.lines
    .map(
      (l) => `
      <tr>
        <td>${esc(l.room)} — ${esc(l.surface)}</td>
        <td class="num">${l.quantity}${l.unit === 'm2' ? ' m²' : ''} × ${l.coats}c</td>
        <td class="num">${l.labourHours} h</td>
        <td class="num">${aud(l.lineExGst)}</td>
      </tr>`,
    )
    .join('')

  const list = (items: string[]) => items.map((i) => `<li>${esc(i)}</li>`).join('')

  let body = ''

  // Crew / tender headline stat grid.
  body += `
  <div class="statgrid">
    <div class="stat"><div class="v">${bom.labour.hours} <small>h</small></div><div class="l">Labour</div></div>
    <div class="stat"><div class="v">${bom.labour.crewSize} painters</div><div class="l">Crew</div></div>
    <div class="stat"><div class="v">≈ ${bom.labour.estimatedDays} <small>day${bom.labour.estimatedDays === 1 ? '' : 's'}</small></div><div class="l">On site</div></div>
    <div class="stat stat-selected"><div class="v">${aud(bom.totalIncGst)}</div><div class="l">Tender inc GST</div></div>
  </div>`

  // Scope of works.
  body += `
  <h2>Scope of works</h2>
  <table>
    <thead><tr><th>Surface</th><th class="num">Quantity</th><th class="num">Labour</th><th class="num">Line ex GST</th></tr></thead>
    <tbody>${lineRows}</tbody>
  </table>`

  // Materials.
  body += `
  <h2>Materials</h2>
  <table>
    <thead><tr><th>Product</th><th class="num">Litres</th><th class="num">Rate</th><th class="num">Cost ex GST</th></tr></thead>
    <tbody>${materialRows}</tbody>
  </table>`

  // Equipment & access (optional).
  if (bom.equipment.length > 0) {
    body += `
  <h2>Equipment &amp; access</h2>
  <table>
    <thead><tr><th>Item</th><th class="num">Duration</th><th class="num">Rate</th><th class="num">Cost ex GST</th></tr></thead>
    <tbody>${equipmentRows}</tbody>
  </table>`
  }

  // Separate prices (optional, not in the tender total).
  if (bom.separate.lines.length > 0) {
    body += `
  <h2>Separate prices (optional, not in the tender total)</h2>
  <table>
    <thead><tr><th>Surface</th><th class="num">Quantity</th><th class="num">Labour</th><th class="num">Price ex GST</th></tr></thead>
    <tbody>${separateRows}</tbody>
  </table>`
  }

  // Tender economics — the rolled-up totals.
  body += `
  <h2>Tender summary</h2>
  <table>
    <tbody>
      <tr><td>Labour</td><td class="num">${aud(bom.labour.costExGst)}</td></tr>
      <tr><td>Materials</td><td class="num">${aud(bom.materialsExGst)}</td></tr>
      <tr><td>Equipment</td><td class="num">${aud(bom.equipmentExGst)}</td></tr>
      <tr><td>Subtotal ex GST</td><td class="num">${aud(bom.subtotalExGst)}</td></tr>
      <tr><td>GST</td><td class="num">${aud(bom.gst)}</td></tr>
      <tr><td><strong>Tender total inc GST</strong></td><td class="num"><strong>${aud(bom.totalIncGst)}</strong></td></tr>
    </tbody>
  </table>`

  // Assumptions & exclusions.
  body += `<h2>Assumptions</h2><ul class="bullets">${list(bom.assumptions)}</ul>`
  body += `<h2>Exclusions</h2><ul class="bullets">${list(bom.exclusions)}</ul>`

  const jobLabel = jobName ?? siteAddress ?? 'Commercial job'

  const closingLine = input.quoteViewUrl
    ? `View this tender online: ${input.quoteViewUrl}`
    : null

  return renderReportDocument(branding, {
    docTitle: `Painting tender — ${jobLabel}`,
    eyebrow: 'Commercial painting · Tender',
    dateLabel: date,
    customerName: jobName ?? null,
    siteAddress: siteAddress ?? null,
    introHtml: `Thank you for the opportunity to tender for the painting works at <strong>${esc(
      jobLabel,
    )}</strong>. The scope of works, materials, access and priced summary for this <strong>Painting tender</strong> are set out below.`,
    bodyHtml: body,
    pleaseNote: PAINT_PLEASE_NOTE,
    closingLine,
  })
}
