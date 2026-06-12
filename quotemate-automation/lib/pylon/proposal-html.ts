// Self-contained HTML for the customer PYLON proposal PDF, rendered by
// Gotenberg (lib/pdf/gotenberg.ts). Mirrors the solar report's print
// theme (mono eyebrows, orange accent, uppercase display headings,
// inline styles) and the Pylon web proposal's section order.
//
// Money convention: every dollar figure is the tradie's own number from
// their Pylon design — the quote table renders line items verbatim
// (inc-tax line amounts, pre-formatted summary strings). Modelled
// sections (production / savings / environmental) are QuoteMate-computed
// from design facts and labelled as such. Pure; unit-tested.

import type { PylonModelled } from './modelled'
import type { PylonProposalDesign, PylonQuoteTable } from './proposal'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export type PylonReportInput = {
  businessName: string
  title: string | null
  address: string | null
  customerName: string | null
  design: PylonProposalDesign
  table: PylonQuoteTable
  modelled: PylonModelled | null
  /** Absolute, token-gated cached-asset URLs; null = section omitted. */
  snapshotUrl: string | null
  sldUrl: string | null
  siteInfoUrl: string | null
  quoteViewUrl?: string | null
  licenceLine?: string | null
  generatedAt?: Date
}

function chartFigure(heading: string, chart: { svg: string; caption: string }): string {
  return `
  <h2>${esc(heading)}</h2>
  <div class="figure">
    <div class="chart">${chart.svg}</div>
    <div class="fig-caption">${esc(chart.caption)}</div>
  </div>`
}

function statGrid(rows: Array<{ label: string; value: string; hint?: string }>): string {
  return (
    '<div class="stats">' +
    rows
      .map(
        (r) =>
          `<div class="stat"><div class="stat-label">${esc(r.label)}</div>` +
          `<div class="stat-value">${esc(r.value)}</div>` +
          (r.hint ? `<div class="stat-hint">${esc(r.hint)}</div>` : '') +
          '</div>',
      )
      .join('') +
    '</div>'
  )
}

const KIND_LABEL: Record<string, string> = {
  module: 'Solar panels',
  inverter: 'Inverter',
  battery: 'Battery storage',
  material: 'Materials',
  heat_pump: 'Heat pump',
  ev_charger: 'EV charger',
  mounting: 'Mounting system',
}

