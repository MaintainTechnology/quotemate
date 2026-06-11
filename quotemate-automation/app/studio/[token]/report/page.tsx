'use client'

// /studio/[token]/report — the franchisee-facing compliance report.
//
// Renders the grouped pre-check result (✓ compliant / ✕ fix / ◑ needs HQ
// review). If the assessment is still scoring, polls until it lands.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  ComplianceBar,
  delay,
  Notice,
  railFor,
  REVEAL,
  StateGlyph,
  Tally,
  TopoBackdrop,
} from '@/app/dashboard/signage/_components/ui'

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
  const [state, setState] = useState<'loading' | 'scoring' | 'ready' | 'invalid' | 'stalled'>('loading')
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
      // Past that, say so instead of polling silently forever.
      if (!done) {
        if (tries.current < 60) timer = setTimeout(tick, 4000)
        else setState('stalled')
      }
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [poll])

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      <TopoBackdrop />

      <section className="relative z-10 mx-auto max-w-2xl px-6 pt-12 pb-16 sm:px-8 sm:pt-14">
        <div className={`font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent ${REVEAL}`}>
          {brand?.name ?? 'Brand'} compliance check
        </div>
        <h1
          className={`mt-3 font-extrabold uppercase leading-[0.95] tracking-[-0.03em] text-[clamp(2rem,7vw,3rem)] ${REVEAL}`}
          style={delay(60)}
        >
          {studioName || 'Your report'}
        </h1>

        {state === 'loading' && (
          <p className={`mt-8 text-text-sec ${REVEAL}`} style={delay(120)}>
            <span className="mr-2 inline-block h-2.5 w-2.5 bg-accent motion-safe:animate-[pulse-soft_1.6s_ease-in-out_infinite]" aria-hidden="true" />
            Loading your report…
          </p>
        )}
        {state === 'invalid' && (
          <div className={`mt-8 ${REVEAL}`}>
            <Notice tone="warn">This link is invalid or has expired.</Notice>
          </div>
        )}
        {state === 'stalled' && (
          <div className={`mt-8 ${REVEAL}`}>
            <Notice tone="warn">
              <span className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-warning-bright">
                Still scoring
              </span>
              <p className="mt-2">
                This is taking longer than usual. Your photos are safe — refresh this page in a few
                minutes to check again, or contact {brand?.name ?? 'HQ'} if it doesn&rsquo;t resolve.
              </p>
            </Notice>
          </div>
        )}
        {state === 'scoring' && (
          <div className={`mt-8 ${REVEAL}`} aria-live="polite">
            <Notice tone="accent">
              <span className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-accent">
                <span className="mr-2 inline-block h-2.5 w-2.5 bg-accent motion-safe:animate-[pulse-soft_1.6s_ease-in-out_infinite]" aria-hidden="true" />
                Scoring in progress
              </span>
              <p className="mt-2">
                Checking your photos against the {brand?.name ?? 'brand'} standards — this page will update
                automatically. A large rule set can take a few minutes.
              </p>
            </Notice>
          </div>
        )}

        {state === 'ready' && report && report.groups.length === 0 && (
          <div className={`mt-8 ${REVEAL}`}>
            <Notice tone="accent">
              <p>
                Your photos were received, but {brand?.name ?? 'this brand'} doesn&rsquo;t have any automated
                checks set up yet — so there was nothing to score here. {brand?.name ?? 'HQ'} will review
                your photos manually.
              </p>
              <p className="mt-5 border-t border-ink-line pt-5 text-xs leading-relaxed text-text-dim">{report.disclaimer}</p>
            </Notice>
          </div>
        )}

        {state === 'ready' && report && report.groups.length > 0 && (
          <>
            {/* Overall verdict */}
            <VerdictBanner counts={report.counts} summary={report.summary} />

            {/* Tallies + health bar */}
            <div className={`mt-5 grid grid-cols-3 gap-3 ${REVEAL}`} style={delay(180)}>
              <Tally label="Compliant" value={report.counts.compliant} tone="good" />
              <Tally label="To fix" value={report.counts.fix} tone="warn" />
              <Tally label="Needs HQ review" value={report.counts.review} tone="accent" />
            </div>
            <div className={`mt-4 border border-ink-line bg-ink-card p-4 ${REVEAL}`} style={delay(240)}>
              <ComplianceBar pass={report.counts.compliant} fix={report.counts.fix} review={report.counts.review} />
            </div>

            {/* Grouped results — fixes first within each group */}
            <div className="mt-9 grid gap-7">
              {report.groups.map((g, gi) => (
                <div key={g.group} className={REVEAL} style={delay(280 + Math.min(gi, 6) * 60)}>
                  <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{g.group}</div>
                  <div className="mt-2 grid gap-2">
                    {[...g.items]
                      .sort((a, b) => rank(a.state) - rank(b.state))
                      .map((it) => (
                        <div key={it.rule_key} className={`border border-ink-line bg-ink-card px-4 py-3 ${railFor(it.state)}`}>
                          <div className="flex items-start gap-3">
                            <StateGlyph state={it.state} />
                            <div className="min-w-0">
                              <p className="text-sm leading-relaxed text-text-pri">{it.detail}</p>
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

            <p className="mt-9 border-t border-ink-line pt-5 text-xs leading-relaxed text-text-dim">{report.disclaimer}</p>
          </>
        )}
      </section>
    </main>
  )
}

/** The headline verdict, derived from the counts: fixes outrank reviews,
 *  reviews outrank a clean sheet. */
function VerdictBanner({ counts, summary }: { counts: Report['counts']; summary: string }) {
  const v =
    counts.fix > 0
      ? { label: 'Action needed', rail: 'border-l-warning-bright', text: 'text-warning-bright' }
      : counts.review > 0
        ? { label: 'Pending HQ review', rail: 'border-l-accent', text: 'text-accent' }
        : { label: 'All clear', rail: 'border-l-teal-glow', text: 'text-teal-glow' }
  return (
    <div className={`mt-7 border border-ink-line border-l-4 ${v.rail} bg-ink-card p-6 ${REVEAL}`} style={delay(120)}>
      <div className={`font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] ${v.text}`}>{v.label}</div>
      {summary && <p className="mt-2.5 text-sm leading-relaxed text-text-sec">{summary}</p>}
    </div>
  )
}

function rank(s: ReportItem['state']): number {
  return s === 'fix' ? 0 : s === 'review' ? 1 : 2
}
