'use client'

// "Your activity" — the tradie's own analytics block, now the second top-level
// tab of the dashboard Overview page (Overview | Your activity). Communication
// volume (who's texting/calling), a lead funnel, speed-to-quote, weekly trends
// and channel/job-type splits — the things NOT already shown by the money-first
// Pipeline + KPI rows on the Overview tab.
//
// Design: matched to the Overview tab so the two views read as one product.
// Every surface uses the dashboard card language — rounded-card corners + the
// `edge-lit` top highlight — over the Maintain tokens (warm charcoal, Cat-
// yellow accent, mono all-caps). Insights lead with the ACTIONABLE ("3 quotes
// to review →") so the section drives a next step, not just a number to admire.

import { useEffect, useState } from 'react'
import type { TradieAnalytics } from '@/lib/dashboard/tradie-analytics'
import { type Period, periodLabel, periodRange } from '@/lib/dashboard/period'
import { SplitBars, TrendBars } from '@/app/_components/MetricCharts'
import { getAuthToken } from '@/lib/auth/client-token'

type NavTab = 'quotes' | 'chats'
type LoadState = 'loading' | 'ready' | 'error'

// Shared surface treatment so every card here matches the Overview tab's
// rounded, lit-edge plates.
const CARD = 'rounded-card edge-lit'

