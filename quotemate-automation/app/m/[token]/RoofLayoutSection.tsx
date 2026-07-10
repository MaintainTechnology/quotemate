'use client'

// /m/[token] — AI roof layout map (spec specs/quote-visual-parity.md R6e).
//
// Tradie-initiated: the button POSTs /api/roofing/q/[token]/layout-plan
// (CAS-guarded, cached on the row) and the section then renders the
// colour-coded work-zone overlay OVER the same static-map aerial, plus the
// legend and the DETERMINISTIC material quantities (lib/roofing/layout-plan
// layoutMaterials — never LLM numbers). Customer surfaces only ever read the
// cached plan; generation lives here.

import { useState } from 'react'
import {
  layoutMaterials,
  ZONE_COLOR_HEX,
  type LayoutMaterialMetrics,
  type LayoutPlan,
} from '@/lib/roofing/layout-plan'
import type {
  LayoutMapView,
  LayoutOverlayStructure,
} from '@/lib/roofing/layout-overlay-svg'
import { RoofLayoutMapFigure } from '@/app/q/_chrome/RoofLayoutMapFigure'

type Props = {
  publicToken: string
  structures: LayoutOverlayStructure[]
  /** Fit-to-geometry view (layoutMapView) — MUST match the ?fit=1 static map
   *  so the overlay stays aligned with the imagery. */
  view: LayoutMapView | null
  materialsMetrics: LayoutMaterialMetrics
  initialStatus: string | null
  initialPlan: LayoutPlan | null
}

export function RoofLayoutSection({
  publicToken,
  structures,
  view,
  materialsMetrics,
  initialStatus,
  initialPlan,
}: Props) {
  const [plan, setPlan] = useState<LayoutPlan | null>(
    initialStatus === 'ready' ? initialPlan : null,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // No polygon geometry → no overlay to draw; hide the whole section.
  if (!view) return null

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/roofing/q/${encodeURIComponent(publicToken)}/layout-plan`, {
        method: 'POST',
      })
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; plan?: LayoutPlan; error?: string | null; status?: string }
        | null
      if (json?.ok && json.plan) {
        setPlan(json.plan)
      } else if (res.status === 409) {
        setError('A layout map is already being generated — try again shortly.')
      } else {
        setError(json?.error ?? `Layout generation failed (HTTP ${res.status})`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const materials = plan ? layoutMaterials(materialsMetrics, plan.mode) : null

  return (
    <section className="mt-8">
      <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
        Roof layout map
      </div>

      {!plan ? (
        <div className="mt-3 border border-ink-line bg-ink-card p-6">
          <p className="max-w-2xl text-sm leading-relaxed text-text-sec">
            Generate an AI work-strategy map: colour-coded zones over the aerial showing how
            the job is approached — re-sheeting, safety, ridgeline works. The customer quote
            page and PDF pick it up automatically once generated.
          </p>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="mt-4 inline-flex items-center gap-2 bg-accent px-4 py-2.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white hover:bg-accent-press disabled:opacity-60"
          >
            {busy ? 'Analysing the roof…' : 'Generate layout map'}
          </button>
          {error ? (
            <p className="mt-3 font-mono text-xs text-warning">{error}</p>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 border border-ink-line bg-ink-card">
          <p className="border-b border-ink-line px-5 py-3 text-sm text-text-sec">{plan.header}</p>

          {/* Aerial + zone overlay with true zoom controls — the image and
              the overlay share one centre/zoom so borders stay aligned. */}
          <RoofLayoutMapFigure
            publicToken={publicToken}
            zones={plan.zones}
            structures={structures}
            view={view}
          />

          {/* Legend — numbered to match the ZONE tags on the map callouts. */}
          <ul className="grid gap-2 border-t border-ink-line px-5 py-4 sm:grid-cols-2">
            {plan.zones.map((z, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  className="mt-0.5 font-mono text-[0.65rem] font-bold tracking-[0.12em]"
                  style={{ color: ZONE_COLOR_HEX[z.color] }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span
                  aria-hidden
                  className="mt-1 inline-block h-3.5 w-3.5 shrink-0 border border-ink-line"
                  style={{ background: ZONE_COLOR_HEX[z.color] }}
                />
                <span className="text-sm leading-snug text-text-sec">{z.label}</span>
              </li>
            ))}
          </ul>

          {/* Deterministic material quantities — tradie-only. Each item shows
              its arithmetic (basis) and where it goes (use) for transparency. */}
          {materials && materials.items.length > 0 ? (
            <div className="border-t border-ink-line px-5 py-4">
              <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                Estimated materials
              </div>
              <ul className="mt-3">
                {materials.items.map((m) => (
                  <li key={m.item} className="border-b border-ink-line/60 py-2.5 last:border-0">
                    <div className="flex items-baseline justify-between gap-4 font-mono text-sm tabular-nums">
                      <span className="text-text-pri">{m.item}</span>
                      <span className="whitespace-nowrap font-semibold text-text-pri">
                        {m.qty.toLocaleString('en-AU')} {m.unit}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-text-dim">
                      <span className="text-text-sec">How:</span> {m.basis}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-text-dim">
                      <span className="text-text-sec">Where:</span> {m.use}
                    </p>
                  </li>
                ))}
              </ul>
              {materials.note ? (
                <p className="mt-3 text-xs leading-relaxed text-text-dim">{materials.note}</p>
              ) : null}
              <p className="mt-3 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-text-dim">
                Quantities derived from the measured geometry — never AI-estimated numbers.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
