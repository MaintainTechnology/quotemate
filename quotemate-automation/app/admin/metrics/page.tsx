'use client'

// /admin/metrics — Company performance / usage analytics (admin-only).
//
// Three stacked zones: (A) a weekly scorecard against the founder's 90-day
// targets, (B) all-time activity counters + weekly trends + channel/trade
// splits, and (C) a per-tradie usage table. Every number comes from
// /api/admin/metrics (pure aggregation in lib/admin/metrics.ts). The four
// metrics QuoteMax does not yet capture render as honest "Not tracked yet"
// cards — no fabricated numbers.
//
// Design system: Maintain Technology (dark navy, orange accent, mono all-caps).

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthToken } from '@/lib/auth/client-token'
import type { PlatformMetrics, TenantUsageRow } from '@/lib/admin/metrics'
import { SplitBars, TrendBars } from '@/app/_components/MetricCharts'

const WEEK_OPTIONS = [4, 8, 12, 26]

type LoadState = 'loading' | 'ready' | 'signed-out' | 'forbidden' | 'error'

export default function AdminMetricsPage() {
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [weeks, setWeeks] = useState(8)
  const [includeTest, setIncludeTest] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Monotonic request id: a rapid week/real-only toggle fires overlapping
  // fetches, so we ignore any response that isn't from the latest call —
  // otherwise a slow older response can overwrite fresher data (last-write race).
  const reqIdRef = useRef(0)
  const load = useCallback(async () => {
    const myId = ++reqIdRef.current
    const isStale = () => reqIdRef.current !== myId
    setRefreshing(true)
    try {
      const token = await getAuthToken()
      if (isStale()) return
      if (!token) {
        setState('signed-out')
        return
      }
      const res = await fetch(
        `/api/admin/metrics?weeks=${weeks}&includeTest=${includeTest}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
      )
      const json = (await res.json()) as
        | { ok: true; metrics: PlatformMetrics }
        | { ok: false; error: string }
      if (isStale()) return
      if (res.status === 403) {
        setState('forbidden')
        return
      }
      if (!json.ok) {
        setErrorMsg(json.error)
        setState('error')
        return
      }
      setMetrics(json.metrics)
      setState('ready')
    } catch (e) {
      if (!isStale()) {
        setErrorMsg(e instanceof Error ? e.message : 'Network error')
        setState('error')
      }
    } finally {
      if (!isStale()) setRefreshing(false)
    }
  }, [weeks, includeTest])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <section className="mx-auto max-w-7xl px-6 pt-12 pb-20 sm:px-10">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 font-mono text-[0.75rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
          <Link href="/admin" className="transition-colors hover:text-accent">
            QuoteMax
          </Link>
          <span className="text-ink-line">/</span>
          <Link href="/admin" className="transition-colors hover:text-accent">
            Admin
          </Link>
          <span className="text-ink-line">/</span>
          <span className="text-text-pri">Company health</span>
        </div>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="font-extrabold uppercase leading-[0.95] tracking-[-0.03em] text-[clamp(2rem,4.5vw,3.5rem)]">
              Company <span className="text-accent">health</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-text-sec">
              Everything happening across QuoteMax — how many quotes were
              processed, how many people asked, and how much each tradie is
              actually using the platform.
            </p>
          </div>
          <Controls
            weeks={weeks}
            onWeeks={setWeeks}
            includeTest={includeTest}
            onIncludeTest={setIncludeTest}
            refreshing={refreshing}
            onRefresh={load}
          />
        </div>

        {/* ── Body ───────────────────────────────────────────────── */}
        {state === 'loading' && <Notice>Loading company metrics…</Notice>}
        {state === 'signed-out' && (
          <Notice tone="warn">
            Not signed in.{' '}
            <Link href="/signin" className="text-accent underline">
              Sign in
            </Link>{' '}
            with an admin account to view metrics.
          </Notice>
        )}
        {state === 'forbidden' && (
          <Notice tone="warn">
            Signed in, but this account is not an admin. Company metrics are
            admin-only.
          </Notice>
        )}
        {state === 'error' && (
          <Notice tone="warn">Couldn’t load metrics: {errorMsg}</Notice>
        )}

        {state === 'ready' && metrics && <Dashboard metrics={metrics} />}
      </section>
    </main>
  )
}

// ─── Dashboard body ───────────────────────────────────────────────────

function Dashboard({ metrics }: { metrics: PlatformMetrics }) {
  const s = metrics.scorecard
  const a = metrics.activity

  return (
    <div className="mt-10 space-y-14">
      {/* ZONE A — Scorecard vs 90-day targets */}
      <Zone
        eyebrow="Scorecard"
        title="This week vs the 90-day targets"
        note="Australia/Sydney weeks. Green = on target."
      >
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          <ScoreCard
            label="Active tradies"
            value={`${s.activeTradies} / ${s.activeTradiesTarget}`}
            sub="Quoting this week"
            tone={s.activeTradies >= s.activeTradiesTarget ? 'ok' : 'warn'}
          />
          <ScoreCard
            label="New sign-ups"
            value={`${s.newSignups}`}
            sub="This week · target 2–3"
            tone={s.newSignups >= 2 ? 'ok' : 'warn'}
          />
          <ScoreCard
            label="Quotes requested"
            value={`${s.requestsThisWeek}`}
            sub={`${fmtDelta(s.requestsWoWDelta)} vs last week`}
            tone={s.requestsWoWDelta >= 0 ? 'ok' : 'warn'}
          />
          <ScoreCard
            label="Avg turnaround"
            value={fmtHours(s.avgTurnaroundHours)}
            sub="Intake → quote · target <2h"
            tone={
              s.avgTurnaroundHours == null
                ? 'muted'
                : s.avgTurnaroundHours <= 2
                  ? 'ok'
                  : 'warn'
            }
          />
          <ScoreCard
            label="Acceptance rate"
            value={
              s.acceptanceRatePct == null ? 'Pre-revenue' : `${s.acceptanceRatePct}%`
            }
            sub={`${s.acceptedCount}/${s.sentCount} sent quotes accepted`}
            tone="neutral"
          />
          <ScoreCard
            label="Repeat usage"
            value={fmtPct(s.repeatUsagePct)}
            sub="Tradies back this week · target >70%"
            tone={
              s.repeatUsagePct == null
                ? 'muted'
                : s.repeatUsagePct >= 70
                  ? 'ok'
                  : 'warn'
            }
          />
          <NotTrackedCard label="Customer satisfaction" />
          <NotTrackedCard label="Referrals" />
          <NotTrackedCard label="Founder conversations" />
        </div>
      </Zone>

      {/* ZONE B — Activity & trends */}
      <Zone
        eyebrow="Activity"
        title="Everything QuoteMax has processed"
        note={`${metrics.includeTest ? 'Including' : 'Excluding'} test tenants${
          metrics.unattributedRows > 0
            ? ` · ${metrics.unattributedRows} pre-launch rows unattributed`
            : ''
        }`}
      >
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <Counter label="Quotes processed" value={a.totalQuotes} />
          <Counter label="Requests" value={a.totalIntakes} />
          <Counter label="Unique consumers" value={a.uniqueConsumers} />
          <Counter label="Calls" value={a.totalCalls} />
          <Counter label="SMS chats" value={a.totalSmsConversations} />
          <Counter label="Tradies" value={a.totalTradies} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <TrendBars
            title="Quotes / week"
            points={metrics.trends.map((t) => ({ label: t.label, value: t.quotes }))}
            tone="accent"
          />
          <TrendBars
            title="Requests / week"
            points={metrics.trends.map((t) => ({ label: t.label, value: t.intakes }))}
            tone="teal"
          />
          <TrendBars
            title="Sign-ups / week"
            points={metrics.trends.map((t) => ({ label: t.label, value: t.signups }))}
            tone="accent"
          />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <SplitBars title="Channel split (requests)" slices={metrics.channelSplit} tone="teal" />
          <SplitBars title="Trade split (quotes)" slices={metrics.tradeSplit} tone="accent" />
        </div>
      </Zone>

      {/* ZONE C — Per-tradie usage */}
      <Zone
        eyebrow="Per tradie"
        title="How much each tradie is using the platform"
        note={`${metrics.realTenantCount} real tradies${
          metrics.includeTest ? ` · +${metrics.testTenantCount} test` : ''
        }`}
      >
        <TenantTable rows={metrics.tenants} />
      </Zone>
    </div>
  )
}

// ─── Controls ─────────────────────────────────────────────────────────

function Controls({
  weeks,
  onWeeks,
  includeTest,
  onIncludeTest,
  refreshing,
  onRefresh,
}: {
  weeks: number
  onWeeks: (n: number) => void
  includeTest: boolean
  onIncludeTest: (b: boolean) => void
  refreshing: boolean
  onRefresh: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex border border-ink-line">
        {WEEK_OPTIONS.map((w) => (
          <button
            key={w}
            type="button"
            aria-pressed={weeks === w}
            onClick={() => onWeeks(w)}
            className={`px-3 py-2 font-mono text-[0.65rem] font-bold uppercase tracking-[0.12em] transition-colors ${
              weeks === w
                ? 'bg-accent text-white'
                : 'text-text-dim hover:text-text-pri'
            }`}
          >
            {w}w
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-pressed={includeTest}
        onClick={() => onIncludeTest(!includeTest)}
        className={`border px-3 py-2 font-mono text-[0.65rem] font-bold uppercase tracking-[0.12em] transition-colors ${
          includeTest
            ? 'border-amber-700/60 bg-amber-950/30 text-amber-300'
            : 'border-ink-line text-text-dim hover:text-text-pri'
        }`}
        title="Show seed/pilot tenants and test traffic"
      >
        {includeTest ? 'Test: shown' : 'Real only'}
      </button>

      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-busy={refreshing}
        className="border border-ink-line px-3 py-2 font-mono text-[0.65rem] font-bold uppercase tracking-[0.12em] text-text-dim transition-colors hover:text-accent disabled:opacity-50"
      >
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  )
}

// ─── Layout + card primitives ─────────────────────────────────────────

function Zone({
  eyebrow,
  title,
  note,
  children,
}: {
  eyebrow: string
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-5">
        <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-accent">
          {eyebrow}
        </div>
        <h2 className="mt-2 font-extrabold uppercase tracking-[-0.02em] text-[clamp(1.25rem,2.4vw,1.9rem)] leading-[1.1]">
          {title}
        </h2>
        {note && (
          <div className="mt-1.5 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-text-dim">
            {note}
          </div>
        )}
      </div>
      {children}
    </section>
  )
}

type ScoreTone = 'ok' | 'warn' | 'neutral' | 'muted'

function ScoreCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone: ScoreTone
}) {
  const valueColor =
    tone === 'ok'
      ? 'text-emerald-300'
      : tone === 'warn'
        ? 'text-amber-300'
        : tone === 'muted'
          ? 'text-text-dim'
          : 'text-accent'
  const dot =
    tone === 'ok'
      ? 'bg-emerald-300'
      : tone === 'warn'
        ? 'bg-amber-300'
        : tone === 'muted'
          ? 'bg-text-dim'
          : 'bg-accent'
  return (
    <div className="bg-ink-card border border-ink-line p-5">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 ${dot}`} aria-hidden="true" />
        <div className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-text-dim">
          {label}
        </div>
      </div>
      <div
        className={`mt-3 font-mono font-extrabold leading-none text-[clamp(1.4rem,2.6vw,2rem)] tabular-nums ${valueColor}`}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-2 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-text-sec">
          {sub}
        </div>
      )}
    </div>
  )
}