export function OverviewAnalytics({
  accessToken,
  setTab,
  onFollowUpCold,
  period = 'all',
}: {
  accessToken: string | null
  setTab: (tab: NavTab) => void
  // Opens the Chats tab pre-filtered to cold (abandoned) conversations. When
  // omitted, the cold CTA just opens Chats unfiltered.
  onFollowUpCold?: () => void
  // Reporting-period window shared with the Overview KPIs. 'all' = the
  // historical all-time aggregate.
  period?: Period
}) {
  const [data, setData] = useState<TradieAnalytics | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    // Initial state is already 'loading'; we intentionally do NOT reset to
    // loading synchronously here (avoids a cascading render + a flash on
    // re-fetch — the prior data stays until the new response lands).
    // Resolve the window on THIS (browser) clock so it matches the Overview
    // KPIs, which scope with the same local calendar dates.
    const range = periodRange(period, new Date())
    const qs = new URLSearchParams({ weeks: '8' })
    if (range) {
      qs.set('from', range.start.toISOString())
      qs.set('to', range.end.toISOString())
    }
    void (async () => {
      // Mint a FRESH token per request — the Clerk session token captured at
      // mount expires ~60s later, so reusing the prop 401s.
      const token = (await getAuthToken()) ?? accessToken
      fetch(`/api/tenant/analytics?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
        .then((r) => r.json())
        .then((j) => {
          if (cancelled) return
          if (j?.ok) {
            setData(j.analytics as TradieAnalytics)
            setState('ready')
          } else {
            setErr(j?.error ?? 'Failed to load')
            setState('error')
          }
        })
        .catch(() => {
          if (!cancelled) {
            setErr('Network error')
            setState('error')
          }
        })
    })()
    return () => {
      cancelled = true
    }
  }, [accessToken, period])

  return (
    <section
      aria-labelledby="activity-heading"
      className="space-y-5 motion-safe:animate-[fade-in_180ms_ease-out_both]"
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2
          id="activity-heading"
          className=" text-[0.7rem] uppercase tracking-[0.08em] font-bold text-text-pri"
        >
          Who&rsquo;s reaching out &amp; what&rsquo;s been processed
        </h2>
        <span className=" text-[0.58rem] uppercase tracking-[0.08em] text-text-dim">
          {periodLabel(period)}
        </span>
      </header>

      {state === 'loading' && <AnalyticsSkeleton />}
      {state === 'error' && (
        <div
          className={`${CARD} border border-amber-700/60 bg-amber-950/30 px-5 py-4 font-mono text-sm text-amber-200`}
        >
          Couldn&rsquo;t load your activity: {err}
        </div>
      )}
      {state === 'ready' && data && (
        <AnalyticsBody data={data} setTab={setTab} onFollowUpCold={onFollowUpCold} />
      )}
    </section>
  )
}

// ─── Body ─────────────────────────────────────────────────────────────

function AnalyticsBody({
  data,
  setTab,
  onFollowUpCold,
}: {
  data: TradieAnalytics
  setTab: (tab: NavTab) => void
  onFollowUpCold?: () => void
}) {
  const h = data.headline
  const isEmpty =
    h.totalRequests === 0 &&
    h.totalQuotes === 0 &&
    h.totalChats === 0 &&
    h.totalCalls === 0

  if (isEmpty) {
    return (
      <div className={`${CARD} bg-ink-card border border-ink-line px-5 py-8 text-center`}>
        <div className="font-mono text-sm font-bold text-text-pri">
          No activity yet
        </div>
        <p className="mx-auto mt-2 max-w-sm text-xs text-text-dim">
          Hand out your QuoteMax number above — every text and call lands here as
          a drafted quote, and this is where you&rsquo;ll watch it happen.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <NeedsAttention data={data} setTab={setTab} onFollowUpCold={onFollowUpCold} />

      {/* Communication + throughput counters — the headline volumes. */}
      <div className={`${CARD} overflow-hidden grid grid-cols-2 md:grid-cols-4 gap-px bg-ink-line border border-ink-line`}>
        <Counter label="People texting" value={h.peopleTexting} hint="Unique numbers" />
        <Counter label="People calling" value={h.peopleCalling} hint="Unique callers" />
        <Counter label="Chats" value={h.totalChats} hint="SMS conversations" />
        <Counter label="Calls" value={h.totalCalls} hint="Inbound calls" />
        <Counter label="Requests" value={h.totalRequests} hint="Quote requests" />
        <Counter label="Quotes" value={h.totalQuotes} hint="Generated" />
        <Counter label="Processed" value={h.processedQuotes} hint="Auto-priced" />
        <Counter label="Customers" value={h.uniqueCustomers} hint="Unique people" />
      </div>

      {/* Speed + lead funnel. */}
      <div className="grid gap-5 lg:grid-cols-3">
        <SpeedCard minutes={data.speedToQuoteMinutes} />
        <div className="lg:col-span-2">
          <SplitBars title="Lead funnel" slices={data.funnel} tone="accent" className={CARD} />
        </div>
      </div>

      {/* Weekly trends. */}
      <div className="grid gap-5 md:grid-cols-2">
        <TrendBars
          title="Requests / week"
          points={data.weeklyTrend.map((w) => ({ label: w.label, value: w.intakes }))}
          tone="teal"
          className={CARD}
        />
        <TrendBars
          title="Quotes / week"
          points={data.weeklyTrend.map((w) => ({ label: w.label, value: w.quotes }))}
          tone="accent"
          className={CARD}
        />
      </div>

      {/* Where work comes from + what it is. */}
      <div className="grid gap-5 md:grid-cols-2">
        <SplitBars
          title="Where customers come from"
          slices={data.channelSplit}
          tone="teal"
          className={CARD}
        />
        <SplitBars
          title="Top job types"
          slices={data.topJobTypes}
          tone="accent"
          emptyLabel="No job types yet"
          className={CARD}
        />
      </div>
    </div>
  )
}

// ─── Needs your attention (actionable) ────────────────────────────────

function NeedsAttention({
  data,
  setTab,
  onFollowUpCold,
}: {
  data: TradieAnalytics
  setTab: (tab: NavTab) => void
  onFollowUpCold?: () => void
}) {
  const n = data.needsAttention
  const actions = [
    n.awaitingReview > 0 && {
      count: n.awaitingReview,
      label: n.awaitingReview === 1 ? 'quote to review' : 'quotes to review',
      cta: 'Review',
      onClick: () => setTab('quotes'),
    },
    n.coldChats > 0 && {
      count: n.coldChats,
      label: n.coldChats === 1 ? 'chat went cold' : 'chats went cold',
      cta: 'Follow up',
      // Open Chats filtered to the cold (abandoned) conversations this count
      // refers to, so "Follow up" lands on exactly those rows — not the full
      // 30-row list. Falls back to an unfiltered open when no handler wired.
      onClick: onFollowUpCold ?? (() => setTab('chats')),
    },
    n.inspectionsToBook > 0 && {
      count: n.inspectionsToBook,
      label: n.inspectionsToBook === 1 ? 'job needs a visit' : 'jobs need a visit',
      cta: 'View',
      onClick: () => setTab('quotes'),
    },
  ].filter(Boolean) as {
    count: number
    label: string
    cta: string
    onClick: () => void
  }[]

  if (actions.length === 0) {
    return (
      <div className={`${CARD} flex items-center gap-3 border border-emerald-800/50 bg-emerald-950/20 px-5 py-4`}>
        <span className="h-2 w-2 rounded-full bg-emerald-300" aria-hidden="true" />
        <span className=" text-[0.7rem] uppercase tracking-[0.08em] font-bold text-emerald-200">
          You&rsquo;re all caught up
        </span>
        <span className=" text-[0.6rem] uppercase tracking-[0.08em] text-text-dim">
          No quotes waiting, no cold chats
        </span>
      </div>
    )
  }

  // qm-stagger: these are the "needs your attention" cards, and they land
  // together the moment the analytics fetch resolves. Sequencing them 45ms
  // apart reads as a list being dealt out rather than a block appearing —
  // and because it is decorative it never gates the click, so a card is
  // pressable the instant it paints.
  return (
    <div className="qm-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={a.onClick}
          className={`${CARD} group flex items-center justify-between gap-3 border border-amber-700/50 bg-amber-950/20 px-4 py-3.5 text-left transition-colors hover:border-amber-500/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
        >
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-extrabold leading-none tabular-nums text-amber-300">
              {a.count}
            </span>
            <span className=" text-[0.62rem] uppercase tracking-[0.08em] text-text-sec">
              {a.label}
            </span>
          </span>
          <span className="shrink-0 text-[0.6rem] font-bold uppercase tracking-[0.08em] text-accent transition-transform group-hover:translate-x-0.5">
            {a.cta} &rarr;
          </span>
        </button>
      ))}
    </div>
  )
}

