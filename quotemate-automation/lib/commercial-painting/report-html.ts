// Tender-quote PDF HTML for commercial painting (Gotenberg renders it
// to A4 via lib/pdf/gotenberg). Pure string builder, fully escaped,
// inline styles only — same conventions as lib/roofing/report-html.ts.
// AU formatting throughout.

import type { PricedPaintBom } from './types'

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function aud(n: number): string {
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })
}

export function buildPaintTenderReportHtml(input: {
  businessName: string
  jobName?: string | null
  siteAddress?: string | null
  bom: PricedPaintBom
  quoteViewUrl?: string | null
  generatedAt?: Date
}): string {
  const { businessName, jobName, siteAddress, bom } = input
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
        <td>${esc(e.label)}<br /><span class="dim">${esc(e.reason)}</span></td>
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

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Painting tender — ${esc(jobName ?? siteAddress ?? 'Commercial job')}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #16202e; margin: 0; font-size: 12px; line-height: 1.5; }
  .head { background: #0e1622; color: #fff; padding: 26px 32px; }
  .head .biz { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #ff5a1f; font-weight: 700; }
  .head h1 { margin: 6px 0 2px; font-size: 24px; text-transform: uppercase; letter-spacing: -0.01em; }
  .head .sub { color: #b8c2d1; font-size: 12px; }
  .wrap { padding: 24px 32px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: #0e1622; border-bottom: 2px solid #ff5a1f; padding-bottom: 4px; margin: 22px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #7a8699; padding: 4px 8px 4px 0; border-bottom: 1px solid #d8dee8; }
  td { padding: 5px 8px 5px 0; border-bottom: 1px solid #eef1f6; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  th.num { text-align: right; }
  .dim { color: #7a8699; font-size: 10px; }
  .totals { margin-top: 14px; margin-left: auto; width: 280px; }
  .totals td { border: 0; padding: 3px 0; }
  .totals .grand td { border-top: 2px solid #0e1622; font-weight: 700; font-size: 15px; padding-top: 7px; }
  .grand .amt { color: #ff5a1f; }
  ul { margin: 6px 0 0; padding-left: 18px; }
  li { margin: 2px 0; }
  .foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #d8dee8; color: #7a8699; font-size: 10px; }
  .crew { display: table; width: 100%; margin-top: 4px; }
  .crew > div { display: table-cell; width: 25%; padding: 10px 12px; border: 1px solid #d8dee8; }
  .crew .k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #7a8699; }
  .crew .v { font-size: 16px; font-weight: 700; margin-top: 2px; }
</style>
</head>
<body>
  <div class="head">
    <div class="biz">${esc(businessName)}</div>
    <h1>Painting tender</h1>
    <div class="sub">${esc(jobName ?? '')}${jobName && siteAddress ? ' · ' : ''}${esc(siteAddress ?? '')} · ${esc(date)}</div>
  </div>
  <div class="wrap">

    <div class="crew">
      <div><div class="k">Labour</div><div class="v">${bom.labour.hours} h</div></div>
      <div><div class="k">Crew</div><div class="v">${bom.labour.crewSize} painters</div></div>
      <div><div class="k">On site</div><div class="v">≈ ${bom.labour.estimatedDays} day${bom.labour.estimatedDays === 1 ? '' : 's'}</div></div>
      <div><div class="k">Tender inc GST</div><div class="v" style="color:#ff5a1f">${aud(bom.totalIncGst)}</div></div>
    </div>

    <h2>Scope of works</h2>
    <table>
      <thead><tr><th>Surface</th><th class="num">Quantity</th><th class="num">Labour</th><th class="num">Line ex GST</th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table>

    <h2>Materials</h2>
    <table>
      <thead><tr><th>Product</th><th class="num">Litres</th><th class="num">Rate</th><th class="num">Cost ex GST</th></tr></thead>
      <tbody>${materialRows}</tbody>
    </table>

    ${bom.equipment.length > 0 ? `
    <h2>Equipment &amp; access</h2>
    <table>
      <thead><tr><th>Item</th><th class="num">Duration</th><th class="num">Rate</th><th class="num">Cost ex GST</th></tr></thead>
      <tbody>${equipmentRows}</tbody>
    </table>` : ''}

    ${bom.separate.lines.length > 0 ? `
    <h2>Separate prices (optional, not in the tender total)</h2>
    <table>
      <thead><tr><th>Surface</th><th class="num">Quantity</th><th class="num">Labour</th><th class="num">Price ex GST</th></tr></thead>
      <tbody>${separateRows}</tbody>
    </table>` : ''}

    <table class="totals">
      <tbody>
        <tr><td>Labour</td><td class="num">${aud(bom.labour.costExGst)}</td></tr>
        <tr><td>Materials</td><td class="num">${aud(bom.materialsExGst)}</td></tr>
        <tr><td>Equipment</td><td class="num">${aud(bom.equipmentExGst)}</td></tr>
        <tr><td>Subtotal ex GST</td><td class="num">${aud(bom.subtotalExGst)}</td></tr>
        <tr><td>GST</td><td class="num">${aud(bom.gst)}</td></tr>
        <tr class="grand"><td>Tender total inc GST</td><td class="num amt">${aud(bom.totalIncGst)}</td></tr>
      </tbody>
    </table>

    <h2>Assumptions</h2>
    <ul>${list(bom.assumptions)}</ul>

    <h2>Exclusions</h2>
    <ul>${list(bom.exclusions)}</ul>

    <div class="foot">
      Quote prepared with QuoteMate.${input.quoteViewUrl ? ` View online: ${esc(input.quoteViewUrl)}` : ''}
      This tender is valid for 30 days and subject to site verification of access and substrate condition.
    </div>
  </div>
</body>
</html>`
}
