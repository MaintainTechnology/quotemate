// Presentational paint-estimate result view — the full breakdown the tradie
// sees after an estimate. Extracted from the dashboard so the SAME markup
// renders both inline on /dashboard/painting (client tree, with a Recalculate
// action passed as `headerAction`) and on the tradie-facing results page
// /p/[estimate_token] (server tree, read-only — no action). No 'use client'
// directive and no hooks: this is a shared component usable in either tree.

import type { PaintingEstimate, PaintingRoutingDecision } from '@/lib/painting/types'

export function PaintResultView({
  estimate,
  headerAction,
}: {
  estimate: PaintingEstimate
  /** Optional client-side action (e.g. a Recalculate button) rendered top-right. */
  headerAction?: React.ReactNode
}) {
  const { facts, measurement, price, warnings, provider } = estimate
  return (
    <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-4 sm:px-10">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">
          Estimate from {provider}
        </span>
        <ConfidenceBadge confidence={price.confidence} />
        {headerAction ? <div className="ml-auto">{headerAction}</div> : null}
      </div>

      <RoutingStrip routing={price.routing} />

      {/* Floor area + source */}
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        <Stat
          label="Floor area"
          value={`${measurement.floor_area_m2.toFixed(0)} m²`}
          hint={`${measurement.floor_area_low_m2.toFixed(0)}–${measurement.floor_area_high_m2.toFixed(0)} m² · ${sourceWords(measurement.floor_area_source)}`}
        />
        <Stat label="Storeys · ceiling" value={`${measurement.storeys} · ${measurement.ceiling_height_m} m`} hint={facts.property_type ?? ''} />
        <Stat
          label="Beds · baths"
          value={`${facts.bedrooms ?? '?'} · ${facts.bathrooms ?? '?'}`}
          hint={[facts.year_built ? `Built ${facts.year_built}` : '', facts.car_spaces != null ? `${facts.car_spaces} car` : ''].filter(Boolean).join(' · ')}
        />
      </div>

      {/* Property details — everything the data source told us */}
      <div className="mt-6 border border-ink-line bg-ink-card p-6 sm:p-7">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">Property details</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Building footprint" value={facts.footprint_m2 != null ? `${Math.round(facts.footprint_m2)} m²` : '—'} hint={facts.footprint_m2 != null ? 'roof outprint' : 'not provided'} />
          <Stat label="Land size" value={facts.land_size_m2 != null ? `${Math.round(facts.land_size_m2)} m²` : '—'} />
          <Stat label="Type · built" value={`${facts.property_type ?? '—'}${facts.year_built ? ` · ${facts.year_built}` : ''}`} hint={facts.has_floor_plan ? 'floor plan available' : ''} />
          {facts.eave_height_m != null && (
            <Stat label="Eave height" value={`${facts.eave_height_m.toFixed(1)} m`} hint="ground to eave" />
          )}
        </div>
        {facts.capture_note && <p className="mt-3 text-xs text-text-dim">{facts.capture_note}</p>}
      </div>

      {/* Paintable surfaces */}
      <div className="mt-6 border border-ink-line bg-ink-card p-6 sm:p-7">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">Paintable quantities</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {measurement.surfaces.map((s) => (
            <div key={s.scope} className="flex items-baseline justify-between border border-ink-line bg-ink-deep px-4 py-3">
              <span className="font-mono text-sm font-semibold uppercase tracking-[0.1em] text-text-sec">{s.scope}</span>
              <span className="font-mono text-base tabular-nums text-text-pri">
                {s.quantity.toFixed(0)} {s.unit === 'lm' ? 'lm' : 'm²'}
                <span className="ml-2 text-xs text-text-dim">{s.quantity_low.toFixed(0)}–{s.quantity_high.toFixed(0)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* G/B/B tiers */}
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        {price.tiers.map((t) => (
          <div key={t.tier} className="border border-ink-line bg-ink-card p-6">
            <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{t.tier} · {t.label}</div>
            <div className="mt-3 font-mono text-3xl font-bold tabular-nums text-accent">${money(t.inc_gst)}</div>
            <div className="mt-1 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim">
              range ${money(t.inc_gst_low)}–${money(t.inc_gst_high)} inc GST
            </div>
            <p className="mt-3 text-sm leading-relaxed text-text-sec">{t.scope}</p>
          </div>
        ))}
      </div>

      {price.manual_override && (
        <div className="mt-5 border border-ink-line border-l-4 border-l-accent bg-ink-card px-5 py-3 text-sm text-text-sec">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-accent">✎ Adjusted by you</span>{' '}
          — these prices were hand-edited, so they override the automatic derivation below.
        </div>
      )}

      {(price.loadings_applied.length > 0 || price.call_out_minimum_applied) && (
        <div className="mt-5 space-y-1.5 text-sm text-text-sec">
          {price.call_out_minimum_applied && <p>Call-out minimum applied — small job floored to the minimum charge.</p>}
          {price.loadings_applied.map((l) => (<p key={l.code}>+ {l.detail}</p>))}
        </div>
      )}

      {/* How the price was built — every contributor to the tiers */}
      {price.breakdown && (
        <div className="mt-6 border border-ink-line border-l-4 border-l-accent bg-ink-card p-6 sm:p-7">
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">How the price was built</div>
          <p className="mt-2 text-xs text-text-dim">Better = each surface × your rate × multipliers. Good and Best are derived from Better.</p>
          <div className="mt-4 space-y-2 font-mono text-sm">
            {price.breakdown.surfaces.map((s) => (
              <div key={s.scope} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-line pb-2">
                <span className="uppercase tracking-[0.1em] text-text-sec">{s.scope}</span>
                <span className="tabular-nums text-text-dim">{s.quantity.toFixed(0)} {s.unit === 'lm' ? 'lm' : 'm²'} × ${s.rate_per_unit} → <span className="text-text-pri">${money(s.line_ex_gst)}</span></span>
              </div>
            ))}
            <div className="flex items-baseline justify-between pt-1">
              <span className="text-text-sec">Coats · prep · colour</span>
              <span className="tabular-nums text-text-pri">× {price.breakdown.coats_multiplier} · {price.breakdown.prep_multiplier} · {price.breakdown.colour_change_multiplier}</span>
            </div>
            {price.breakdown.double_storey_multiplier !== 1 && (
              <div className="flex items-baseline justify-between">
                <span className="text-text-sec">Double-storey exterior</span>
                <span className="tabular-nums text-text-pri">× {price.breakdown.double_storey_multiplier}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-ink-line pt-2">
              <span className="font-semibold text-text-pri">Better subtotal (ex GST)</span>
              <span className="font-bold tabular-nums text-accent">${money(price.breakdown.better_ex_gst)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-text-sec">Good = Better ×</span>
              <span className="tabular-nums text-text-pri">{Math.round(price.breakdown.good_refresh_fraction * 100)}%</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-text-sec">Best = Better ×</span>
              <span className="tabular-nums text-text-pri">{Math.round((1 + price.breakdown.premium_uplift_pct) * 100)}%</span>
            </div>
            {price.breakdown.gst_factor > 1 && (
              <div className="flex items-baseline justify-between">
                <span className="text-text-sec">GST</span>
                <span className="tabular-nums text-text-pri">+ {Math.round((price.breakdown.gst_factor - 1) * 100)}%</span>
              </div>
            )}
            {price.breakdown.call_out_minimum_ex_gst > 0 && (
              <div className="flex items-baseline justify-between">
                <span className="text-text-sec">Call-out minimum (floor)</span>
                <span className="tabular-nums text-text-pri">${money(price.breakdown.call_out_minimum_ex_gst)}</span>
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-text-dim">Tune any of these rates in the Pricing tab of your dashboard.</p>
        </div>
      )}

      {/* Derivation notes + warnings */}
      <div className="mt-6 border border-ink-line border-l-4 border-l-accent bg-ink-card p-6 sm:p-7">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">How this was derived</div>
        <ul className="mt-3 space-y-2 text-sm text-text-sec">
          {measurement.notes.map((n, i) => (
            <li key={i} className="flex items-baseline gap-3"><span className="text-accent">·</span><span>{n}</span></li>
          ))}
          {warnings.map((w, i) => (
            <li key={`w${i}`} className="flex items-baseline gap-3"><span className="text-warning">!</span><span>{w}</span></li>
          ))}
        </ul>
      </div>
    </section>
  )
}

// ─── Private presentational helpers ─────────────────────────────────

function RoutingStrip({ routing }: { routing: PaintingRoutingDecision }) {
  const warn = routing.decision === 'inspection_required'
  return (
    <div className={`mt-6 border border-ink-line border-l-4 ${warn ? 'border-l-warning' : 'border-l-accent'} bg-ink-card px-6 py-5`}>
      <div className={`font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] ${warn ? 'text-warning' : 'text-accent'}`}>
        Routing · {routing.decision.replace(/_/g, ' ')}
      </div>
      <p className="mt-1 text-base text-text-sec">{routing.reason}</p>
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const colour = confidence === 'high' ? 'text-teal-glow' : confidence === 'medium' ? 'text-accent' : 'text-warning'
  return (
    <span className={`font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] ${colour}`}>{confidence} confidence</span>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-ink-line bg-ink-card p-5">
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{label}</div>
      <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-text-pri">{value}</div>
      {hint && <div className="mt-1 text-xs text-text-dim">{hint}</div>}
    </div>
  )
}

function sourceWords(s: PaintingEstimate['measurement']['floor_area_source']): string {
  switch (s) {
    case 'listing': return 'from listing'
    case 'footprint': return 'from footprint'
    case 'beds_estimate': return 'from bedroom count'
    case 'manual': return 'entered by hand'
    default: return 'estimated'
  }
}

function money(n: number): string {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
