'use client'

// /admin/agents — Quality Agents overview dashboard.
//
// Reads from /api/admin/agents/queue (admin-gated). Shows:
//   - Three agent cards with their latest signal (Eval score,
//     Catalogue pending count, Tradie-Learn pending count) +
//     "Run now" button (server proxy to Railway).
//   - Quick links into each agent's dedicated review page.
//
// Maintain Technology design system — dark navy command-centre,
// orange accent, numbered cards.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'

type QueueResponse = {
  ok: boolean
  eval_runs: Array<{
    id: string
    total_score: number | string | null
    started_at: string
    completed_at: string | null
  }>
  counts: {
    catalogue_pending: number
    tradie_pending: number
  }
}

export default function AgentsOverviewPage() {
  const [data, setData] = useState<QueueResponse | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<'eval' | 'catalogue' | 'tradie-learn' | null>(null)
  const [lastRunSummary, setLastRunSummary] = useState<string | null>(null)

  // Fetch the queue once on mount + whenever a trigger completes.
  const load = useCallback(async (accessToken: string) => {
    setErr(null)
    try {
      const res = await fetch('/api/admin/agents/queue', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      })
      const json = (await res.json()) as QueueResponse & { error?: string }
      if (!res.ok || !json.ok) {
        setErr(json.error || `HTTP ${res.status}`)
        return
      }
      setData(json)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    const sb = getBrowserSupabase()
    sb.auth.getSession().then(({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      if (t) void load(t)
      else setErr('Not signed in')
    })
  }, [load])

  const trigger = useCallback(
    async (agent: 'eval' | 'catalogue' | 'tradie-learn') => {
      if (!token) {
        setErr('Not signed in')
        return
      }
      setBusy(agent)
      setLastRunSummary(null)
      try {
        const res = await fetch(`/api/admin/agents/trigger/${agent}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        })
        const json = (await res.json()) as Record<string, unknown>
        if (!res.ok || !json.ok) {
          setLastRunSummary(`${agent} failed: ${String(json.error ?? `HTTP ${res.status}`)}`)
        } else if (agent === 'eval') {
          setLastRunSummary(`Eval complete · ${json.total_score}% total`)
        } else if (agent === 'catalogue') {
          setLastRunSummary(
            `Catalogue sweep · ${String(json.rows_audited)} rows audited · ${String(json.findings_created)} new findings`,
          )
        } else {
          setLastRunSummary(
            `Tradie-Learn · ${String(json.events_seen)} events · ${String(json.patterns_created)} patterns`,
          )
        }
        await load(token)
      } catch (e) {
        setLastRunSummary(`${agent} errored: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setBusy(null)
      }
    },
    [token, load],
  )

  const latestEval = data?.eval_runs?.[0] ?? null
  const latestScore = latestEval?.total_score != null ? Number(latestEval.total_score) : null

  return (
    <main className="mx-auto min-h-screen max-w-6xl bg-ink-deep px-5 pb-24 pt-12 text-text-pri sm:px-8">
      <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-text-dim">
        QuoteMate &rarr; Admin &rarr; Quality Agents
      </div>
      <h1 className="mt-3 font-extrabold uppercase tracking-[-0.025em] text-[clamp(2rem,4vw,3rem)] leading-[1.05]">
        Quality Agents
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-sec">
        Three offline agents that measure, audit, and learn from the live
        QuoteMate quote pipeline. Findings land here for review &mdash;
        nothing is auto-applied. Approving an item readies it for the live
        catalogue or prompts.
      </p>

      <nav className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/admin/agents"
          className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.16em] border border-accent bg-accent/10 px-3 py-2 text-accent"
        >
          Overview
        </Link>
        <Link
          href="/admin/agents/eval"
          className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.16em] border border-ink-line px-3 py-2 text-text-dim transition-colors hover:border-accent/40 hover:text-text-pri"
        >
          Eval scoreboard
        </Link>
        <Link
          href="/admin/agents/catalogue"
          className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.16em] border border-ink-line px-3 py-2 text-text-dim transition-colors hover:border-accent/40 hover:text-text-pri"
        >
          Catalogue queue
          {data && data.counts.catalogue_pending > 0 && (
            <span className="ml-2 inline-block bg-accent px-1.5 py-0.5 text-[0.55rem] text-ink-deep">
              {data.counts.catalogue_pending}
            </span>
          )}
        </Link>
        <Link
          href="/admin/agents/tradie-edits"
          className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.16em] border border-ink-line px-3 py-2 text-text-dim transition-colors hover:border-accent/40 hover:text-text-pri"
        >
          Tradie edits
          {data && data.counts.tradie_pending > 0 && (
            <span className="ml-2 inline-block bg-accent px-1.5 py-0.5 text-[0.55rem] text-ink-deep">
              {data.counts.tradie_pending}
            </span>
          )}
        </Link>
      </nav>

      {err && (
        <div className="mt-6 border-l-2 border-l-warning border border-ink-line bg-ink-card px-4 py-3">
          <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-warning mb-1">
            Couldn&apos;t load queue
          </div>
          <p className="text-xs text-text-sec">{err}</p>
        </div>
      )}

      {lastRunSummary && (
        <div className="mt-6 border-l-2 border-l-accent border border-ink-line bg-ink-card px-4 py-3 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-accent">
          {lastRunSummary}
        </div>
      )}

      <section className="mt-10 grid gap-4 md:grid-cols-3">
        <AgentCard
          num="01"
          name="Eval"
          desc="Scores the live estimator against a hold-out fixture set. 5-dimension rubric. Track per-prompt-version deltas over time."
          metric={latestScore !== null ? `${latestScore}%` : '—'}
          metricLabel="latest total score"
          metricMuted={latestScore === null}
          onRun={() => trigger('eval')}
          running={busy === 'eval'}
          href="/admin/agents/eval"
        />
        <AgentCard
          num="02"
          name="Catalogue QA"
          desc="Reconciles catalogue rows against supplier truth. Surfaces price drift, contradictory descriptions, category mismatches."
          metric={data ? String(data.counts.catalogue_pending) : '—'}
          metricLabel="pending findings"
          metricMuted={!data || data.counts.catalogue_pending === 0}
          onRun={() => trigger('catalogue')}
          running={busy === 'catalogue'}
          href="/admin/agents/catalogue"
        />
        <AgentCard
          num="03"
          name="Tradie-Learn"
          desc="Watches tradie edits on past quotes. Clusters corrections into actionable patterns (median +0.5h labour bump, etc.)."
          metric={data ? String(data.counts.tradie_pending) : '—'}
          metricLabel="pending patterns"
          metricMuted={!data || data.counts.tradie_pending === 0}
          onRun={() => trigger('tradie-learn')}
          running={busy === 'tradie-learn'}
          href="/admin/agents/tradie-edits"
        />
      </section>

      <section className="mt-12">
        <div className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.18em] text-accent mb-3">
          Recent eval runs
        </div>
        <div className="border border-ink-line bg-ink-card">
          {data && data.eval_runs.length > 0 ? (
            <ul className="divide-y divide-ink-line">
              {data.eval_runs.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/agents/eval?run=${r.id}`}
                      className="font-mono text-xs text-text-pri hover:text-accent transition-colors"
                    >
                      {r.id.slice(0, 8)}…
                    </Link>
                    <span className="ml-3 text-xs text-text-dim">
                      {new Date(r.started_at).toLocaleString('en-AU')}
                    </span>
                  </div>
                  <div className="shrink-0 font-mono text-sm font-bold tabular-nums text-accent">
                    {r.total_score != null ? `${Number(r.total_score).toFixed(1)}%` : '—'}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-xs text-text-dim">
              No eval runs yet. Click <em>Run now</em> on the Eval card above.
            </p>
          )}
        </div>
      </section>
    </main>
  )
}

function AgentCard({
  num,
  name,
  desc,
  metric,
  metricLabel,
  metricMuted,
  onRun,
  running,
  href,
}: {
  num: string
  name: string
  desc: string
  metric: string
  metricLabel: string
  metricMuted: boolean
  onRun: () => void
  running: boolean
  href: string
}) {
  return (
    <article className="border border-ink-line bg-ink-card p-6 transition-colors hover:border-accent/40">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-xl font-extrabold tracking-tight text-accent">
          {num}
        </span>
        <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-text-dim">
          {metricLabel}
        </span>
      </div>
      <h2 className="mt-2 font-extrabold uppercase tracking-tight text-xl text-text-pri">
        {name}
      </h2>
      <div className={`mt-3 font-mono text-3xl font-bold tabular-nums ${metricMuted ? 'text-text-dim' : 'text-accent'}`}>
        {metric}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-text-sec">{desc}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.16em] border border-accent bg-accent/10 px-3 py-2 text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run now'}
        </button>
        <Link
          href={href}
          className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.16em] border border-ink-line px-3 py-2 text-text-dim transition-colors hover:border-accent/40 hover:text-text-pri"
        >
          Open
        </Link>
      </div>
    </article>
  )
}
