// Self-contained HTML for the customer plan-take-off report PDF
// (rendered to PDF by Gotenberg — see lib/pdf/gotenberg.ts).
//
// Print-friendly light theme (the dark Maintain web theme wastes toner and
// reads poorly on paper) but keeps the brand voice: mono eyebrows, orange
// accent, uppercase display headings. All styles inline — Gotenberg gets a
// single index.html with no external assets.
//
// PRICING-VISIBILITY DECISION (flagged for business review): the customer
// report shows the indicative priced estimate when one exists, framed as
// indicative + subject to tradie confirmation. Pass `bom: null` to render a
// counts-only report instead.

import type { ExtractionItem } from './extract'
import type { PricedBom } from './price'

export type PlanReportInput = {
  businessName: string
  filename: string
  items: ExtractionItem[]
  sheetsUsed: string[]
  overallNote?: string | null
  bom: PricedBom | null
  generatedAt?: Date
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const aud = (n: number) =>
  '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function buildPlanReportHtml(input: PlanReportInput): string {
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const deviceCount = input.items.reduce((sum, it) => sum + it.count, 0)

  const itemRows = input.items
    .map(
      (it) => `
      <tr>
        <td>${esc(it.type)}</td>
        <td class="mono">${esc(it.symbol || '—')}</td>
        <td class="num">${it.count}</td>
        <td><span class="conf conf-${it.confidence}">${it.confidence}</span></td>
      </tr>`,
    )
    .join('')

  const pricingSection = input.bom
    ? `
    <h2>Indicative estimate</h2>
    <p class="note">Prices are indicative, generated from ${esc(input.businessName)}'s standard rates.
    ${esc(input.businessName)} will confirm the final price before any work is booked.</p>
    <table>
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Materials</th><th class="num">Labour</th><th class="num">Line total</th></tr></thead>
      <tbody>
        ${input.bom.lines
          .map(
            (l) => `
        <tr>
          <td>${esc(l.type)}</td>
          <td class="num">${l.count}</td>
          <td class="num">${aud(l.materialExGst)}</td>
          <td class="num">${aud(l.labourExGst)}</td>
          <td class="num">${aud(l.lineExGst)}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>
    ${
      input.bom.unmatched.length > 0
        ? `<p class="note">Not priced (needs a manual look from your tradie): ${input.bom.unmatched
            .map((u) => `${esc(u.type)} × ${u.count}`)
            .join(' · ')}</p>`
        : ''
    }
    <table class="totals">
      <tbody>
        <tr><td>Materials (ex GST)</td><td class="num">${aud(input.bom.materialExGst)}</td></tr>
        <tr><td>Labour (ex GST)</td><td class="num">${aud(input.bom.labourExGst)}</td></tr>
        ${
          input.bom.labourFloorAddedExGst > 0
            ? `<tr><td>Minimum-labour adjustment</td><td class="num">${aud(input.bom.labourFloorAddedExGst)}</td></tr>`
            : ''
        }
        <tr><td>Subtotal (ex GST)</td><td class="num">${aud(input.bom.subtotalExGst)}</td></tr>
        ${input.bom.gstRegistered ? `<tr><td>GST</td><td class="num">${aud(input.bom.gstExGst)}</td></tr>` : ''}
        <tr class="grand"><td>Indicative total${input.bom.gstRegistered ? ' (inc GST)' : ''}</td><td class="num">${aud(input.bom.totalIncGst)}</td></tr>
      </tbody>
    </table>`
    : ''

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>Electrical plan take-off — ${esc(input.businessName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #16202b; margin: 0; font-size: 12px; line-height: 1.5; }
  .mono { font-family: 'Courier New', monospace; }
  header { border-bottom: 3px solid #FF5F00; padding-bottom: 14px; margin-bottom: 20px; }
  .eyebrow { font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: #6b7683; }
  h1 { font-size: 24px; text-transform: uppercase; letter-spacing: -0.02em; margin: 6px 0 2px; }
  h1 .accent { color: #FF5F00; }
  h2 { font-size: 14px; text-transform: uppercase; margin: 26px 0 8px; letter-spacing: 0.02em; }
  .meta { color: #6b7683; font-size: 11px; }
  .statgrid { display: flex; gap: 12px; margin: 16px 0 4px; }
  .stat { flex: 1; border: 1px solid #dde3e9; padding: 10px 12px; }
  .stat .v { font-size: 20px; font-weight: 800; }
  .stat .l { font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.15em; text-transform: uppercase; color: #6b7683; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { text-align: left; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: #6b7683; border-bottom: 2px solid #16202b; padding: 6px 8px; }
  td { border-bottom: 1px solid #e6ebf0; padding: 6px 8px; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  th.num { text-align: right; }
  .conf { font-family: 'Courier New', monospace; font-size: 9px; text-transform: uppercase; padding: 1px 6px; border: 1px solid; }
  .conf-high { color: #047857; border-color: #047857; }
  .conf-medium { color: #b45309; border-color: #b45309; }
  .conf-low { color: #b91c1c; border-color: #b91c1c; }
  .note { color: #6b7683; font-size: 11px; }
  .totals { width: 55%; margin-left: 45%; margin-top: 14px; }
  .totals td { padding: 5px 8px; }
  .grand td { border-top: 2px solid #16202b; border-bottom: none; font-weight: 800; font-size: 14px; }
  footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #dde3e9; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.15em; text-transform: uppercase; color: #6b7683; }
</style>
</head>
<body>
  <header>
    <div class="eyebrow">Electrical plan take-off · AI-read &amp; grounded pricing</div>
    <h1>${esc(input.businessName)} <span class="accent">×</span> QuoteMate</h1>
    <div class="meta">${esc(input.filename)} · ${date}${
      input.sheetsUsed.length > 0 ? ` · Sheets: ${esc(input.sheetsUsed.join(', '))}` : ''
    }</div>
  </header>

  <div class="statgrid">
    <div class="stat"><div class="v">${input.items.length}</div><div class="l">Item types</div></div>
    <div class="stat"><div class="v">${deviceCount}</div><div class="l">Devices counted</div></div>
    ${
      input.bom
        ? `<div class="stat"><div class="v">${aud(input.bom.totalIncGst)}</div><div class="l">Indicative total${input.bom.gstRegistered ? ' inc GST' : ''}</div></div>`
        : ''
    }
  </div>

  <h2>Counted items</h2>
  <table>
    <thead><tr><th>Item</th><th>Symbol</th><th class="num">Count</th><th>Confidence</th></tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
  ${input.overallNote ? `<p class="note">Reader's note: ${esc(input.overallNote)}</p>` : ''}

  ${pricingSection}

  <footer>Generated by QuoteMate · Counts read by AI from the supplied plan · Final scope &amp; price confirmed by ${esc(
    input.businessName,
  )}</footer>
</body>
</html>`
}
