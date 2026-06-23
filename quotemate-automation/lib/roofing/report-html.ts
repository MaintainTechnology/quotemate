// Self-contained HTML for the customer roofing quote PDF, rendered by
// Gotenberg (lib/pdf/gotenberg.ts). Same print-friendly light theme as the
// trade-quote report (lib/quote/report-html.ts). Pure — unit-tested.

import type { MultiRoofQuote, RoofStructurePrice } from './types'

export type RoofReportInput = {
  businessName: string
  address: string
  quote: MultiRoofQuote
  quoteViewUrl?: string | null
  generatedAt?: Date
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const aud0 = (n: number) => '$' + Math.round(n).toLocaleString('en-AU')

function structureRows(structures: RoofStructurePrice[]): string {
  return structures
    .map((s) => {
      const inspect = s.price.routing.decision === 'inspection_required'
      const area = s.metrics?.sloped_area_m2 != null ? `${Math.round(s.metrics.sloped_area_m2)} m²` : '—'
      const better = s.price.tiers?.[1]
      return `
      <tr>
        <td>${esc(s.label)}</td>
        <td class="num">${area}</td>
        <td>${inspect ? '<span class="flag">needs on-site look</span>' : esc(better?.label ?? 'Re-roof')}</td>
        <td class="num">${inspect ? '—' : aud0(better?.inc_gst ?? 0)}</td>
      </tr>`
    })
    .join('')
}

export function buildRoofQuoteReportHtml(input: RoofReportInput): string {
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const q = input.quote
  const isInspection = q.routing.decision === 'inspection_required'
  const tiers = q.combined.tiers

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>Roofing quote — ${esc(input.businessName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #16202b; margin: 0; font-size: 12px; line-height: 1.5; }
  header { border-bottom: 3px solid #FF5F00; padding-bottom: 14px; margin-bottom: 18px; }
  .eyebrow { font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: #6b7683; }
  h1 { font-size: 24px; text-transform: uppercase; letter-spacing: -0.02em; margin: 6px 0 2px; }
  h1 .accent { color: #FF5F00; }
  .meta { color: #6b7683; font-size: 11px; }
  h2 { font-size: 13px; text-transform: uppercase; margin: 22px 0 6px; letter-spacing: 0.02em; }
  .statgrid { display: flex; gap: 12px; margin: 14px 0 4px; }
  .stat { flex: 1; border: 1px solid #dde3e9; padding: 10px 12px; }
  .stat .v { font-size: 19px; font-weight: 800; }
  .stat .v small { font-size: 10px; font-weight: 400; color: #6b7683; }
  .stat .l { font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.15em; text-transform: uppercase; color: #6b7683; }
  .stat-selected { border: 2px solid #FF5F00; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.12em; text-transform: uppercase; color: #6b7683; border-bottom: 2px solid #16202b; padding: 5px 6px; }
  td { border-bottom: 1px solid #e6ebf0; padding: 5px 6px; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  th.num { text-align: right; }
  .flag { font-family: 'Courier New', monospace; font-size: 9px; text-transform: uppercase; color: #b45309; border: 1px solid #b45309; padding: 1px 6px; }
  .scope { border-left: 3px solid #FF5F00; padding: 8px 12px; background: #f7f8fa; margin-top: 6px; }
  .note { color: #6b7683; font-size: 11px; }
  footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #dde3e9; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.15em; text-transform: uppercase; color: #6b7683; }
</style>
</head>
<body>
  <header>
    <div class="eyebrow">Roofing estimate · ${isInspection ? 'Inspection required' : 'Good / Better / Best'}</div>
    <h1>${esc(input.businessName)} <span class="accent">×</span> QuoteMax</h1>
    <div class="meta">${esc(input.address)} · ~${Math.round(q.combined.area_m2)} m² of roof across ${q.structures.length} structure${q.structures.length === 1 ? '' : 's'} · ${date}</div>
  </header>

  ${
    isInspection
      ? `<h2>Next step: on-site inspection</h2>
  <div class="scope">${esc(q.routing.reason ?? 'This roof needs a quick look on site before we can price it accurately.')}</div>`
      : `<h2>Your options (inc GST)</h2>
  <div class="statgrid">
    ${tiers
      .map(
        (t, i) => `<div class="stat ${i === 1 ? 'stat-selected' : ''}">
      <div class="v">${aud0(t.inc_gst)}</div>
      <div class="l">${esc(t.label)}</div>
    </div>`,
      )
      .join('')}
  </div>
  ${tiers[1]?.scope ? `<div class="scope">${esc(tiers[1].scope)}</div>` : ''}`
  }

  <h2>Structures measured</h2>
  <table>
    <thead><tr><th>Structure</th><th class="num">Sloped area</th><th>Recommended works</th><th class="num">Re-roof (inc GST)</th></tr></thead>
    <tbody>${structureRows(q.structures)}</tbody>
  </table>
  ${
    q.inspection_structures.length > 0
      ? `<p class="note">Needing an on-site look before final pricing: ${q.inspection_structures.map(esc).join(', ')}.</p>`
      : ''
  }

  <p class="note">Measured from aerial imagery; a roofer reviews every quote before anything is booked.
  ${input.quoteViewUrl ? `Roof image, map and live quote: ${esc(input.quoteViewUrl)}` : ''}</p>

  <footer>Generated by QuoteMax · Prices include 10% GST · Reply to your SMS to confirm or book</footer>
</body>
</html>`
}