// ─── Primitives ───────────────────────────────────────────────────────

function Counter({
  label,
  value,
  hint,
}: {
  label: string
  value: number
  hint?: string
}) {
  return (
    <div className="bg-ink-card p-4 sm:p-5">
      <div className=" text-[0.58rem] uppercase tracking-[0.08em] text-text-dim">
        {label}
      </div>
      <div className="mt-2 font-mono font-extrabold leading-none text-[clamp(1.4rem,2.6vw,2rem)] tabular-nums text-accent">
        {value.toLocaleString('en-AU')}
      </div>
      {hint && (
        <div className="mt-1.5 text-[0.55rem] uppercase tracking-[0.08em] text-text-sec">
          {hint}
        </div>
      )}
    </div>
  )
}

function SpeedCard({ minutes }: { minutes: number | null }) {
  return (
    <div className={`${CARD} bg-ink-card border border-ink-line p-5`}>
      <div className=" text-[0.6rem] uppercase tracking-[0.08em] text-text-dim">
        Typical time to quote
      </div>
      <div className="mt-3 font-mono font-extrabold leading-none text-[clamp(1.75rem,4vw,2.75rem)] tabular-nums text-accent">
        {formatDuration(minutes)}
      </div>
      <div className="mt-2 text-[0.58rem] uppercase tracking-[0.08em] text-text-sec">
        {minutes == null ? 'No quotes yet' : 'Request → drafted quote'}
      </div>
    </div>
  )
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <div className={`${CARD} h-16 bg-ink-card border border-ink-line qm-shimmer`} />
      <div className={`${CARD} overflow-hidden grid grid-cols-2 md:grid-cols-4 gap-px bg-ink-line border border-ink-line`}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 bg-ink-card qm-shimmer" />
        ))}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div className={`${CARD} h-44 bg-ink-card border border-ink-line qm-shimmer`} />
        <div className={`${CARD} h-44 bg-ink-card border border-ink-line qm-shimmer`} />
      </div>
    </div>
  )
}

// ─── Formatting ───────────────────────────────────────────────────────

function formatDuration(minutes: number | null): string {
  if (minutes == null) return '—'
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${Math.round(minutes)}m`
  if (minutes < 60 * 24) {
    const h = minutes / 60
    return `${h % 1 === 0 ? h : h.toFixed(1)}h`
  }
  return `${Math.round(minutes / (60 * 24))}d`
}
