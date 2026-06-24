// Self-contained HTML for the customer quote PDF (electrical + plumbing
// G/B/B quotes), rendered by Gotenberg (lib/pdf/gotenberg.ts).
//
// White-label Caterpillar chrome shared with every trade
// (lib/pdf/report-chrome.ts). The body keeps its native Good/Better/Best
// tier structure (spec specs/quote-pdf-branding.md D2/R4). Pure — unit-tested.
//
// Money convention: tiers store subtotal_ex_gst; the customer-facing PDF
// shows inc-GST headline prices using the SAME rounding as the quote SMS
// (Math.round(ex * 1.10) — lib/sms/templates.ts incGst).

import {
  renderReportDocument,
  brandingFromName,
  esc,
  aud2,
  type TenantBranding,
} from '../pdf/report-chrome'

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
  /** Full white-label branding; when omitted, derived from businessName. */
  branding?: TenantBranding
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
  /** Deprecated: licence now flows via `branding.licenceLine`. Kept for back-compat. */
  licenceLine?: string | null
  generatedAt?: Date
}

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
        <td class="num">${aud2(li.unit_price_ex_gst)}</td>
        <td class="num">${aud2(li.total_ex_gst)}</td>
      </tr>`,
    )
    .join('')
  return `
  <section class="part">
    <div class="tier-head" style="display:flex;justify-content:space-between;align-items:baseline;">
      <span class="marker" style="padding:4px 10px;font-size:11px;letter-spacing:0.12em;">${key.toUpperCase()}${
        selected ? ' · RECOMMENDED' : ''
      }</span>
      <span class="tier-price" style="font-size:20px;font-weight:800;">$${price.toLocaleString(
        'en-AU',
      )} <small style="font-size:10px;font-weight:400;color:var(--dim);">inc GST</small></span>
    </div>
    <div class="tier-label" style="margin-top:6px;color:var(--sec);font-weight:600;">${esc(
      tier.label ?? '',
    )}</div>
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

/** Per-trade default "Please Note" disclaimers (R7). */
const QUOTE_PLEASE_NOTE = [
  'Headline tier prices include 10% GST; line items are shown ex GST.',
  'Final pricing is confirmed on site; variations to the scope above are quoted separately.',
  'Materials are supplied to equivalent specification where a named brand is unavailable.',
]

export function buildQuoteReportHtml(input: QuoteReportInput): string {
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const branding = input.branding ?? brandingFromName(input.businessName)
  const job = prettyJobType(input.jobType)
  const tiers = (['good', 'better', 'best'] as const)
    .map((key) => tierSection(key, input[key], input.selectedTier === key))
    .join('')

  const assumptions = (input.assumptions ?? []).filter((a) => a && a.trim()) as string[]

  let body = ''
  if (input.scopeOfWorks) {
    body += `<h2>Scope of works</h2><div class="scope">${esc(input.scopeOfWorks)}</div>`
  }
  body += `<h2>Your options</h2>${tiers}`
  if (assumptions.length > 0) {
    body += `<h2>Assumptions</h2><ul class="bullets">${assumptions
      .map((a) => `<li>${esc(a)}</li>`)
      .join('')}</ul>`
  }

  const closingLine = input.quoteViewUrl
    ? `Pay links and the live version of this quote: ${input.quoteViewUrl}`
    : null

  return renderReportDocument(branding, {
    docTitle: `Quote — ${branding.businessName}`,
    eyebrow: 'Customer quote · Good / Better / Best',
    dateLabel: date,
    customerName: input.customerName ?? null,
    customerContact: input.estimatedTimeframe ? `Est. timeframe: ${input.estimatedTimeframe}` : null,
    introHtml: `Thank you for the opportunity to quote for <strong>${esc(
      job,
    )}</strong>. Your Good / Better / Best options are set out below.`,
    bodyHtml: body,
    pleaseNote: QUOTE_PLEASE_NOTE,
    closingLine,
  })
}
