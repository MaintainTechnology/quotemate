'use client'

// Painting — exterior wall-material detection panel.
//
// Scans the Street View frontage (Gemini vision via
// /api/painting/detect-material) for the wall substrate — render /
// weatherboard / brick / fibro / metal — the single biggest exterior-paint
// cost driver, which the satellite view can't see. Surfaces a cost note,
// a storey cross-check, and (for pre-1990 fibro) an asbestos inspection
// flag. Mirrors the roofing SolarCheck panel.

import { useCallback, useState } from 'react'
import type { MaterialDetection, MaterialGuidance } from '@/lib/painting/material'

type DetectResponse =
  | { ok: true; detection: MaterialDetection; guidance: MaterialGuidance }
  | { ok: false; code?: string; detail?: string; error?: string }

type Props = {
  token: string | null
  address: string
  postcode: string
  state: string
  yearBuilt?: number | null
}

export function MaterialCheck({ token, address, postcode, state, yearBuilt }: Props) {
  const [stage, setStage] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle')
  const [detection, setDetection] = useState<MaterialDetection | null>(null)
  const [guidance, setGuidance] = useState<MaterialGuidance | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const scan = useCallback(async () => {
    if (!token) {
      setErrMsg('Sign in to scan the frontage.')
      setStage('error')
      return
    }
    setStage('scanning')
    setErrMsg(null)
    setDetection(null)
    setGuidance(null)
    try {
      const res = await fetch('/api/painting/detect-material', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, postcode, state, year_built: yearBuilt ?? null }),
      })
      const json = (await res.json()) as DetectResponse
      if (json.ok) {
        setDetection(json.detection)
        setGuidance(json.guidance)
        setStage('done')
      } else {
        setErrMsg(json.detail ?? (json.code === 'no_streetview' ? 'No Street View imagery for this address.' : json.code) ?? json.error ?? 'Material scan failed.')
        setStage('error')
      }
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e))
      setStage('error')
    }
  }, [token, address, postcode, state, yearBuilt])

  return (
    <section className="relative z-10 mx-auto mt-6 max-w-6xl px-6 pb-4 sm:px-10">
      <div className="border border-ink-line bg-ink-card p-6 sm:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">Exterior wall material</div>
            <h3 className="mt-2 font-extrabold uppercase tracking-[-0.02em] text-xl text-text-pri">What are the walls made of?</h3>
          </div>
          <button
            type="button"
            onClick={scan}
            disabled={stage === 'scanning' || !token}
            className="inline-flex items-center gap-2 bg-accent px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
          >
            {stage === 'scanning' ? (<><Spinner /> Scanning…</>) : stage === 'done' ? 'Re-scan' : 'Scan frontage'}
          </button>
        </div>
        <p className="mt-3 text-base leading-relaxed text-text-sec">
          AI reads the Street View frontage for the wall substrate — render, weatherboard, brick,
          fibro or metal — the biggest driver of exterior-paint labour, which the satellite view
          can&rsquo;t show.
        </p>

        {stage === 'error' && errMsg && <p className="mt-5 text-sm text-warning">{errMsg}</p>}

        {stage === 'done' && detection && guidance && (
          <div className="mt-6 space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Wall material" value={guidance.label} hint={`${detection.confidence} confidence`} />
              <Stat label="Storeys (street)" value={detection.storeys != null ? String(detection.storeys) : '—'} hint="cross-check the estimate" />
              <Stat label="Condition" value={cap(detection.condition_hint)} />
            </div>

            <div className={`border border-ink-line border-l-4 ${guidance.inspection ? 'border-l-warning' : 'border-l-accent'} bg-ink-deep p-5`}>
              <div className={`font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] ${guidance.inspection ? 'text-warning' : 'text-accent'}`}>
                {guidance.inspection ? 'Inspection required' : 'Cost implication'}
              </div>
              <p className="mt-2 text-sm text-text-sec">{guidance.inspection ? guidance.inspection_reason : guidance.cost_note}</p>
              {!guidance.inspection && guidance.suggested_condition && (
                <p className="mt-2 text-xs text-text-dim">Suggested surface condition: <span className="text-text-pri">{guidance.suggested_condition}</span> · relative labour ×{guidance.labour_factor}</p>
              )}
            </div>

            {detection.notes && <p className="text-xs text-text-dim">{detection.notes}</p>}
          </div>
        )}
      </div>
    </section>
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

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-white/40 border-t-white" aria-hidden="true" />
}

function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s
}