function NotTrackedCard({ label }: { label: string }) {
  return (
    <div className="border border-dashed border-ink-line bg-ink-card/40 p-5">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 bg-text-dim" aria-hidden="true" />
        <div className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-text-dim">
          {label}
        </div>
      </div>
      <div className="mt-3 font-mono text-sm font-bold text-text-dim">
        Not tracked yet
      </div>
      <div className="mt-2 font-mono text-[0.55rem] uppercase tracking-[0.12em] text-text-dim">
        Needs instrumentation · v2
      </div>
    </div>
  )
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-ink-card border border-ink-line p-5">
      <div className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-text-dim">
        {label}
      </div>
      <div className="mt-2 font-mono font-extrabold leading-none text-[clamp(1.5rem,3vw,2.4rem)] tabular-nums text-accent">
        {value.toLocaleString('en-AU')}
      </div>
    </div>
  )
}

function Notice({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'warn'
}) {
  const cls =
    tone === 'warn'
      ? 'border-amber-700/60 bg-amber-950/30 text-amber-200'
      : 'border-ink-line bg-ink-card text-text-sec'
  return (
    <div className={`mt-10 border ${cls} px-5 py-4 font-mono text-sm`}>
      {children}
    </div>
  )
}

// ─── Tenant table ─────────────────────────────────────────────────────

