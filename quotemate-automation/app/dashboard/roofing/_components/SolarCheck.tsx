'use client'

// Roofing — existing-solar detection panel.
//
// Scans the property's satellite aerial (Gemini vision via
// /api/roofing/detect-solar) for existing rooftop PV. On a full re-roof
// the panels must be detached + reinstated by a licensed electrician, so
// when detected we show the detach & reinstate allowance and the combined
// re-roof total INCLUDING it. Low-confidence detections are flagged but
// don't change the price. Mirrors the PhotoVerify panel's shape.

import { useCallback, useState } from 'react'
import type { RoofJobIntent } from '@/lib/roofing/types'
import type { SolarAllowance, SolarDetection } from '@/lib/roofing/solar'

type DetectResponse =
  | { ok: true; detection: SolarDetection; allowance: SolarAllowance | null }
  | { ok: false; code?: string; detail?: string; error?: string }

type Props = {
  accessToken: string | null
  address: string
  intent: RoofJobIntent
  /** Current combined re-roof (Better) inc-GST total, pre-solar. */
  betterIncGst: number
  /** Current combined upgrade (Best) inc-GST total, pre-solar. */
  bestIncGst: number
}

export function SolarCheck({ accessToken, address, intent, betterIncGst, bestIncGst }: Props) {
  const [stage, setStage] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle')
  const [detection, setDetection] = useState<SolarDetection | null>(null)
  const [allowance, setAllowance] = useState<SolarAllowance | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const scan = useCallback(async () => {
    if (!accessToken) {
      setErrMsg('Sign in to scan for solar.')
      setStage('error')
      return
    }
    if (!address.trim()) {
      setErrMsg('Measure a property first.')
      setStage('error')
      return
    }
    setStage('scanning')
    setErrMsg(null)
    setDetection(null)
    setAllowance(null)
    try {
      const res = await fetch('/api/roofing/detect-solar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, intent }),
      })
      const json = (await res.json()) as DetectResponse
      if (json.ok) {
        setDetection(json.detection)
        setAllowance(json.allowance)
        setStage('done')
      } else {
        setErrMsg(json.detail ?? json.code ?? json.error ?? 'Solar scan failed.')
        setStage('error')
      }
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e))
      setStage('error')
    }
  }, [accessToken, address, intent])

  const applies = allowance?.applies === true
  const betterWithSolar = applies ? betterIncGst + (allowance?.inc_gst ?? 0) : betterIncGst
  const bestWithSolar = applies ? bestIncGst + (allowance?.inc_gst ?? 0) : bestIncGst

  return (
    <div className="border border-ink-line bg-ink-card p-7 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
            Existing solar
          </div>
          <h3 className="mt-2 font-extrabold uppercase tracking-[-0.02em] text-xl text-text-pri sm:text-2xl">
            Scan the roof for solar panels
          </h3>
        </div>
        <button
          type="button"
          onClick={scan}
          disabled={stage === 'scanning' || !accessToken}
          className="inline-flex items-center gap-2 bg-accent px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
        >
          {stage === 'scanning' ? (<><Spinner /> Scanning…</>) : stage === 'done' ? 'Re-scan' : 'Scan for solar'}
        </button>
      </div>
      <p className="mt-3 text-base leading-relaxed text-text-sec">
        AI checks the satellite aerial for existing PV. On a full re-roof the panels must be
        detached and reinstated by a licensed electrician — we add that allowance to the re-roof
        total.
      </p>

      {stage === 'error' && errMsg && (
        <p className="mt-5 text-sm text-warning">{errMsg}</p>
      )}

      {stage === 'done' && detection && (
        <div className="mt-6 space-y-5">
          {/* Confidence-aware human-readable line — what the AI saw. */}
          <div className={`flex items-baseline gap-3 ${detection.has_solar || detection.has_skylight ? '' : 'text-teal-glow'}`}>
            <span className={`font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] ${detection.has_solar || detection.has_skylight ? 'text-accent' : 'text-teal-glow'}`}>
              {detection.has_solar || detection.has_skylight ? '◳ ' : '✓ '}{detection.summary_note}
            </span>
          </div>

          {detection.has_solar && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Arrays" value={String(detection.array_count)} />
                <Stat label="Panels (est.)" value={detection.panel_count_estimate != null ? `~${detection.panel_count_estimate}` : '—'} />
                <Stat label="Panel area" value={detection.approx_area_m2 != null ? `~${Math.round(detection.approx_area_m2)} m²` : '—'} hint={`${detection.confidence} confidence`} />
              </div>

              {allowance && (
                <div className={`border border-ink-line border-l-4 ${applies ? 'border-l-accent' : 'border-l-warning'} bg-ink-deep p-5`}>
                  <div className={`font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] ${applies ? 'text-accent' : 'text-warning'}`}>
                    {applies ? 'Solar detach & reinstate' : 'Solar flagged — confirm on site'}
                  </div>
                  {applies ? (
                    <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-accent">
                      + ${formatMoney(allowance.inc_gst)} <span className="text-sm font-semibold text-text-dim">inc GST</span>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-text-sec">
                      {allowance.low_confidence
                        ? 'Detection confidence is low — verify on site before adding the cost.'
                        : 'Detach/reinstate only applies to a full re-roof. Switch the job intent to include it.'}
                    </p>
                  )}
                  <p className="mt-2 text-sm text-text-sec">{allowance.detail} · {allowance.electrician_note}</p>
                </div>
              )}

              {applies && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <TotalCard label="Re-roof incl. solar" value={betterWithSolar} sub={`was $${formatMoney(betterIncGst)}`} />
                  <TotalCard label="Upgrade incl. solar" value={bestWithSolar} sub={`was $${formatMoney(bestIncGst)}`} />
                </div>
              )}
            </>
          )}

          {/* Skylights — SURFACED ONLY. Never auto-priced; the tradie adds a
              re-flash line manually if needed. */}
          {detection.has_skylight && (
            <div className="border border-ink-line border-l-4 border-l-warning bg-ink-deep p-5">
              <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-warning">
                {detection.skylight_count} skylight{detection.skylight_count === 1 ? '' : 's'} flagged
              </div>
              <p className="mt-1 text-sm text-text-sec">
                Not priced automatically — add a re-flash / reinstate line for the skylight{detection.skylight_count === 1 ? '' : 's'} if the re-roof disturbs {detection.skylight_count === 1 ? 'it' : 'them'}.
              </p>
            </div>
          )}

          {detection.notes && (
            <p className="text-xs text-text-dim">{detection.notes}</p>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-ink-line bg-ink-deep p-4">
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{label}</div>
      <div className="mt-2 font-mono text-xl font-bold tabular-nums text-text-pri">{value}</div>
      {hint && <div className="mt-1 text-xs text-text-dim">{hint}</div>}
    </div>
  )
}

function TotalCard({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="border border-ink-line bg-ink-deep p-5">
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{label}</div>
      <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-accent">${formatMoney(value)}</div>
      <div className="mt-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">{sub} inc GST</div>
    </div>
  )
}

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-white/40 border-t-white" aria-hidden="true" />
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
