// Self-contained HTML for the customer residential-painting quote PDF,
// rendered by Gotenberg (lib/pdf/gotenberg.ts). Same print-friendly light
// theme as the roofing + trade-quote reports. Pure — no I/O, unit-tested.
//
// Painting's quote shape is unique: each tier carries a low/high inc-GST
// BAND (from the area-estimate confidence) on top of the point price, and
// the breakdown is a per-surface takeoff (walls/ceilings/trim/exterior).
// We surface the band as the "range, not a single number" the estimate
// honestly is, plus the surface takeoff so the customer sees what's priced.

import type { PaintingEstimate, PaintScope } from './types'

export type PaintingReportInput = {
  businessName: string
  address: string
  estimate: PaintingEstimate
  quoteViewUrl?: string | null
  generatedAt?: Date
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const aud0 = (n: number) => '$' + Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-AU')

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

export function buildPaintingQuoteReportHtml(input: PaintingReportInput): string {
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const price = input.estimate.price
  const isInspection = price.routing.decision === 'inspection_required'
  const tiers = price.tiers
  const surfaces = surfaceRows(input.estimate)
  const loadings = price.loadings_applied ?? []

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>Painting quote — ${esc(input.businessName)}</title>
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
  .stat .band { font-family: 'Courier New', monospace; font-size: 9px; color: #6b7683; margin-top: 2px; }
  .stat .l { font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.15em; text-transform: uppercase; color: #6b7683; margin-top: 4px; }
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
    <div class="eyebrow">Painting estimate · ${isInspection ? 'Inspection required' : 'Good / Better / Best'}</div>
    <h1>${esc(input.businessName)} <span class="accent">×</span> QuoteMax</h1>
    <div class="meta">${esc(input.address)} · ~${Math.round(price.total_area_m2)} m² paintable · ${esc(price.confidence)} confidence · ${date}</div>
  </header>

  ${
    isInspection
      ? `<h2>Next step: on-site measure</h2>
  <div class="scope">${esc(price.routing.reason ?? 'This job needs a quick on-site measure before we can price it accurately.')}</div>`
      : `<h2>Your options (inc GST)</h2>
  <div class="statgrid">
    ${tiers
      .map((t, i) => {
        const band = bandLabel(t.inc_gst_low, t.inc_gst_high, t.inc_gst)
        return `<div class="stat ${i === 1 ? 'stat-selected' : ''}">
      <div class="v">${aud0(t.inc_gst)}</div>
      ${band ? `<div class="band">range ${band}</div>` : ''}
      <div class="l">${esc(t.label)}</div>
    </div>`
      })
      .join('')}
  </div>
  ${tiers[1]?.scope ? `<div class="scope">${esc(tiers[1].scope)}</div>` : ''}`
  }

  ${
    surfaces
      ? `<h2>Surfaces measured</h2>
  <table>
    <thead><tr><th>Surface</th><th class="num">Quantity</th><th class="num">Rate</th><th class="num">Subtotal (ex GST)</th></tr></thead>
    <tbody>${surfaces}</tbody>
  </table>`
      : ''
  }

  ${
    loadings.length > 0
      ? `<p class="note">Loadings applied: ${loadings.map((l) => esc(l.detail)).join('; ')}.</p>`
      : ''
  }

  <p class="note">Estimated from property data and your inputs — a painter reviews every quote before anything is booked. Final price is confirmed after an on-site check.
  ${input.quoteViewUrl ? `Live quote: ${esc(input.quoteViewUrl)}` : ''}</p>

  <footer>Generated by QuoteMax · Prices include 10% GST · Reply to your SMS to confirm or book</footer>
</body>
</html>`
}