function TenantTable({ rows }: { rows: TenantUsageRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="border border-ink-line bg-ink-card px-5 py-6 font-mono text-sm text-text-dim">
        No tradies to show. Toggle “Test: shown” to include seed tenants.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto border border-ink-line">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="bg-ink-card text-left font-mono text-[0.58rem] uppercase tracking-[0.14em] text-text-dim">
            <Th>Business</Th>
            <Th>Trade</Th>
            <Th>Joined</Th>
            <Th right>Quotes</Th>
            <Th right>7d</Th>
            <Th right>Consumers</Th>
            <Th>Last active</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-t border-ink-line hover:bg-ink-card/60">
              <Td>
                <span className="font-semibold text-text-pri">{t.businessName}</span>
              </Td>
              <Td>
                <span className="text-text-sec">
                  {t.trades.length ? t.trades.map(cap).join(' · ') : '—'}
                </span>
              </Td>
              <Td>
                <span className="font-mono text-xs text-text-sec">
                  {fmtDate(t.createdAt)}
                </span>
              </Td>
              <Td right>
                <span className="font-mono tabular-nums text-accent">{t.quotesTotal}</span>
              </Td>
              <Td right>
                <span className="font-mono tabular-nums text-text-sec">{t.quotes7d}</span>
              </Td>
              <Td right>
                <span className="font-mono tabular-nums text-text-sec">
                  {t.uniqueConsumers}
                </span>
              </Td>
              <Td>
                <span className="font-mono text-xs text-text-sec">
                  {fmtDate(t.lastActiveAt)}
                </span>
              </Td>
              <Td>
                <StatusPill status={t.status} />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-4 py-3 font-semibold ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td className={`px-4 py-3 ${right ? 'text-right' : 'text-left'}`}>{children}</td>
}

function StatusPill({ status }: { status: TenantUsageRow['status'] }) {
  const map: Record<TenantUsageRow['status'], [string, string, string]> = {
    active: ['Active', 'text-emerald-300 border-emerald-700/60 bg-emerald-950/30', 'bg-emerald-300'],
    new: ['New', 'text-accent border-accent/50 bg-accent/10', 'bg-accent'],
    dormant: ['Dormant', 'text-amber-300 border-amber-700/60 bg-amber-950/30', 'bg-amber-300'],
  }
  const [label, cls, dot] = map[status]
  return (
    <span
      className={`inline-flex items-center gap-2 border px-2.5 py-1 font-mono text-[0.55rem] font-bold uppercase tracking-[0.14em] ${cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  )
}

// ─── Formatters ───────────────────────────────────────────────────────

function fmtHours(h: number | null): string {
  if (h == null) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  return `${h.toFixed(1)}h`
}

function fmtPct(p: number | null): string {
  return p == null ? '—' : `${p}%`
}

function fmtDelta(d: number): string {
  if (d > 0) return `+${d}`
  return `${d}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d)
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
