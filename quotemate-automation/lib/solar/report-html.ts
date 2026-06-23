// Self-contained HTML for the customer SOLAR quote PDF, rendered by
// Gotenberg (lib/pdf/gotenberg.ts). Brings solar to PDF parity with the
// electrical/plumbing quote report (lib/quote/report-html.ts) and the
// roofing report: same print-friendly light theme (mono eyebrows, orange
// accent, uppercase display headings, inline styles).
//
// Money convention: SolarPriceTier already carries inc-GST figures
// (net_inc_gst, gross_inc_gst) and the STC rebate, all computed by the
// deterministic engine — we render them verbatim (no re-rounding). Pure;
// unit-tested.

import type { SolarEstimate, SolarPriceTier } from './types'
import type { SolarPremiumQuote } from './premium-quote'
import type { SolarAiBriefRecord } from './ai-brief'
import { buildSolarHardwareCards } from './hardware-cards'
import {
  SOLAR_PROJECTION_COPY,
  SOLAR_LAYOUT_COPY,
  SOLAR_ENVIRONMENTAL_COPY,
} from './compliance-copy'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const aud0 = (n: number) =>
  '$' + Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-AU')

const kw = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('en-AU', { maximumFractionDigits: 1 })

export type SolarReportInput = {
  businessName: string
  address: string
  estimate: SolarEstimate
  quoteViewUrl?: string | null
  licenceLine?: string | null
  generatedAt?: Date
  /** Premium proposal artefacts (spec 2026-06-12 §4.4) — build with
   *  theme 'light' for print. Null/absent → the legacy report layout. */
  premium?: SolarPremiumQuote | null
  /** Absolute URL of the satellite hero — the layout/string overlays
   *  render over it. Absent → overlays draw on a dark panel instead. */
  staticMapUrl?: string | null
  /** Absolute URL of the cached roof irradiance heatmap (sun & shade
   *  build 2026-06-13). Absent → the figure is omitted from the PDF. */
  fluxImageUrl?: string | null
  /** Felt map snapshot for felt-variant quotes (spec 2026-06-13 §4.7-8).
   *  Gotenberg can't print an iframe, so the PDF carries the static
   *  thumbnail + the live-map link instead. Absent → omitted. */
  feltMap?: { thumbnailUrl: string | null; mapUrl: string | null } | null
  /** Grounded AI roof-intelligence brief (§4.6). Absent → omitted. */
  aiBrief?: SolarAiBriefRecord | null
}

/** Format a payback band as "4–6 yrs", or a graceful fallback. */
function paybackText(low: number | null, high: number | null): string {
  if (low == null || high == null) return 'See your tradie for payback detail'
  const l = Math.round(low)
  const h = Math.round(high)
  return l === h ? `${l} yr${l === 1 ? '' : 's'}` : `${l}–${h} yrs`
}

function tierSection(
  price: SolarPriceTier,
  panelsCount: number | null,
  econ: { annual_savings_aud: number; payback_years_low: number | null; payback_years_high: number | null } | null,
  recommended: boolean,
): string {
  const panels = panelsCount != null ? ` · ${panelsCount} panels` : ''
  return `
  <section class="tier ${recommended ? 'tier-selected' : ''}">
    <div class="tier-head">
      <span class="tier-name">${price.tier.toUpperCase()}${recommended ? ' · RECOMMENDED' : ''}</span>
      <span class="tier-price">${aud0(price.net_inc_gst)} <small>net inc GST</small></span>
    </div>
    <div class="tier-label">${kw(price.system_kw_dc)} kW${panels} — ${esc(price.label ?? '')}</div>
    ${price.scope ? `<div class="tier-scope">${esc(price.scope)}</div>` : ''}
    <table>
      <tbody>
        <tr><td>System price (inc GST)</td><td class="num">${aud0(price.gross_inc_gst)}</td></tr>
        <tr><td>Less STC rebate (${price.stc.certificates} certificates @ ${aud0(price.stc.stc_price_aud)})</td><td class="num">&minus;${aud0(price.stc.rebate_aud)}</td></tr>
        <tr class="net"><td>Your price after rebate (inc GST)</td><td class="num">${aud0(price.net_inc_gst)}</td></tr>
      </tbody>
    </table>
    ${
      econ
        ? `<div class="econ">Est. first-year savings <b>${aud0(econ.annual_savings_aud)}/yr</b> · Payback <b>${paybackText(econ.payback_years_low, econ.payback_years_high)}</b></div>`
        : ''
    }
  </section>`
}

/** Overlay figure: the deterministic SVG positioned over the satellite
 *  photo (or a dark panel when no URL is available). */