function componentsTable(design: PylonProposalDesign): string {
  if (design.components.length === 0) return ''
  const rows = design.components
    .map((c) => {
      const ds = c.datasheet
      const name = ds?.name ?? c.description
      const detail =
        ds && (ds.brand || ds.model_number)
          ? [ds.brand, ds.series, ds.model_number].filter(Boolean).join(' · ')
          : ''
      const sheet = ds?.datasheet_url
        ? ` <a href="${esc(ds.datasheet_url)}">Datasheet (PDF)</a>`
        : ''
      return (
        `<tr><td>${esc(KIND_LABEL[c.kind] ?? c.kind)}</td>` +
        `<td>${esc(name)}${detail ? `<div class="comp-detail">${esc(detail)}</div>` : ''}${sheet}</td>` +
        `<td class="num">${c.quantity != null ? `\u00d7${c.quantity}` : ''}</td></tr>`
      )
    })
    .join('')
  return `
  <h2>System details</h2>
  <table class="components">
    <thead><tr><th>Component</th><th>Make &amp; model</th><th class="num">Qty</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

function quoteTableSection(table: PylonQuoteTable): string {
  const rows = table.rows
    .map(
      (r) =>
        `<tr${r.is_rebate ? ' class="rebate"' : ''}>` +
        `<td>${esc(r.description)}</td>` +
        `<td class="num">${r.quantity != null ? `\u00d7${r.quantity}` : ''}</td>` +
        `<td class="num">${r.amount_formatted != null ? esc(r.amount_formatted) : 'Included'}</td></tr>`,
    )
    .join('')
  const summary: string[] = []
  if (table.total_tax_formatted) {
    summary.push(`<tr><td colspan="2">Includes GST</td><td class="num">${esc(table.total_tax_formatted)}</td></tr>`)
  }
  if (table.total_formatted) {
    summary.push(
      `<tr class="net"><td colspan="2">Total system price (inc GST)</td><td class="num">${esc(table.total_formatted)}</td></tr>`,
    )
  }
  if (table.deposit_formatted) {
    summary.push(
      `<tr><td colspan="2">Deposit to proceed</td><td class="num">${esc(table.deposit_formatted)}</td></tr>`,
    )
  }
  if (table.amount_payable_formatted) {
    summary.push(
      `<tr><td colspan="2">Amount payable</td><td class="num">${esc(table.amount_payable_formatted)}</td></tr>`,
    )
  }
  return `
  <h2>Your quote</h2>
  <table>
    <tbody>${rows}${summary.join('')}</tbody>
  </table>
  <p class="note">Prices are exactly as designed by your installer in Pylon — QuoteMate displays them verbatim.</p>`
}

export function buildPylonProposalHtml(input: PylonReportInput): string {
  const { design, table, modelled } = input
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const title = input.title ?? design.title ?? 'Solar system'
  const dc = design.summary.dc_output_kw
  const storage = design.summary.storage_kwh

  const headline = [
    dc != null ? `${dc.toFixed(2)} kW solar` : null,
    storage != null && storage > 0 ? `${storage.toFixed(1)} kWh storage` : null,
  ]
    .filter(Boolean)
    .join(' + ')

  const parts: string[] = []

  // 2. Proposed panel layout — the engineer-authored design snapshot.
  if (input.snapshotUrl) {
    parts.push(`
  <h2>Proposed panel layout</h2>
  <div class="figure">
    <img class="snapshot" src="${esc(input.snapshotUrl)}" alt="Designed panel layout on your roof">
    <div class="fig-caption">Engineer-designed layout from Pylon studio — the panels exactly as your installer placed them.</div>
  </div>`)
  }

  // 3. Panel strings & component markings — the single-line diagram.
  if (input.sldUrl) {
    parts.push(`
  <h2>Panel strings &amp; component markings</h2>
  <p>The electrical single-line diagram for this design — panels, strings, inverter and protection devices — is attached to this proposal:
  <a href="${esc(input.sldUrl)}">Single-line diagram (PDF)</a>${
    input.siteInfoUrl
      ? ` · <a href="${esc(input.siteInfoUrl)}">PV site information / AS\u2011NZS\u00a05033 site plan (PDF)</a>`
      : ''
  }</p>`)
  }

  // 4. System details.
  parts.push(componentsTable(design))
  if (modelled?.charts.monthly_production) {
    parts.push(chartFigure('Monthly production (modelled by QuoteMate)', modelled.charts.monthly_production))
  }

  // 5. Utility costs.
  if (modelled?.charts.utility_costs) {
    parts.push(chartFigure('Utility costs — before & with solar (modelled)', modelled.charts.utility_costs))
  }

  // 6. 20-year financial summary.
  if (modelled?.financial) {
    const f = modelled.financial
    const aud0 = (n: number) => '$' + Math.round(n).toLocaleString('en-AU')
    const payback =
      f.payback_years_low != null && f.payback_years_high != null
        ? `${Math.round(f.payback_years_low)}\u2013${Math.round(f.payback_years_high)} yrs`
        : 'See installer'
    parts.push(
      '<h2>20-year financial summary (modelled)</h2>' +
        statGrid([
          {
            label: 'Net present value',
            value: aud0(f.npv_aud),
            hint: `Discounted at ${(f.assumptions.discount_rate_pct * 100).toFixed(1)}%`,
          },
          { label: 'Payback', value: payback },
          {
            label: 'Total ROI (20 yr)',
            value: `${f.total_roi_pct.toLocaleString('en-AU')}%`,
            hint: `${aud0(f.total_savings_20yr_aud)} cumulative`,
          },
          {
            label: 'IRR',
            value: f.irr_pct != null ? `${f.irr_pct.toLocaleString('en-AU')}%` : 'See installer',
          },
        ]) +
        '<p class="note">Modelled projection by QuoteMate from your designed system size and standard tariff assumptions — not financial advice. Actual results depend on your usage, tariffs and weather.</p>',
    )
  }

  // 7. Financial analysis charts.
  if (modelled?.charts.cumulative_savings) {
    parts.push(chartFigure('Cumulative savings (25-year modelled projection)', modelled.charts.cumulative_savings))
  }
  if (modelled?.charts.monthly_bill) {
    parts.push(chartFigure('Monthly bill comparison (modelled)', modelled.charts.monthly_bill))
  }

  // 8. Environmental analysis.
  if (modelled?.environmental) {
    const env = modelled.environmental
    parts.push(
      '<h2>Environmental analysis (modelled)</h2>' +
        statGrid([
          { label: 'CO\u2082e avoided / yr', value: `${env.tonnes_co2_per_year.toLocaleString('en-AU')} t` },
          { label: 'CO\u2082e over 20 yrs', value: `${env.tonnes_co2_20yr.toLocaleString('en-AU')} t` },
          { label: 'Like planting', value: `${env.trees_equiv_per_year.toLocaleString('en-AU')} trees/yr` },
          { label: 'Like not driving', value: `${env.km_driven_equiv_per_year.toLocaleString('en-AU')} km/yr` },
        ]) +
        '<p class="note">Based on the Australian national grid emission factor — indicative, not a certified carbon statement.</p>',
    )
  }

  // 9. Quote table + payment.
  parts.push(quoteTableSection(table))

  // 10. Assumed values.
  if (modelled && modelled.assumptions.length > 0) {
    parts.push('<h2>Assumed values</h2>' + statGrid(modelled.assumptions))
  }

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>Solar proposal — ${esc(input.businessName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #16202b; margin: 0; font-size: 12px; line-height: 1.5; }
  header { border-bottom: 3px solid #FF5F00; padding-bottom: 14px; margin-bottom: 18px; }
  .eyebrow { font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: #6b7683; }
  h1 { font-size: 24px; text-transform: uppercase; letter-spacing: -0.02em; margin: 6px 0 2px; }
  h1 .accent { color: #FF5F00; }
  .meta { color: #6b7683; font-size: 11px; }
  h2 { font-size: 13px; text-transform: uppercase; margin: 22px 0 6px; letter-spacing: 0.02em; }
  .summary { border-left: 3px solid #FF5F00; padding: 8px 12px; background: #f7f8fa; }
  a { color: #FF5F00; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { text-align: left; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: #6b7683; border-bottom: 2px solid #16202b; padding: 5px 6px; }
  td { border-bottom: 1px solid #e6ebf0; padding: 5px 6px; vertical-align: top; }
  tr.net td { border-bottom: none; border-top: 2px solid #16202b; font-weight: 800; }
  tr.rebate td { color: #15803d; }
  .num { text-align: right; white-space: nowrap; }
  .comp-detail { color: #6b7683; font-size: 10px; }
  .note { color: #6b7683; font-size: 11px; }
  footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #dde3e9; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.15em; text-transform: uppercase; color: #6b7683; }
  .figure { border: 1px solid #dde3e9; page-break-inside: avoid; }
  .snapshot { display: block; width: 100%; }
  .chart { padding: 8px; }
  .chart svg { width: 100%; height: auto; }
  .fig-caption { padding: 6px 10px; border-top: 1px solid #dde3e9; color: #6b7683; font-size: 9.5px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: #dde3e9; border: 1px solid #dde3e9; page-break-inside: avoid; }
  .stat { background: #f7f8fa; padding: 8px 10px; }
  .stat-label { font-family: 'Courier New', monospace; font-size: 8px; letter-spacing: 0.12em; text-transform: uppercase; color: #6b7683; }
  .stat-value { font-size: 14px; font-weight: 800; margin-top: 2px; }
  .stat-hint { font-size: 8.5px; color: #6b7683; margin-top: 1px; }
</style>
</head>
<body>
  <header>
    <div class="eyebrow">Solar proposal · designed in Pylon studio</div>
    <h1>${esc(input.businessName)} <span class="accent">\u00d7</span> QuoteMate</h1>
    <div class="meta">${[input.customerName, input.address, date].filter(Boolean).map((s) => esc(s as string)).join(' · ')}</div>
  </header>

  <h2>Your system</h2>
  <div class="summary">
    ${esc(title)}${headline ? ` — ${esc(headline)}` : ''}. Designed by ${esc(input.businessName)} in Pylon studio;
    every price below is your installer's own figure, displayed verbatim.
  </div>

  ${parts.filter(Boolean).join('\n')}

  <p class="note">${input.quoteViewUrl ? `Live version of this proposal: ${esc(input.quoteViewUrl)}` : ''}</p>

  <footer>Generated by QuoteMate${
    input.licenceLine ? ` · ${esc(input.licenceLine)}` : ''
  } · Reply to your SMS or call to go ahead</footer>
</body>
</html>`
}
