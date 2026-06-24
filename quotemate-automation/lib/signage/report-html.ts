// Self-contained HTML for the signage compliance pre-check PDF, rendered
// by Gotenberg (lib/pdf/gotenberg.ts). White-label Caterpillar chrome shared
// with every trade (lib/pdf/report-chrome.ts). Unlike the money quotes this
// is a two-stage COMPLIANCE report (pass / fix / review verdicts with a
// count tally), not a priced quote — so the body is a count statgrid plus a
// per-group verdict table. Pure — no I/O.

import type { ComplianceReport, ReportItem, ReportItemState } from './compose-report'
import {
  renderReportDocument,
  renderFigure,
  brandingFromName,
  esc,
  type TenantBranding,
} from '../pdf/report-chrome'

export type SignageReportInput = {
  brandName: string
  /** Full white-label branding; when omitted, derived from brandName. */
  branding?: TenantBranding
  report: ComplianceReport
  /** Optional storefront / site image (already a data: URI or fetchable URL). */
  siteImageSrc?: string | null
  /** Live report URL note, shown as the closing line when present. */
  reportViewUrl?: string | null
  generatedAt?: Date
}

/** Finite-or-zero — guards the count tallies against a malformed payload. */
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const STATE_META: Record<ReportItemState, { label: string }> = {
  compliant: { label: 'OK' },
  fix: { label: 'Fix' },
  review: { label: 'Review' },
}

/** One verdict row in a group table — verdict flag + detail + any citations. */
function itemRow(it: ReportItem): string {
  const meta = STATE_META[it.state]
  const cites = [
    it.source_citation ? `Ref: ${it.source_citation}` : '',
    it.note ?? '',
    it.kb_citation ? `Brand standard: ${it.kb_citation}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return `
      <tr>
        <td><span class="flag">${esc(meta.label)}</span></td>
        <td>
          <div>${esc(it.detail)}</div>
          ${cites ? `<div class="note">${esc(cites)}</div>` : ''}
        </td>
      </tr>`
}

export function buildSignageReportHtml(input: SignageReportInput): string {
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const branding = input.branding ?? brandingFromName(input.brandName)
  const r = input.report
  const c = r.counts

  let body = ''

  // Two-stage count tally — the headline pass / fix / review verdict tiles.
  body += `
  <div class="statgrid">
    <div class="stat"><div class="v">${num(c.compliant)}</div><div class="l">Compliant</div></div>
    <div class="stat"><div class="v">${num(c.fix)}</div><div class="l">To fix</div></div>
    <div class="stat"><div class="v">${num(c.review)}</div><div class="l">Needs review</div></div>
  </div>`

  // Optional storefront / site image (mapped through the shared figure helper).
  body += renderFigure(input.siteImageSrc, 'Signage assessed in this pre-check.')

  // One verdict table per rule group (fixes first within each, set by the composer).
  for (const g of r.groups) {
    body += `
  <h2>${esc(g.group)}</h2>
  <table>
    <thead><tr><th>Verdict</th><th>Detail</th></tr></thead>
    <tbody>${g.items.map(itemRow).join('')}</tbody>
  </table>`
  }

  // The composer's automated-pre-check disclaimer leads the Please Note block.
  const pleaseNote = [
    r.disclaimer,
    'This is an automated visual pre-check from your photos — it does not replace a physical site survey.',
    'Verdicts marked "Needs review" require a brand-standards reviewer to confirm before sign-off.',
    'Items that could not be assessed (no photo for that shot) are omitted here, not passed.',
    'Brand-standard references cited above are a guide; the current brand manual prevails if it differs.',
  ].filter(Boolean) as string[]

  const closingLine = input.reportViewUrl
    ? `Photos and the live version of this pre-check: ${input.reportViewUrl}`
    : null

  return renderReportDocument(branding, {
    docTitle: `Signage compliance pre-check — ${branding.businessName}`,
    eyebrow: 'Signage compliance pre-check · Two-stage assessment',
    dateLabel: date,
    customerName: branding.businessName,
    introHtml: `Here is the automated signage pre-check for <strong>${esc(
      branding.businessName,
    )}</strong>. ${esc(
      r.summary,
    )}. Each item below is marked compliant, to fix, or needing a brand-standards reviewer.`,
    bodyHtml: body,
    pleaseNote,
    closingLine,
  })
}
