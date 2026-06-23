'use client'

// /admin/agents — Quality Agents overview.
//
// Three offline agents that score, audit, and learn from the live
// QuoteMax quote pipeline. Findings land here for review — nothing
// is auto-applied. Approving an item readies it for the live
// catalogue or prompts.
//
// Reads from /api/admin/agents/queue (admin-gated) and triggers
// runs via /api/admin/agents/trigger/[agent].
//
// Maintain Technology design system — dark navy command-centre,
// orange accent, generous typography, numbered cards.
// See .claude/skills/maintain-design-system.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
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

type AgentKey = 'eval' | 'catalogue' | 'tradie-learn'

export default function AgentsOverviewPage() {
  const [data, setData] = useState<QueueResponse | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<AgentKey | null>(null)
  const [lastRunSummary, setLastRunSummary] = useState<string | null>(null)

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
    async (agent: AgentKey) => {
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
          setLastRunSummary(
            `${agent} failed: ${String(json.error ?? `HTTP ${res.status}`)}`,
          )
        } else if (agent === 'eval') {
          setLastRunSummary(`Eval complete · ${json.total_score}% total score`)
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
        setLastRunSummary(
          `${agent} errored: ${e instanceof Error ? e.message : String(e)}`,
        )
      } finally {
        setBusy(null)
      }
    },
    [token, load],
  )

  const latestEval = data?.eval_runs?.[0] ?? null
  const latestScore =
    latestEval?.total_score != null ? Number(latestEval.total_score) : null

  const evalTone = useMemo<MetricTone>(() => {
    if (latestScore === null) return 'idle'
    if (latestScore >= 80) return 'good'
    if (latestScore >= 60) return 'warn'
    return 'bad'
  }, [latestScore])

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <TopographicBackdrop />

      {/* ── Header ───────────────────────────────────────────────── */}
      <header className="relative z-10 mx-auto max-w-7xl px-6 pt-14 pb-10 sm:px-10 md:pt-20">
        <Breadcrumb />

        <div className="mt-8 grid gap-10 md:grid-cols-[1.5fr_1fr] md:items-end md:gap-16">
          <h1 className="font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.5rem,5.5vw,4.75rem)]">
            Quality <span className="text-accent">agents</span>
          </h1>
          <p className="max-w-md text-base leading-relaxed text-text-sec md:text-lg">
            Three offline agents measure, audit, and learn from the live
            QuoteMax pipeline. Findings land here for review — nothing
            is auto-applied. Approve an item to ready it for the live
            catalogue or prompts.
          </p>
        </div>

        <nav className="mt-12 flex flex-wrap gap-3">
          <NavPill href="/admin/agents" active>
            Overview
          </NavPill>
          <NavPill href="/admin/agents/eval">Eval scoreboard</NavPill>
          <NavPill
            href="/admin/agents/catalogue"
            badge={data?.counts.catalogue_pending ?? 0}
          >
            Catalogue queue
          </NavPill>
          <NavPill
            href="/admin/agents/tradie-edits"
            badge={data?.counts.tradie_pending ?? 0}
          >
            Tradie edits
          </NavPill>
        </nav>
      </header>

      {/* ── Notice strip ─────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 sm:px-10">
        {err && (
          <Notice tone="warn" label="Couldn't load queue">
            {err}
          </Notice>
        )}
        {lastRunSummary && (
          <Notice tone="accent" label="Latest run">
            {lastRunSummary}
          </Notice>
        )}
      </section>

      {/* ── Agent cards ──────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto mt-6 max-w-7xl px-6 sm:px-10">
        <SectionHeading
          eyebrow="Three agents"
          title="Run, review, approve"
        />
        <div className="mt-10 grid gap-7 md:grid-cols-3">
          <AgentCard
            num="01"
            name="Eval"
            tag="Rubric scoring"
            desc="Scores the live estimator against a hold-out fixture set on a 5-dimension rubric. Track per-prompt-version deltas over time and catch regressions before they ship."
            metric={latestScore !== null ? `${latestScore.toFixed(1)}%` : '—'}
            metricLabel="Latest total score"
            metricTone={evalTone}
            onRun={() => trigger('eval')}
            running={busy === 'eval'}
            href="/admin/agents/eval"
          />
          <AgentCard
            num="02"
            name="Catalogue QA"
            tag="Drift detection"
            desc="Reconciles catalogue rows against supplier truth. Surfaces price drift, contradictory descriptions, and category mismatches the operator can approve in a click."
            metric={data ? formatCount(data.counts.catalogue_pending) : '—'}
            metricLabel="Pending findings"
            metricTone={
              !data || data.counts.catalogue_pending === 0
                ? 'idle'
                : data.counts.catalogue_pending > 20
                  ? 'warn'
                  : 'accent'
            }
            onRun={() => trigger('catalogue')}
            running={busy === 'catalogue'}
            href="/admin/agents/catalogue"
          />
          <AgentCard
            num="03"
            name="Tradie-Learn"
            tag="Pattern mining"
            desc="Watches tradie edits on past quotes. Clusters corrections into actionable patterns — median +0.5h labour bump on a job type, recurring material swaps, repeated assumption rewrites."
            metric={data ? formatCount(data.counts.tradie_pending) : '—'}
            metricLabel="Pending patterns"
            metricTone={
              !data || data.counts.tradie_pending === 0
                ? 'idle'
                : data.counts.tradie_pending > 10
                  ? 'warn'
                  : 'accent'
            }
            onRun={() => trigger('tradie-learn')}
            running={busy === 'tradie-learn'}
            href="/admin/agents/tradie-edits"
          />
        </div>
      </section>

      {/* ── Recent eval runs ─────────────────────────────────────── */}
      <section className="relative z-10 mx-auto mt-20 max-w-7xl px-6 pb-24 sm:px-10 md:pb-32">
        <SectionHeading eyebrow="Latest activity" title="Recent eval runs" />
        <div className="mt-8 border border-ink-line bg-ink-card">
          {data && data.eval_runs.length > 0 ? (
            <ul className="divide-y divide-ink-line">
              {data.eval_runs.map((r) => {
                const score = r.total_score != null ? Number(r.total_score) : null
                return (
                  <li key={r.id}>
                    <Link
                      href={`/admin/agents/eval?run=${r.id}`}
                      className="flex items-center justify-between gap-6 px-6 py-5 transition-colors hover:bg-ink-line/30 sm:px-8"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-base font-semibold text-text-pri">
                          {r.id.slice(0, 8)}
                          <span className="text-text-dim">…</span>
                        </div>
                        <div className="mt-1 text-sm text-text-dim">
                          {new Date(r.started_at).toLocaleString('en-AU', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={`font-mono text-3xl font-bold tabular-nums sm:text-4xl ${scoreColour(score)}`}
                        >
                          {score !== null ? `${score.toFixed(1)}%` : '—'}
                        </div>
                        <div className="mt-1 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-text-dim">
                          total score
                        </div>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="px-6 py-8 text-base text-text-sec">
              No eval runs yet. Click <span className="font-semibold text-accent">Run now</span> on the Eval card above to kick off the first one.
            </p>
          )}
        </div>
      </section>

      {/* ── Closing accent bar ───────────────────────────────────── */}
      <div className="relative z-10 bg-accent px-6 py-5 text-center text-white">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.16em]">
          QuoteMax Admin · Quality Agents
        </span>
      </div>
    </main>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────

function Breadcrumb() {
  return (
    <div className="flex items-center gap-3 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
      <Link href="/admin" className="transition-colors hover:text-text-pri">
        QuoteMax Admin
      </Link>
      <span className="text-ink-line">/</span>
      <span className="text-text-pri">Quality agents</span>
    </div>
  )
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <div className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">
        {eyebrow}
      </div>
      <h2 className="mt-3 font-extrabold uppercase tracking-[-0.025em] text-[clamp(1.5rem,2.6vw,2.25rem)] leading-[1.1]">
        {title}
      </h2>
    </div>
  )
}

function NavPill({
  href,
  active = false,
  badge,
  children,
}: {
  href: string
  active?: boolean
  badge?: number
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-3 border px-4 py-2.5 font-mono text-sm font-semibold uppercase tracking-[0.14em] transition-colors ${
        active
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-ink-line text-text-sec hover:border-accent/40 hover:text-text-pri'
      }`}
    >
      <span>{children}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className={`inline-flex h-6 min-w-[1.5rem] items-center justify-center px-1.5 font-mono text-xs font-bold ${
            active ? 'bg-accent text-ink-deep' : 'bg-accent text-ink-deep'
          }`}
        >
          {badge}
        </span>
      )}
    </Link>
  )
}

function Notice({
  tone,
  label,
  children,
}: {
  tone: 'warn' | 'accent'
  label: string
  children: React.ReactNode
}) {
  const border = tone === 'warn' ? 'border-l-warning' : 'border-l-accent'
  const labelColour = tone === 'warn' ? 'text-warning' : 'text-accent'
  return (
    <div
      className={`mt-6 border border-ink-line ${border} border-l-4 bg-ink-card px-5 py-4`}
    >
      <div
        className={`font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] ${labelColour}`}
      >
        {label}
      </div>
      <p className="mt-1 text-base text-text-sec">{children}</p>
    </div>
  )
}

type MetricTone = 'good' | 'warn' | 'bad' | 'accent' | 'idle'

function AgentCard({
  num,
  name,
  tag,
  desc,
  metric,
  metricLabel,
  metricTone,
  onRun,
  running,
  href,
}: {
  num: string
  name: string
  tag: string
  desc: string
  metric: string
  metricLabel: string
  metricTone: MetricTone
  onRun: () => void
  running: boolean
  href: string
}) {
  const metricColour =
    metricTone === 'good'
      ? 'text-teal-glow'
      : metricTone === 'warn'
        ? 'text-accent'
        : metricTone === 'bad'
          ? 'text-warning'
          : metricTone === 'accent'
            ? 'text-accent'
            : 'text-text-dim'

  return (
    <article className="group relative flex h-full flex-col border border-ink-line bg-ink-card p-7 transition-colors hover:border-accent sm:p-8">
      {/* Header — number + chip */}
      <div className="flex items-start justify-between gap-4">
        <span className="font-mono text-5xl font-bold leading-none text-accent sm:text-6xl">
          {num}
        </span>
        <span className="inline-flex items-center bg-accent/15 px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          {tag}
        </span>
      </div>

      {/* Name */}
      <h3 className="mt-6 font-extrabold uppercase tracking-[-0.02em] text-2xl text-text-pri sm:text-[1.75rem]">
        {name}
      </h3>

      {/* Metric */}
      <div className="mt-6 border-t border-ink-line pt-5">
        <div
          className={`font-mono text-5xl font-bold tabular-nums leading-none sm:text-6xl ${metricColour}`}
        >
          {metric}
        </div>
        <div className="mt-3 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-text-dim">
          {metricLabel}
        </div>
      </div>

      {/* Description */}
      <p className="mt-6 text-base leading-relaxed text-text-sec">{desc}</p>

      {/* Actions */}
      <div className="mt-7 flex flex-wrap gap-3 pt-6">
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="inline-flex items-center gap-2 bg-accent px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? (
            <>
              <Spinner /> Running…
            </>
          ) : (
            <>
              Run now <span aria-hidden="true">&rarr;</span>
            </>
          )}
        </button>
        <Link
          href={href}
          className="inline-flex items-center gap-2 border border-ink-line px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-sec transition-colors hover:border-accent hover:text-text-pri"
        >
          Open
        </Link>
      </div>
    </article>
  )
}

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin border-2 border-white/40 border-t-white"
      aria-hidden="true"
    />
  )
}

function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1)}k`
}

function scoreColour(score: number | null): string {
  if (score === null) return 'text-text-dim'
  if (score >= 80) return 'text-teal-glow'
  if (score >= 60) return 'text-accent'
  return 'text-warning'
}

function TopographicBackdrop() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.16]"
      viewBox="0 0 1920 1080"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="agents-topo-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#14B8A6" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#14B8A6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g stroke="url(#agents-topo-fade)" strokeWidth="1" fill="none">
        <path d="M0,820 Q220,700 460,760 T940,720 T1420,760 T1920,700" />
        <path d="M0,760 Q220,640 460,700 T940,660 T1420,700 T1920,640" />
        <path d="M0,700 Q220,580 460,640 T940,600 T1420,640 T1920,580" />
        <path d="M0,640 Q220,520 460,580 T940,540 T1420,580 T1920,520" />
        <path d="M0,580 Q220,460 460,520 T940,480 T1420,520 T1920,460" />
        <path d="M0,520 Q220,400 460,460 T940,420 T1420,460 T1920,400" />
        <path d="M0,460 Q220,340 460,400 T940,360 T1420,400 T1920,340" />
        <path d="M0,400 Q220,280 460,340 T940,300 T1420,340 T1920,280" />
      </g>
    </svg>
  )
}
