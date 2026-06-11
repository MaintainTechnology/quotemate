// Self-contained HTML for the customer quote PDF (electrical + plumbing
// G/B/B quotes), rendered by Gotenberg (lib/pdf/gotenberg.ts).
//
// Print-friendly light theme matching the plan take-off report
// (lib/estimation/report-html.ts): mono eyebrows, orange accent, uppercase
// display headings, all styles inline. Pure — unit-tested.
//
// Money convention: tiers store subtotal_ex_gst; the customer-facing PDF
// shows inc-GST headline prices using the SAME rounding as the quote SMS
// (Math.round(ex * 1.10) — lib/sms/templates.ts incGst).

export type QuoteReportLineItem = {
  description: string
  quantity: number
  unit: string
  unit_price_ex_gst: number
  total_ex_gst: number
}

export type QuoteReportTier = {
  label: string
  subtotal_ex_gst: number | string
  line_items?: QuoteReportLineItem[]
} | null

export type QuoteReportInput = {
  businessName: string
  customerName?: string | null
  jobType: string
  scopeOfWorks?: string | null
  assumptions?: string[] | null
  estimatedTimeframe?: string | null
  good: QuoteReportTier
  better: QuoteReportTier
  best: QuoteReportTier
  selectedTier?: 'good' | 'better' | 'best' | null
  quoteViewUrl?: string | null
  licenceLine?: string | null
  generatedAt?: Date
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const aud = (n: number) =>
  '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Same inc-GST rounding the quote SMS uses. */
export function incGst(exGst: number | string): number {
  const n = typeof exGst === 'string' ? parseFloat(exGst) : exGst
  return Math.round((Number.isFinite(n) ? n : 0) * 1.1)
}

function prettyJobType(jobType: string): string {
  return jobType.replace(/_/g, ' ')
}

function tierSection(
  key: 'good' | 'better' | 'best',
  tier: QuoteReportTier,
  selected: boolean,
): string {
  if (!tier) return ''
  const price = incGst(tier.subtotal_ex_gst)
  const rows = (tier.line_items ?? [])
    .map(
      (li) => `
      <tr>
        <td>${esc(li.description)}</td>
        <td class="num">${li.quantity} ${esc(li.unit)}</td>
        <td class="num">${aud(li.unit_price_ex_gst)}</td>
        <td class="num">${aud(li.total_ex_gst)}</td>
      </tr>`,
    )
    .join('')
  return `
  <section class="tier ${selected ? 'tier-selected' : ''}">
    <div class="tier-head">
      <span class="tier-name">${key.toUpperCase()}${selected ? ' · RECOMMENDED' : ''}</span>
      <span class="tier-price">$${price.toLocaleString('en-AU')} <small>inc GST</small></span>
    </div>
    <div class="tier-label">${esc(tier.label ?? '')}</div>
    ${
      rows
        ? `<table>
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit (ex GST)</th><th class="num">Total (ex GST)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`
        : ''
    }
  </section>`
}

export function buildQuoteReportHtml(input: QuoteReportInput): string {
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const job = prettyJobType(input.jobType)
  const tiers = (['good', 'better', 'best'] as const)
    .map((key) => tierSection(key, input[key], input.selectedTier === key))
    .join('')

  const assumptions = (input.assumptions ?? []).filter((a) => a && a.trim())

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>Quote — ${esc(input.businessName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #16202b; margin: 0; font-size: 12px; line-height: 1.5; }
  header { border-bottom: 3px solid #FF5F00; padding-bottom: 14px; margin-bottom: 18px; }
  .eyebrow { font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: #6b7683; }
  h1 { font-size: 24px; text-transform: uppercase; letter-spacing: -0.02em; margin: 6px 0 2px; }
  h1 .accent { color: #FF5F00; }
  .meta { color: #6b7683; font-size: 11px; }
  h2 { font-size: 13px; text-transform: uppercase; margin: 22px 0 6px; letter-spacing: 0.02em; }
  .scope { border-left: 3px solid #FF5F00; padding: 8px 12px; background: #f7f8fa; }
  .tier { border: 1px solid #dde3e9; margin-top: 14px; padding: 12px 14px; page-break-inside: avoid; }
  .tier-selected { border: 2px solid #FF5F00; }
  .tier-head { display: flex; justify-content: space-between; align-items: baseline; }
  .tier-name { font-family: 'Courier New', monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.15em; color: #FF5F00; }
  .tier-price { font-size: 20px; font-weight: 800; }
  .tier-price small { font-size: 10px; font-weight: 400; color: #6b7683; }
  .tier-label { margin-top: 2px; color: #3a4654; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { text-align: left; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.12em; text-transform: uppercase; color: #6b7683; border-bottom: 2px solid #16202b; padding: 5px 6px; }
  td { border-bottom: 1px solid #e6ebf0; padding: 5px 6px; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  th.num { text-align: right; }
  ul { margin: 6px 0 0; padding-left: 18px; }
  li { margin-bottom: 3px; }
  .note { color: #6b7683; font-size: 11px; }
  footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #dde3e9; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.15em; text-transform: uppercase; color: #6b7683; }
</style>
</head>
<body>
  <header>
    <div class="eyebrow">Customer quote · Good / Better / Best</div>
    <h1>${esc(input.businessName)} <span class="accent">×</span> QuoteMate</h1>
    <div class="meta">${
      input.customerName ? `Prepared for ${esc(input.customerName)} · ` : ''
    }${esc(job)} · ${date}${
      input.estimatedTimeframe ? ` · Est. timeframe: ${esc(input.estimatedTimeframe)}` : ''
    }</div>
  </header>

  ${
    input.scopeOfWorks
      ? `<h2>Scope of works</h2>
  <div class="scope">${esc(input.scopeOfWorks)}</div>`
      : ''
  }

  <h2>Your options</h2>
  ${tiers}

  ${
    assumptions.length > 0
      ? `<h2>Assumptions</h2>
  <ul>${assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`
      : ''
  }

  <p class="note">Headline prices include 10% GST; line items are shown ex GST.
  ${input.quoteViewUrl ? `Pay links and the live version of this quote: ${esc(input.quoteViewUrl)}` : ''}</p>

  <footer>Generated by QuoteMate${
    input.licenceLine ? ` · ${esc(input.licenceLine)}` : ''
  } · Reply to your SMS or call to confirm a tier</footer>
</body>
</html>`
}
