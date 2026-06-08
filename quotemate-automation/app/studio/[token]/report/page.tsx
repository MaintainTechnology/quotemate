'use client'

// /studio/[token]/report — the franchisee-facing compliance report.
//
// Renders the grouped pre-check result (✓ compliant / ✕ fix / ◑ needs HQ
// review). If the assessment is still scoring, polls until it lands.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'

type ReportItem = { rule_key: string; rule_text: string; state: 'compliant' | 'fix' | 'review'; detail: string; source_citation: string | null; note: string | null; kb_citation: string | null }
type ReportGroup = { group: string; items: ReportItem[] }
type Report = {
  counts: { compliant: number; fix: number; review: number }
  groups: ReportGroup[]
  summary: string
  disclaimer: string
}

export default function StudioReportPage() {
  const { token } = useParams<{ token: string }>()
  const [studioName, setStudioName] = useState('')
  const [brand, setBrand] = useState<{ name: string } | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [state, setState] = useState<'loading' | 'scoring' | 'ready' | 'invalid'>('loading')
  const tries = useRef(0)

  const poll = useCallback(async () => {
    const res = await fetch(`/api/signage/request/${token}`)
    const json = await res.json()
    if (!json.ok) {
      setState('invalid')
      return true
    }
    if (json.mode === 'report') {
      setStudioName(json.studio_name)
      setBrand(json.brand ?? null)
      setReport(json.report)
      setState('ready')
      return true
    }
    setStudioName(json.studio_name ?? '')
    setBrand(json.brand ?? null)
    setState('scoring')
    return false
  }, [token])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    const tick = async () => {
      const done = await poll().catch(() => false)
      if (cancelled) return
      tries.current += 1
      // Up to ~4 min: a multi-shot brand with a large rule set runs many
      // chunked Step-1 + Step-2 vision calls (bounded by the vision limiter).
      if (!done && tries.current < 60) timer = setTimeout(tick, 4000)
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [poll])

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <section className="mx-auto max-w-2xl px-6 pt-14 pb-16 sm:px-8">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent">{brand?.name ?? 'Brand'} compliance check</div>
        <h1 className="mt-3 font-extrabold uppercase leading-[0.95] tracking-[-0.03em] text-[clamp(2rem,7vw,3rem)]">
          {studioName || 'Your report'}
        </h1>

        {state === 'loading' && <p className="mt-8 text-text-sec">Loading…</p>}
        {state === 'invalid' && <p className="mt-8 text-text-sec">This link is invalid or has expired.</p>}
        {state === 'scoring' && (
          <div className="mt-8 border border-ink-line border-l-4 border-l-accent bg-ink-card p-6">
            <p className="text-text-sec">
              <span className="inline-block h-3 w-3 animate-pulse bg-accent" aria-hidden="true" /> Checking your
              photos against the {brand?.name ?? 'brand'} standards… this page will update automatically.
            </p>
          </div>
        )}

        {state === 'ready' && report && report.groups.length === 0 && (
          <div className="mt-8 border border-ink-line border-l-4 border-l-accent bg-ink-card p-6">
            <p className="text-text-sec">
              Your photos were received, but {brand?.name ?? 'this brand'} doesn’t have any automated
              checks set up yet — so there was nothing to score here. {brand?.name ?? 'HQ'} will review
              your photos manually.
            </p>
            <p className="mt-5 border-t border-ink-line pt-5 text-xs leading-relaxed text-text-dim">{report.disclaimer}</p>
          </div>
        )}

        {state === 'ready' && report && report.groups.length > 0 && (
          <>
            <div className="mt-6 grid grid-cols-3 gap-3">
              <Tally label="Compliant" value={report.counts.compliant} tone="good" />
              <Tally label="To fix" value={report.counts.fix} tone="warn" />
              <Tally label="Needs HQ review" value={report.counts.review} tone="accent" />
            </div>

            <div className="mt-8 grid gap-6">
              {report.groups.map((g) => (
                <div key={g.group}>
                  <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{g.group}</div>
                  <div className="mt-2 grid gap-2">
                    {g.items.map((it) => (
                      <div key={it.rule_key} className="border border-ink-line bg-ink-card px-4 py-3">
                        <div className="flex items-start gap-3">
                          <StateIcon state={it.state} />
                          <div className="min-w-0">
                            <p className="text-sm text-text-pri">{it.detail}</p>
                            {it.note && (
                              <p className="mt-1.5 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-accent">
                                ◇ {it.note}
                                {it.kb_citation && <span className="text-text-dim"> · {it.kb_citation}</span>}
                              </p>
                            )}
                            {it.source_citation && (
                              <p className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-text-dim">{it.source_citation}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-8 border-t border-ink-line pt-5 text-xs leading-relaxed text-text-dim">{report.disclaimer}</p>
          </>
        )}
      </section>
    </main>
  )
}

function StateIcon({ state }: { state: ReportItem['state'] }) {
  if (state === 'compliant') return <span className="text-teal-glow" aria-label="compliant">✓</span>
  if (state === 'fix') return <span className="text-warning" aria-label="fix needed">✕</span>
  return <span className="text-accent" aria-label="needs HQ review">◑</span>
}

function Tally({ label, value, tone }: { label: string; value: number; tone: 'good' | 'warn' | 'accent' }) {
  const colour = tone === 'good' ? 'text-teal-glow' : tone === 'warn' ? 'text-warning' : 'text-accent'
  return (
    <div className="border border-ink-line bg-ink-card p-4 text-center">
      <div className={`font-mono text-3xl font-bold tabular-nums ${colour}`}>{value}</div>
      <div className="mt-1 font-mono text-[0.64rem] font-semibold uppercase tracking-[0.12em] text-text-dim">{label}</div>
    </div>
  )
}
