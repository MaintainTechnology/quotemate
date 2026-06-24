// Self-contained HTML for the customer electrical plan take-off report PDF,
// rendered by Gotenberg (lib/pdf/gotenberg.ts). White-label Caterpillar chrome
// shared with every trade (lib/pdf/report-chrome.ts). The body keeps its native
// take-off structure: a stat grid, the itemised device-count table and an
// optional indicative-estimate breakdown. Pure — deterministic on `generatedAt`.
//
// PRICING-VISIBILITY DECISION (flagged for business review): the customer
// report shows the indicative priced estimate when one exists, framed as
// indicative + subject to tradie confirmation. Pass `bom: null` to render a
// counts-only report instead.

import type { ExtractionItem } from './extract'
import type { PricedBom } from './price'
import {
  renderReportDocument,
  brandingFromName,
  esc,
  aud2,
  type TenantBranding,
} from '../pdf/report-chrome'

export type PlanReportInput = {
  businessName: string
  /** Full white-label branding; when omitted, derived from businessName. */
  branding?: TenantBranding
  filename: string
  items: ExtractionItem[]
  sheetsUsed: string[]
  overallNote?: string | null
  bom: PricedBom | null
  generatedAt?: Date
}

/** Per-trade default "Please Note" disclaimers for the plan take-off. */
const PLAN_PLEASE_NOTE = [
  'Device counts are read by AI from the supplied plan; the tradie reviews and confirms every count before any work is booked.',
  'Where shown, prices are indicative and generated from standard rates — the final price is confirmed before work is booked.',
  'Headline indicative totals include 10% GST where the tradie is GST-registered; line items are shown ex GST.',
  'Items flagged medium/low confidence, or not matched to a catalogue assembly, need a manual look from your tradie.',
  'Counts cover only the sheets listed; additional sheets or revisions may change the take-off.',
]

export function buildPlanReportHtml(input: PlanReportInput): string {
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const branding = input.branding ?? brandingFromName(input.businessName)
  const deviceCount = input.items.reduce((sum, it) => sum + it.count, 0)

  // ── Stat grid: item types · devices counted · (indicative total) ──
  let body = `
  <div class="statgrid">
    <div class="stat"><div class="v">${input.items.length}</div><div class="l">Item types</div></div>
    <div class="stat"><div class="v">${deviceCount}</div><div class="l">Devices counted</div></div>
    ${
      input.bom
        ? `<div class="stat stat-selected"><div class="v">${aud2(input.bom.totalIncGst)}</div><div class="l">Indicative total${
            input.bom.gstRegistered ? ' inc GST' : ''
          }</div></div>`
        : ''
    }
  </div>`

  // ── Counted items table ──
  const itemRows = input.items
    .map(
      (it) => `
      <tr>
        <td>${esc(it.type)}</td>
        <td class="mono">${esc(it.symbol || '—')}</td>
        <td class="num">${it.count}</td>
        <td><span class="flag">${esc(it.confidence)}</span></td>
      </tr>`,
    )
    .join('')

  body += `
  <h2>Counted items</h2>
  <table>
    <thead><tr><th>Item</th><th>Symbol</th><th class="num">Count</th><th>Confidence</th></tr></thead>
    <tbody>${itemRows}</tbody>
  </table>`

  if (input.overallNote) {
    body += `<p class="note">Reader's note: ${esc(input.overallNote)}</p>`
  }

  // ── Indicative estimate (only when a priced BOM exists) ──
  if (input.bom) {
    const bom = input.bom
    body += `<h2>Indicative estimate</h2>`
    body += `<p class="note">Prices are indicative, generated from ${esc(
      input.businessName,
    )}'s standard rates. ${esc(
      input.businessName,
    )} will confirm the final price before any work is booked.</p>`

    const priceRows = bom.lines
      .map(
        (l) => `
      <tr>
        <td>${esc(l.type)}</td>
        <td class="num">${l.count}</td>
        <td class="num">${aud2(l.materialExGst)}</td>
        <td class="num">${aud2(l.labourExGst)}</td>
        <td class="num">${aud2(l.lineExGst)}</td>
      </tr>`,
      )
      .join('')

    body += `
    <table>
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Materials</th><th class="num">Labour</th><th class="num">Line total</th></tr></thead>
      <tbody>${priceRows}</tbody>
    </table>`

    if (bom.unmatched.length > 0) {
      body += `<p class="note">Not priced (needs a manual look from your tradie): ${bom.unmatched
        .map((u) => `${esc(u.type)} × ${u.count}`)
        .join(' · ')}</p>`
    }

    body += `
    <table>
      <tbody>
        <tr><td>Materials (ex GST)</td><td class="num">${aud2(bom.materialExGst)}</td></tr>
        <tr><td>Labour (ex GST)</td><td class="num">${aud2(bom.labourExGst)}</td></tr>
        ${
          bom.labourFloorAddedExGst > 0
            ? `<tr><td>Minimum-labour adjustment</td><td class="num">${aud2(bom.labourFloorAddedExGst)}</td></tr>`
            : ''
        }
        <tr><td>Subtotal (ex GST)</td><td class="num">${aud2(bom.subtotalExGst)}</td></tr>
        ${bom.gstRegistered ? `<tr><td>GST</td><td class="num">${aud2(bom.gstExGst)}</td></tr>` : ''}
        <tr><td><strong>Indicative total${
          bom.gstRegistered ? ' (inc GST)' : ''
        }</strong></td><td class="num"><strong>${aud2(bom.totalIncGst)}</strong></td></tr>
      </tbody>
    </table>`
  }

  const sheetsNote =
    input.sheetsUsed.length > 0 ? ` Sheets read: <strong>${esc(input.sheetsUsed.join(', '))}</strong>.` : ''

  return renderReportDocument(branding, {
    docTitle: `Electrical plan take-off — ${branding.businessName}`,
    eyebrow: `Electrical plan take-off · AI-read & grounded${input.bom ? ' pricing' : ' counts'}`,
    dateLabel: date,
    siteAddress: input.filename,
    introHtml: `Thank you for the opportunity to quote. We read <strong>${esc(
      input.filename,
    )}</strong> and counted the electrical devices set out below.${sheetsNote} Final scope and price are confirmed by ${esc(
      input.businessName,
    )}.`,
    bodyHtml: body,
    pleaseNote: PLAN_PLEASE_NOTE,
    closingLine: null,
  })
}
