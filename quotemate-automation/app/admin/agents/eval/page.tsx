'use client'

// /admin/agents/eval — Eval Agent scoreboard.
//
// Shows the run history table and a per-run drill-down (loaded on
// demand from /api/admin/agents/eval-runs/[id]). "Run now" triggers
// a fresh pass against the live estimator via the Railway proxy.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { relativeTime } from '@/lib/agents/findings'

type EvalRunRow = {
  id: string
  prompt_version: string
  catalogue_version: string
  total_score: number | string | null
  per_category: Record<string, number> | null
  started_at: string
  completed_at: string | null
}

type EvalRunItem = {
  id: string
  intake_fixture_id: string
  expected: unknown
  actual: unknown
  dim_price: number | string | null
  dim_material: number | string | null
  dim_tier: number | string | null
  dim_scope: number | string | null
  dim_routing: number | string | null
  notes: string | null
}

export default function EvalAgentPage() {
  const [token, setToken] = useState<string | null>(null)
  const [runs, setRuns] = useState<EvalRunRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [drilldown, setDrilldown] = useState<{
    run: EvalRunRow
    items: EvalRunItem[]
  } | null>(null)
  const [runMsg, setRunMsg] = useState<string | null>(null)

  const loadRuns = useCallback(async (t: string) => {
    setErr(null)
    try {
      const res = await fetch('/api/admin/agents/queue', {
        headers: { Authorization: `Bearer ${t}` },
        cache: 'no-store',
      })
      const json = (await res.json()) as { ok: boolean; eval_runs: EvalRunRow[]; error?: string }
      if (!res.ok || !json.ok) {
        setErr(json.error || `HTTP ${res.status}`)
        return
      }
      setRuns(json.eval_runs)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const loadDrilldown = useCallback(
    async (t: string, runId: string) => {
      setDrilldown(null)
      try {
        const res = await fetch(`/api/admin/agents/eval-runs/${runId}`, {
          headers: { Authorization: `Bearer ${t}` },
          cache: 'no-store',
        })
        const json = (await res.json()) as {
          ok: boolean
          run: EvalRunRow
          items: EvalRunItem[]
          error?: string
        }
        if (!res.ok || !json.ok) {
          setErr(json.error || `HTTP ${res.status}`)
          return
        }
        setDrilldown({ run: json.run, items: json.items })
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    },
    [],
  )

  useEffect(() => {
    const sb = getBrowserSupabase()
    sb.auth.getSession().then(({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      if (t) void loadRuns(t)
      // Honour ?run=<id> query param so the overview's "open run" links
      // pre-select a drill-down on load.
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        const r = url.searchParams.get('run')
        if (r && t) {
          setSelectedRunId(r)
          void loadDrilldown(t, r)
        }
      }
    })
  }, [loadRuns, loadDrilldown])

  const triggerRun = useCallback(async () => {
    if (!token) return
    setBusy(true)
    setRunMsg(null)
    try {
      const res = await fetch('/api/admin/agents/trigger/eval', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      })
      const json = (await res.json()) as Record<string, unknown>
      if (!res.ok || !json.ok) {
        setRunMsg(`Failed: ${String(json.error ?? `HTTP ${res.status}`)}`)
      } else {
        setRunMsg(`Run complete · ${json.total_score}% total`)
      }
      await loadRuns(token)
    } catch (e) {
      setRunMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [token, loadRuns])

  const selectRun = useCallback(
    (runId: string) => {
      if (!token) return
      setSelectedRunId(runId)
      void loadDrilldown(token, runId)
    },
    [token, loadDrilldown],
  )

  const latestScore = runs[0]?.total_score
  const sparkline = useMemo(() => runs.slice(0, 10).reverse(), [runs])

  return (
    <main className="mx-auto min-h-screen max-w-6xl bg-ink-deep px-5 pb-24 pt-12 text-text-pri sm:px-8">
      <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-text-dim">
        <Link href="/admin/agents" className="hover:text-accent transition-colors">
          QuoteMax &rarr; Admin &rarr; Quality Agents
        </Link>{' '}
        &rarr; Eval
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-4 flex-wrap">
        <h1 className="font-extrabold uppercase tracking-[-0.025em] text-[clamp(2rem,4vw,3rem)] leading-[1.05]">
          Eval Agent
        </h1>
        <button
          type="button"
          onClick={triggerRun}
          disabled={busy || !token}
          className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.16em] border border-accent bg-accent/10 px-4 py-2 text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Running…' : 'Run a pass now'}
        </button>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-sec">
        Each run scores the live QuoteMax estimator against a hold-out
        fixture set. Drill into a run for per-fixture dimension scores.
      </p>

      {err && (
        <div className="mt-6 border-l-2 border-l-warning border border-ink-line bg-ink-card px-4 py-3 text-xs text-text-sec">
          <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-warning mb-1">
            Error
          </div>
          {err}
        </div>
      )}
      {runMsg && (
        <div className="mt-6 border-l-2 border-l-accent border border-ink-line bg-ink-card px-4 py-3 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-accent">
          {runMsg}
        </div>
      )}

      <section className="mt-10 grid gap-4 md:grid-cols-3">
        <div className="border border-ink-line bg-ink-card p-6">
          <div className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-text-dim">
            Latest total score
          </div>
          <div className="mt-2 font-mono text-4xl font-bold tabular-nums text-accent">
            {latestScore != null ? `${Number(latestScore).toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className="border border-ink-line bg-ink-card p-6">
          <div className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-text-dim">
            Runs (latest 10)
          </div>
          <div className="mt-2 font-mono text-4xl font-bold tabular-nums text-text-pri">
            {runs.length}
          </div>
        </div>
        <div className="border border-ink-line bg-ink-card p-6">
          <div className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-text-dim">
            Trend
          </div>
          <div className="mt-3 flex h-12 items-end gap-1">
            {sparkline.length === 0 ? (
              <span className="text-xs text-text-dim">No runs yet</span>
            ) : (
              sparkline.map((r) => {
                const s = Number(r.total_score ?? 0)
                const h = Math.max(4, Math.round((s / 100) * 48))
                return (
                  <span
                    key={r.id}
                    title={`${s.toFixed(1)}% · ${new Date(r.started_at).toLocaleString('en-AU')}`}
                    className="w-2 bg-accent"
                    style={{ height: `${h}px` }}
                  />
                )
              })
            )}
          </div>
        </div>
      </section>

      <section className="mt-10">
        <div className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.18em] text-accent mb-3">
          Run history
        </div>
        <div className="border border-ink-line bg-ink-card">
          {runs.length === 0 ? (
            <p className="px-5 py-4 text-xs text-text-dim">
              No runs yet. Click <em>Run a pass now</em> above.
            </p>
          ) : (
            <ul className="divide-y divide-ink-line">
              {runs.map((r) => (
                <li
                  key={r.id}
                  className={`px-5 py-3 cursor-pointer transition-colors hover:bg-ink-deep ${
                    selectedRunId === r.id ? 'bg-ink-deep' : ''
                  }`}
                  onClick={() => selectRun(r.id)}
                >
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <div className="font-mono text-xs">
                      <span className={selectedRunId === r.id ? 'text-accent' : 'text-text-pri'}>
                        {r.id.slice(0, 8)}…
                      </span>
                      <span className="ml-3 text-text-dim">
                        {relativeTime(r.started_at)}
                      </span>
                    </div>
                    <div className="font-mono text-sm font-bold tabular-nums text-accent">
                      {r.total_score != null ? `${Number(r.total_score).toFixed(1)}%` : '—'}
                    </div>
                  </div>
                  {r.per_category && Object.keys(r.per_category).length > 0 && (
                    <div className="mt-1 font-mono text-[0.6rem] text-text-dim">
                      {Object.entries(r.per_category)
                        .map(([k, v]) => `${k}: ${Number(v).toFixed(0)}%`)
                        .join(' · ')}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {drilldown && (
        <section className="mt-10">
          <div className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.18em] text-accent mb-3">
            Run drill-down · {drilldown.run.id.slice(0, 8)}…
          </div>
          <div className="border border-ink-line bg-ink-card">
            {drilldown.items.length === 0 ? (
              <p className="px-5 py-4 text-xs text-text-dim">No items in this run.</p>
            ) : (
              <ul className="divide-y divide-ink-line">
                {drilldown.items.map((it) => (
                  <li key={it.id} className="px-5 py-4">
                    <div className="font-mono text-xs text-text-pri">{it.intake_fixture_id}</div>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[0.65rem] sm:grid-cols-5">
                      <ScoreCell label="price" value={it.dim_price} />
                      <ScoreCell label="material" value={it.dim_material} />
                      <ScoreCell label="tier" value={it.dim_tier} />
                      <ScoreCell label="scope" value={it.dim_scope} />
                      <ScoreCell label="routing" value={it.dim_routing} />
                    </div>
                    {it.notes && (
                      <p className="mt-2 font-mono text-[0.65rem] text-text-dim">{it.notes}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </main>
  )
}

function ScoreCell({
  label,
  value,
}: {
  label: string
  value: number | string | null
}) {
  const n = value != null ? Number(value) : null
  const tone =
    n == null
      ? 'text-text-dim'
      : n >= 80
        ? 'text-accent'
        : n >= 50
          ? 'text-text-pri'
          : 'text-warning'
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="uppercase tracking-[0.14em] text-text-dim">{label}</span>
      <span className={`tabular-nums font-bold ${tone}`}>
        {n != null ? n.toFixed(0) : '—'}
      </span>
    </div>
  )
}