function overlayFigure(args: {
  svg: string
  staticMapUrl: string | null | undefined
  heading: string
  legendHtml: string
  captionText: string
}): string {
  const img = args.staticMapUrl
    ? `<img src="${esc(args.staticMapUrl)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">`
    : ''
  return `
  <h2>${esc(args.heading)}</h2>
  <div class="figure">
    <div class="overlay-frame">${img}<div class="overlay-svg">${args.svg}</div></div>
    ${args.legendHtml ? `<div class="legend">${args.legendHtml}</div>` : ''}
    <div class="fig-caption">${esc(args.captionText)}</div>
  </div>`
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

/** Premium sections (spec §4.4 order). The PDF only ever generates for
 *  confirmed, non-inspection estimates, so money sections are safe. */
function premiumSections(input: SolarReportInput): string {
  const p = input.premium
  if (!p) return ''
  const parts: string[] = []

  // 2. Proposed panel layout.
  if (p.layout) {
    const legend = p.layout.legend
      .map(
        (l) =>
          `<span class="legend-item"><span class="swatch" style="background:${l.color}"></span>` +
          `${esc(l.plane_label)} · ${l.panels_count} panels</span>`,
      )
      .join('')
    parts.push(
      overlayFigure({
        svg: p.layout.svg,
        staticMapUrl: input.staticMapUrl,
        heading: 'Proposed panel layout',
        legendHtml: legend,
        captionText: SOLAR_LAYOUT_COPY,
      }),
    )
  }

  // 3. Panel strings & component markings.
  if (p.strings) {
    const legend = p.strings.strings
      .map(
        (s) =>
          `<span class="legend-item"><span class="swatch" style="background:${s.color}"></span>` +
          `S${s.string_number} · ${s.panels_count} panels</span>`,
      )
      .join('')
    parts.push(
      overlayFigure({
        svg: p.strings.svg,
        staticMapUrl: input.staticMapUrl,
        heading: 'Panel strings & component markings',
        legendHtml: legend,
        captionText: p.strings.caption,
      }),
    )
  }

  // 3b. Sun & shade analysis (full-exploitation build 2026-06-13) —
  // heatmap figure + measured sun stats + per-plane sun scores. No
  // dollar figures; mirrors the quote page section.
  if (p.sun) {
    const sunParts: string[] = ['<h2>Sun &amp; shade analysis</h2>']
    // True only when the labels actually rendered onto the heatmap —
    // gates the plane-table dedup below (no figure ⇒ keep the table).
    let markersRendered = false
    if (p.sun.flux_image_available && input.fluxImageUrl) {
      // Sun-score labels pinned onto the heatmap (same deterministic
      // anchors the quote page uses) — best face highlighted.
      const markers = p.sun.markers
        .map((m) => {
          const bg = m.is_best ? '#FF5F00' : 'rgba(22,32,43,0.85)'
          const sub = m.is_best ? 'rgba(255,255,255,0.85)' : '#9aa6b2'
          return (
            `<div style="position:absolute;left:${m.x_pct}%;top:${m.y_pct}%;transform:translate(-50%,-50%);` +
            `background:${bg};color:#fff;border:1px solid ${m.is_best ? '#FF5F00' : '#3a4654'};` +
            `padding:3px 7px;text-align:center;white-space:nowrap;z-index:${m.is_best ? 2 : 1};">` +
            `<div style="font-family:'Courier New',monospace;font-size:7.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">` +
            `${m.is_best ? '★ BEST SPOT — ' : ''}${esc(m.orientation)} FACE</div>` +
            `<div style="font-family:'Courier New',monospace;font-size:7px;letter-spacing:0.08em;text-transform:uppercase;color:${sub};">` +
            `${esc(m.score_copy)} · ${m.area_m2.toLocaleString('en-AU')} m²</div></div>`
          )
        })
        .join('')
      const caption =
        (p.sun.markers.length > 0
          ? 'Labels mark each roof face at its measured sun score — the highlighted face is the best place for panels. '
          : '') + (p.sun.flux_caption ?? '')
      sunParts.push(
        `<div class="figure"><div style="position:relative;">` +
          `<img src="${esc(input.fluxImageUrl)}" alt="" style="width:100%;display:block;image-rendering:pixelated;">` +
          markers +
          '</div>' +
          (caption ? `<div class="fig-caption">${esc(caption)}</div>` : '') +
          '</div>',
      )
      markersRendered = p.sun.markers.length > 0
    }
    if (p.sun.stats.length > 0) {
      sunParts.push(statGrid(p.sun.stats))
    }
    // Plane rows only when the labels are NOT already pinned on the
    // heatmap above (mirrors the quote page's dedup).
    if (!markersRendered && p.sun.planes.length > 0) {
      const rows = p.sun.planes
        .map(
          (pl) =>
            `<tr><td>${esc(pl.orientation)} face · ${pl.area_m2.toLocaleString('en-AU')} m²</td>` +
            `<td class="num">${esc(pl.score_copy)} · ${pl.relative_pct}% of best face</td></tr>`,
        )
        .join('')
      sunParts.push(`<table><tbody>${rows}</tbody></table>`)
    }
    if (sunParts.length > 1) parts.push(sunParts.join('\n'))
  }

  // 4. System details — production chart + assumed values.
  if (p.charts.monthlyProduction) {
    parts.push(chartFigure('Monthly production', p.charts.monthlyProduction))
  }
  if (p.assumed_values.length > 0) {
    parts.push('<h2>Assumed values</h2>' + statGrid(p.assumed_values))
  }

  // 4b. Your hardware — Pylon datasheet supplement (build 2026-06-13).
  const hardware = buildSolarHardwareCards(input.estimate.context)
  if (hardware.length > 0) {
    const rows = hardware
      .map(
        (c) =>
          `<tr><td>${esc(c.kindLabel)}</td>` +
          `<td>${esc(c.name)}${c.detail ? `<div class="note">${esc(c.detail)}</div>` : ''}` +
          `${c.datasheetUrl ? ` <a href="${esc(c.datasheetUrl)}">Datasheet (PDF)</a>` : ''}</td></tr>`,
      )
      .join('')
    parts.push(`<h2>Your hardware</h2><table><tbody>${rows}</tbody></table>`)
  }

  // 5. Utility costs.
  if (p.charts.utilityCosts) {
    parts.push(chartFigure('Utility costs — before & with solar', p.charts.utilityCosts))
  }

  // 6. 20-year financial summary.
  if (p.financial) {
    const f = p.financial
    const payback =
      f.payback_years_low != null && f.payback_years_high != null
        ? `${Math.round(f.payback_years_low)}–${Math.round(f.payback_years_high)} yrs`
        : 'See installer'
    parts.push(
      '<h2>20-year financial summary</h2>' +
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
        `<p class="note">${esc(SOLAR_PROJECTION_COPY)}</p>`,
    )
  }

  // 7. Financial analysis charts.
  if (p.charts.cumulativeSavings) {
    parts.push(chartFigure('Cumulative savings (25-year projection)', p.charts.cumulativeSavings))
  }
  if (p.charts.monthlyBill) {
    parts.push(chartFigure('Monthly bill comparison', p.charts.monthlyBill))
  }

  // 8. Environmental analysis.
  if (p.environmental) {
    const env = p.environmental
    parts.push(
      '<h2>Environmental analysis</h2>' +
        statGrid([
          { label: 'CO₂e avoided / yr', value: `${env.tonnes_co2_per_year.toLocaleString('en-AU')} t` },
          { label: 'CO₂e over 20 yrs', value: `${env.tonnes_co2_20yr.toLocaleString('en-AU')} t` },
          { label: 'Like planting', value: `${env.trees_equiv_per_year.toLocaleString('en-AU')} trees/yr` },
          { label: 'Like not driving', value: `${env.km_driven_equiv_per_year.toLocaleString('en-AU')} km/yr` },
        ]) +
        `<p class="note">${esc(SOLAR_ENVIRONMENTAL_COPY)}</p>`,
    )
  }

  return parts.join('\n')
}

/** Felt-variant sections (spec 2026-06-13): map snapshot + AI brief.
 *  The iframe can't print, so the PDF shows the map thumbnail and the
 *  live-map URL; the brief renders as labelled, grounded prose. */
function feltSections(input: SolarReportInput): string {
  const parts: string[] = []

  if (input.feltMap?.thumbnailUrl) {
    parts.push(
      '<h2>Your roof — interactive map</h2>' +
        `<div class="figure"><img src="${esc(input.feltMap.thumbnailUrl)}" alt="" style="width:100%;display:block;">` +
        `<div class="fig-caption">Snapshot of your interactive roof map — panel layout, sun-exposure heat map and elevation.` +
        (input.feltMap.mapUrl
          ? ` Explore it live: ${esc(input.feltMap.mapUrl)}`
          : input.quoteViewUrl
            ? ` Explore it live on your quote page: ${esc(input.quoteViewUrl)}`
            : '') +
        '</div></div>',
    )
  }

  const b = input.aiBrief
  if (b) {
    const caveats =
      b.caveats.length > 0
        ? `<ul>${b.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
        : ''
    parts.push(
      '<h2>Roof intelligence — AI-generated summary</h2>' +
        `<div class="summary"><b>${esc(b.headline)}</b>` +
        `<p>${esc(b.layout_rationale)}</p>` +
        `<p><b>Best roof face.</b> ${esc(b.best_plane_note)}</p>` +
        `<p><b>Across the seasons.</b> ${esc(b.seasonal_note)}</p>` +
        caveats +
        `<p class="note">AI-generated summary — every figure comes from your roof analysis.</p></div>`,
    )
  }

  return parts.join('\n')
}

export function buildSolarQuoteReportHtml(input: SolarReportInput): string {
  const e = input.estimate
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  // Align the price tiers with their panel count (sizing) + economics by tier key.
  const panelsByTier = new Map(e.sizing.tiers.map((t) => [t.tier, t.panels_count]))
  const econByTier = new Map(e.economics.tiers.map((t) => [t.tier, t]))
  // Mirror persist-helpers: the 'better' tier is the recommended default.
  const recommendedTier = e.price.tiers.some((t) => t.tier === 'better') ? 'better' : e.price.tiers[0]?.tier

  const tiers = e.price.tiers
    .map((p) =>
      tierSection(
        p,
        panelsByTier.get(p.tier) ?? null,
        econByTier.get(p.tier) ?? null,
        p.tier === recommendedTier,
      ),
    )
    .join('')

  const a = e.economics.assumptions
  const bandLabel = e.confidence_band === 'tight' ? '±20% (good imagery)' : '±30% (indicative)'

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>Solar estimate — ${esc(input.businessName)}</title>
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
  .tier { border: 1px solid #dde3e9; margin-top: 14px; padding: 12px 14px; page-break-inside: avoid; }
  .tier-selected { border: 2px solid #FF5F00; }
  .tier-head { display: flex; justify-content: space-between; align-items: baseline; }
  .tier-name { font-family: 'Courier New', monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.15em; color: #FF5F00; }
  .tier-price { font-size: 20px; font-weight: 800; }
  .tier-price small { font-size: 10px; font-weight: 400; color: #6b7683; }
  .tier-label { margin-top: 2px; color: #3a4654; font-weight: 600; }
  .tier-scope { margin-top: 4px; color: #4a5562; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  td { border-bottom: 1px solid #e6ebf0; padding: 5px 6px; vertical-align: top; }
  tr.net td { border-bottom: none; border-top: 2px solid #16202b; font-weight: 800; }
  .num { text-align: right; white-space: nowrap; }
  .econ { margin-top: 8px; font-size: 11px; color: #3a4654; }
  .econ b { color: #16202b; }
  ul { margin: 6px 0 0; padding-left: 18px; }
  li { margin-bottom: 3px; }
  .note { color: #6b7683; font-size: 11px; }
  footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #dde3e9; font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.15em; text-transform: uppercase; color: #6b7683; }
  /* ── Premium proposal sections (spec 2026-06-12 §4.4) ─────────── */
  .figure { border: 1px solid #dde3e9; page-break-inside: avoid; }
  .overlay-frame { position: relative; width: 100%; aspect-ratio: 4 / 3; background: #16202b; overflow: hidden; }
  .overlay-svg { position: absolute; inset: 0; }
  .overlay-svg svg { width: 100%; height: 100%; }
  .chart { padding: 8px; }
  .chart svg { width: 100%; height: auto; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 6px 10px; border-top: 1px solid #dde3e9; }
  .legend-item { font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #3a4654; display: inline-flex; align-items: center; gap: 5px; }
  .swatch { display: inline-block; width: 8px; height: 8px; }
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
    <div class="eyebrow">Solar estimate · indicative</div>
    <h1>${esc(input.businessName)} <span class="accent">×</span> QuoteMax</h1>
    <div class="meta">${esc(input.address)} · ${date} · Confidence ${bandLabel}</div>
  </header>

  <h2>Your system</h2>
  <div class="summary">
    Estimate for a ${kw(e.price.tiers[e.price.tiers.length - 1]?.system_kw_dc ?? 0)} kW solar system,
    sized to your roof and capped to your network's export limit. Prices are net of the STC rebate
    and include GST.
  </div>

  ${feltSections(input)}

  ${premiumSections(input)}

  <h2>Your options</h2>
  ${tiers}

  <h2>Assumptions</h2>
  <ul>
    <li>Self-consumption ${Math.round((a.self_consumption_pct ?? 0) * 100)}% of generation used on-site.</li>
    <li>Retail rate ${aud0(a.retail_rate_aud_per_kwh)}/kWh · Feed-in tariff ${aud0(a.feed_in_tariff_aud_per_kwh)}/kWh (${esc(a.feed_in_network)}).</li>
    <li>STC rebate is point-of-sale and assigned to the installer; figures use a conservative certificate price.</li>
  </ul>

  <p class="note">Indicative estimate — final price is confirmed by ${esc(input.businessName)} after review.
  ${input.quoteViewUrl ? `Live version of this quote: ${esc(input.quoteViewUrl)}` : ''}</p>

  <footer>Generated by QuoteMax${
    input.licenceLine ? ` · ${esc(input.licenceLine)}` : ''
  } · Reply to your SMS or call to go ahead</footer>
</body>
</html>`
}
