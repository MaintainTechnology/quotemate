// Self-contained HTML for the customer OPENSOLAR proposal PDF, rendered
// by Gotenberg (lib/pdf/gotenberg.ts). Mirrors the Pylon proposal's print
// theme (mono eyebrows, orange accent, uppercase display headings, inline
// styles) and the reference proposal's section order.
//
// Money convention: every dollar figure is the tradie's own number from
// their OpenSolar design — the quote table renders line items / system
// pricing verbatim. Sections sourced from the design (monthly output,
// bills, financial metrics) say so; QuoteMate-modelled fallbacks are
// labelled "modelled". Pure; unit-tested.

import type { OpenSolarModelled } from './modelled'
import type { OpenSolarProposalDesign, OpenSolarQuoteTable } from './proposal'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export type OpenSolarReportInput = {
  businessName: string
  title: string | null
  address: string | null
  customerName: string | null
  design: OpenSolarProposalDesign
  table: OpenSolarQuoteTable
  modelled: OpenSolarModelled | null
  /** Absolute, token-gated cached-asset URLs; null = section omitted. */
  systemImageUrl: string | null
  shadeReportUrl: string | null
  energyYieldUrl: string | null
  sitePlanUrl: string | null
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
  other: 'Balance of system',
}

function componentsTable(design: OpenSolarProposalDesign): string {
  if (design.components.length === 0) return ''
  const rows = design.components
    .map((c) => {
      const name = [c.manufacturer, c.code].filter(Boolean).join(' · ') || 'Component'
      return (
        `<tr><td>${esc(KIND_LABEL[c.kind] ?? c.kind)}</td>` +
        `<td>${esc(name)}</td>` +
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

function quoteTableSection(table: OpenSolarQuoteTable): string {
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
  if (table.total_formatted) {
    summary.push(
      `<tr class="net"><td colspan="2">Total system price (inc ${esc(table.tax_name)})</td><td class="num">${esc(table.total_formatted)}</td></tr>`,
    )
  }
  if (table.deposit_formatted) {
    summary.push(
      `<tr><td colspan="2">Deposit to proceed${
        table.payment_option_label ? ` · ${esc(table.payment_option_label)}` : ''
      }</td><td class="num">${esc(table.deposit_formatted)}</td></tr>`,
    )
  }
  return `
  <h2>Your quote</h2>
  <table>
    <tbody>${rows}${summary.join('')}</tbody>
  </table>
  <p class="note">Prices are exactly as designed by your installer in OpenSolar — QuoteMate displays them verbatim.</p>`
}

export function buildOpenSolarProposalHtml(input: OpenSolarReportInput): string {
  const { design, table, modelled } = input
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const title = input.title ?? design.system_name ?? 'Solar system'
  const kw = design.kw_stc
  const storage = design.battery_total_kwh

  const headline = [
    kw != null ? `${kw.toFixed(2)} kW solar` : null,
    storage != null && storage > 0 ? `${storage.toFixed(1)} kWh storage` : null,
  ]
    .filter(Boolean)
    .join(' + ')

  const parts: string[] = []

  // 2. Proposed panel layout — the authoritative OpenSolar render.
  if (input.systemImageUrl) {
    parts.push(`
  <h2>Proposed panel layout</h2>
  <div class="figure">
    <img class="snapshot" src="${esc(input.systemImageUrl)}" alt="Designed panel layout on your roof">
    <div class="fig-caption">The panels exactly as your installer placed them in OpenSolar studio — this is the engineering layout, not an illustration.</div>
  </div>`)
  }

  // 3. System details (components + production).
  parts.push(componentsTable(design))
  if (modelled?.charts.monthly_production) {
    parts.push(
      chartFigure(
        modelled.annual_is_design
          ? 'Monthly production (OpenSolar design)'
          : 'Monthly production (modelled by QuoteMate)',
        modelled.charts.monthly_production,
      ),
    )
  }

  // 4. Utility costs.
  if (modelled?.charts.utility_costs) {
    parts.push(
      chartFigure(
        modelled.utility?.is_design
          ? 'Utility costs — before & with solar (OpenSolar design)'
          : 'Utility costs — before & with solar (modelled)',
        modelled.charts.utility_costs,
      ),
    )
  }

  // 5. Financial summary — design figures verbatim, modelled fallbacks.
  if (modelled && modelled.financial_stats.length > 0) {
    const anyModelled = modelled.financial_stats.some((s) => s.source === 'modelled')
    parts.push(
      `<h2>Financial summary${anyModelled ? ' (incl. modelled figures)' : ''}</h2>` +
        statGrid(modelled.financial_stats) +
        '<p class="note">Figures marked from your design come from OpenSolar; modelled figures are QuoteMate projections from the designed system size and standard tariff assumptions — not financial advice.</p>',
    )
  }

  // 6. Financial analysis charts.
  if (modelled?.charts.cumulative_savings) {
    parts.push(
      chartFigure('Cumulative savings (modelled projection)', modelled.charts.cumulative_savings),
    )
  }
  if (modelled?.charts.monthly_bill) {
    parts.push(chartFigure('Monthly bill comparison', modelled.charts.monthly_bill))
  }

  // 7. Environmental analysis.
  if (modelled?.environmental || design.co2_tons_lifetime != null) {
    const env = modelled?.environmental
    const stats: Array<{ label: string; value: string }> = []
    if (design.co2_tons_lifetime != null) {
      stats.push({
        label: 'CO\u2082 avoided (lifetime)',
        value: `${design.co2_tons_lifetime.toLocaleString('en-AU')} t`,
      })
    }
    if (env) {
      stats.push(
        { label: 'CO\u2082e avoided / yr', value: `${env.tonnes_co2_per_year.toLocaleString('en-AU')} t` },
        { label: 'Like planting', value: `${env.trees_equiv_per_year.toLocaleString('en-AU')} trees/yr` },
        { label: 'Like not driving', value: `${env.km_driven_equiv_per_year.toLocaleString('en-AU')} km/yr` },
      )
    }
    if (stats.length > 0) {
      parts.push(
        '<h2>Environmental analysis</h2>' +
          statGrid(stats) +
          '<p class="note">Lifetime CO\u2082 from your OpenSolar design where shown; equivalents are indicative, not a certified carbon statement.</p>',
      )
    }
  }

  // 8. Quote table + payment.
  parts.push(quoteTableSection(table))

  // 9. Assumed values.
  if (modelled && modelled.assumptions.length > 0) {
    parts.push('<h2>Assumed values</h2>' + statGrid(modelled.assumptions))
  }

  // 10. Engineering appendices.
  const appendices = [
    input.shadeReportUrl ? `<a href="${esc(input.shadeReportUrl)}">Shade report (PDF)</a>` : null,
    input.energyYieldUrl
      ? `<a href="${esc(input.energyYieldUrl)}">Energy yield report (PDF)</a>`
      : null,
    input.sitePlanUrl ? `<a href="${esc(input.sitePlanUrl)}">PV site plan (PDF)</a>` : null,
  ].filter(Boolean)
  if (appendices.length > 0) {
    parts.push(`
  <h2>Engineering appendices</h2>
  <p>Companion documents generated from this design in OpenSolar: ${appendices.join(' · ')}</p>`)
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
    <div class="eyebrow">Solar proposal · designed in OpenSolar studio</div>
    <h1>${esc(input.businessName)} <span class="accent">\u00d7</span> QuoteMate</h1>
    <div class="meta">${[input.customerName, input.address, date].filter(Boolean).map((s) => esc(s as string)).join(' · ')}</div>
  </header>

  <h2>Your system</h2>
  <div class="summary">
    ${esc(title)}${headline ? ` — ${esc(headline)}` : ''}. Designed by ${esc(input.businessName)} in OpenSolar studio;
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
