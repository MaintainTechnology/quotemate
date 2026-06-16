// Self-contained HTML for the indicative air-conditioning recommendation
// PDF, rendered by Gotenberg (lib/pdf/gotenberg.ts). Same print-friendly
// light theme as the roofing / painting / trade-quote reports. Pure — no
// I/O, unit-tested.
//
// Aircon is a RECOMMENDER, not a committable quote: it returns two options
// (ducted vs split) each with an indicative inc-GST price RANGE, plus the
// volumetric sizing. Every aircon result routes to "book an assessment",
// so the document is framed as indicative throughout — never a final price.

import type { AcRecommendation, AcOption, AcSystemType } from './types'

export type AirconReportInput = {
  businessName: string
  address: string
  recommendation: AcRecommendation
  climateZone?: string | null
  generatedAt?: Date
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const aud0 = (n: number) => '$' + Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-AU')

/** Finite-or-zero — guards .toFixed / arithmetic against a malformed payload. */
const num = (v: number) => (Number.isFinite(v) ? v : 0)

const SYSTEM_LABELS: Record<AcSystemType, string> = {
  ducted: 'Ducted (whole-home)',
  split: 'Split system',
}

function optionBlock(o: AcOption): string {
  const pros = (o.pros ?? []).map((p) => `<li>${esc(p)}</li>`).join('')
  const cons = (o.cons ?? []).map((c) => `<li>${esc(c)}</li>`).join('')
  return `
  <div class="opt ${o.best_fit ? 'opt-best' : ''}">
    <div class="opt-head">
      <span class="opt-title">${esc(SYSTEM_LABELS[o.system_type] ?? o.system_type)}${o.best_fit ? ' <span class="badge">Best fit</span>' : ''}</span>
      <span class="opt-cap">${num(o.capacity_kw).toFixed(1)} kW</span>
    </div>
    <div class="opt-price">${aud0(o.price.low)} – ${aud0(o.price.high)} <small>inc GST (indicative)</small></div>
    <div class="opt-cols">
      <div>
        <div class="opt-l">Why it fits</div>
        <ul>${pros || '<li>—</li>'}</ul>
      </div>
      <div>
        <div class="opt-l">Trade-offs</div>
        <ul>${cons || '<li>—</li>'}</ul>
      </div>
    </div>
  </div>`
}

export function buildAirconReportHtml(input: AirconReportInput): string {
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const r = input.recommendation
  const s = r.sizing
  const zone = input.climateZone ? `${esc(input.climateZone)} climate · ` : ''

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>Air-conditioning recommendation — ${esc(input.businessName)}</title>
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
  .stat .l { font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.15em; text-transform: uppercase; color: #6b7683; margin-top: 4px; }
  .opt { border: 1px solid #dde3e9; padding: 12px 14px; margin-top: 10px; }
  .opt-best { border: 2px solid #FF5F00; }
  .opt-head { display: flex; justify-content: space-between; align-items: baseline; }
  .opt-title { font-size: 14px; font-weight: 800; text-transform: uppercase; }
  .badge { font-family: 'Courier New', monospace; font-size: 8px; letter-spacing: 0.12em; color: #fff; background: #FF5F00; padding: 1px 6px; vertical-align: middle; }
  .opt-cap { font-family: 'Courier New', monospace; font-size: 11px; color: #6b7683; }
  .opt-price { font-size: 18px; font-weight: 800; margin: 6px 0 8px; }
  .opt-price small { font-size: 10px; font-weight: 400; color: #6b7683; }
  .opt-cols { display: flex; gap: 18px; }
  .opt-cols > div { flex: 1; }
  .opt-l { font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.12em; text-transform: uppercase; color: #6b7683; margin-bottom: 2px; }
  ul { margin: 2px 0; padding-left: 16px; }
  li { margin: 1px 0; }
  .scope { border-left: 3px solid #FF5F00; padding: 8px 12px; background: #f7f8fa; margin-top: 6px; }
  .note { color: #6b7683; font-size: 11px; }
  footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #dde3e9; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.15em; text-transform: uppercase; color: #6b7683; }
</style>
</head>
<body>
  <header>
    <div class="eyebrow">Air-conditioning recommendation · Indicative</div>
    <h1>${esc(input.businessName)} <span class="accent">×</span> QuoteMate</h1>
    <div class="meta">${esc(input.address)} · ${zone}${esc(s.confidence)} confidence · ${date}</div>
  </header>

  <h2>Sizing</h2>
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
      <div class="v">${num(s.connected_kw).toFixed(1)}<small> kW (${num(s.connected_kw_low).toFixed(1)}–${num(s.connected_kw_high).toFixed(1)})</small></div>
      <div class="l">Connected load</div>
    </div>
    <div class="stat">
      <div class="v">${num(s.ducted_kw).toFixed(1)}<small> kW</small></div>
      <div class="l">Central unit (ducted)</div>
    </div>
  </div>

  <h2>Your options (inc GST, indicative)</h2>
  ${r.options.map(optionBlock).join('')}

  <h2>Next step</h2>
  <div class="scope">${esc(r.routing.reason ?? 'These figures are indicative — an on-site assessment confirms the system, exact capacity and final price.')}</div>

  <p class="note">Indicative sizing and pricing from property data and your inputs — an installer confirms everything on site before any work is booked. Not a fixed quote.</p>

  <footer>Generated by QuoteMate · Prices include 10% GST · Indicative only — confirmed after a site assessment</footer>
</body>
</html>`
}
