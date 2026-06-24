// Self-contained HTML for the indicative air-conditioning recommendation
// PDF, rendered by Gotenberg (lib/pdf/gotenberg.ts). White-label Caterpillar
// chrome shared with every trade (lib/pdf/report-chrome.ts).
//
// Aircon is a RECOMMENDER, not a committable quote: it returns two options
// (ducted vs split) each with an indicative inc-GST price RANGE, plus the
// volumetric sizing. Every aircon result routes to "book an assessment",
// so the document is framed as indicative throughout — never a final price.
// Pure — no I/O, unit-tested.

import type { AcRecommendation, AcOption, AcSystemType } from './types'
import {
  renderReportDocument,
  renderBullets,
  brandingFromName,
  esc,
  aud0,
  type TenantBranding,
} from '../pdf/report-chrome'

export type AirconReportInput = {
  businessName: string
  /** Full white-label branding; when omitted, derived from businessName. */
  branding?: TenantBranding
  address: string
  recommendation: AcRecommendation
  climateZone?: string | null
  generatedAt?: Date
}

/** Finite-or-zero — guards .toFixed / arithmetic against a malformed payload. */
const num = (v: number) => (Number.isFinite(v) ? v : 0)

const SYSTEM_LABELS: Record<AcSystemType, string> = {
  ducted: 'Ducted (whole-home)',
  split: 'Split system',
}

/** One option card — capacity, indicative inc-GST range, why-it-fits / trade-offs. */
function optionBlock(o: AcOption): string {
  const label = esc(SYSTEM_LABELS[o.system_type] ?? o.system_type)
  const chip = o.best_fit ? ' <span class="chip">Best fit</span>' : ''
  return `
  <section class="part${o.best_fit ? ' stat-selected' : ''}">
    <div class="part-head" style="justify-content:space-between;">
      <h2 class="part-title">${label}${chip}</h2>
      <span class="mono" style="color:var(--dim);font-size:11px;">${num(o.capacity_kw).toFixed(1)} kW</span>
    </div>
    <div class="price" style="font-size:18px;margin-top:8px;">${aud0(o.price.low)} – ${aud0(
      o.price.high,
    )} <span class="caveat" style="font-size:10px;">inc GST (indicative)</span></div>
    <div class="opt-cols" style="display:flex;gap:18px;margin-top:8px;">
      <div style="flex:1;">
        <div class="mono" style="font-size:8.5px;letter-spacing:0.12em;text-transform:uppercase;color:var(--dim);">Why it fits</div>
        ${o.pros && o.pros.length ? renderBullets(o.pros) : '<ul class="bullets"><li>—</li></ul>'}
      </div>
      <div style="flex:1;">
        <div class="mono" style="font-size:8.5px;letter-spacing:0.12em;text-transform:uppercase;color:var(--dim);">Trade-offs</div>
        ${o.cons && o.cons.length ? renderBullets(o.cons) : '<ul class="bullets"><li>—</li></ul>'}
      </div>
    </div>
  </section>`
}

/** Per-trade default "Please Note" disclaimers — every aircon result is indicative. */
const AIRCON_PLEASE_NOTE = [
  'These figures are indicative only — sizing and pricing are derived from property data and your inputs, not a fixed quote.',
  'Final system, exact capacity and price are confirmed on site before any work is booked.',
  'Prices shown include 10% GST and cover indicative supply and installation; electrical, switchboard or building works are quoted separately if required.',
  'Indicative ranges assume standard access and mounting; roof-space, height or access constraints may change the final price.',
  'An installer reviews every recommendation and completes an on-site assessment before any work proceeds.',
]

export function buildAirconReportHtml(input: AirconReportInput): string {
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const branding = input.branding ?? brandingFromName(input.businessName)
  const r = input.recommendation
  const s = r.sizing
  const zone = input.climateZone ? `${esc(input.climateZone)} climate · ` : ''

  let body = ''

  // ── Sizing — the volumetric load basis as a stat grid ──
  body += `<h2>Sizing</h2>
  <div class="statgrid">
    <div class="stat">
      <div class="v">${Math.round(num(s.total_floor_area_m2))}<small> m²</small></div>
      <div class="l">Floor area</div>
    </div>
    <div class="stat">
      <div class="v">${num(s.conditioned_zones)}</div>
      <div class="l">Conditioned zones</div>
    </div>
    <div class="stat">
      <div class="v">${num(s.connected_kw).toFixed(1)}<small> kW (${num(s.connected_kw_low).toFixed(
        1,
      )}–${num(s.connected_kw_high).toFixed(1)})</small></div>
      <div class="l">Connected load</div>
    </div>
    <div class="stat">
      <div class="v">${num(s.ducted_kw).toFixed(1)}<small> kW</small></div>
      <div class="l">Central unit (ducted)</div>
    </div>
  </div>`

  // ── Options (inc GST, indicative) — always two, ordered [ducted, split] ──
  body += `<h2>Your options (inc GST, indicative)</h2>`
  body += r.options.map(optionBlock).join('')

  // ── Next step — always an on-site assessment ──
  body += `<h2>Next step</h2>
  <div class="scope">${esc(
    r.routing.reason ??
      'These figures are indicative — an on-site assessment confirms the system, exact capacity and final price.',
  )}</div>`

  return renderReportDocument(branding, {
    docTitle: `Air-conditioning recommendation — ${branding.businessName}`,
    eyebrow: 'Air-conditioning recommendation · Indicative',
    dateLabel: `${zone}${esc(s.confidence)} confidence · ${date}`,
    siteAddress: input.address,
    introHtml: `Thank you for the opportunity to recommend air-conditioning for <strong>${esc(
      input.address,
    )}</strong>. Below is the indicative sizing and two system options (ducted and split) — an on-site assessment confirms everything before any work is booked.`,
    bodyHtml: body,
    pleaseNote: AIRCON_PLEASE_NOTE,
    closingLine: null,
  })
}
