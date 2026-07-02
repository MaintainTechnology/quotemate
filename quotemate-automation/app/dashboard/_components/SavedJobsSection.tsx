'use client'

// Dashboard → Quotes tab "Saved jobs" section.
//
// Redesign of the old inline TradeJobsSection strip (page.tsx): same
// /api/tenant/trade-jobs summaries (roofing / solar / painting / commercial
// painting jobs that live OUTSIDE the quotes table), but organised instead of
// stacked — category pills with live counts, a sort control, trade-grouped
// list rows collapsed to five per group, and a per-row delete (two-step
// inline confirm) that calls the route's tenant-scoped DELETE.
//
// Same contract as before: bearer-token fetch, renders nothing until the
// fetch resolves with at least one job.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Trash2 } from 'lucide-react'

type TradeKey = 'roofing' | 'solar' | 'painting' | 'commercial-painting'

// Mirrors the route's TradeJobSummary.
type TradeJobSummary = {
  id: string
  trade: TradeKey
  address: string | null
  headline: string | null
  status: 'confirmed' | 'inspection' | 'draft'
  href: string | null
  createdAt: string | null
}

const TRADE_ORDER: TradeKey[] = ['roofing', 'solar', 'painting', 'commercial-painting']

const TRADE_LABEL: Record<TradeKey, string> = {
  roofing: 'Roofing',
  solar: 'Solar',
  painting: 'Painting',
  'commercial-painting': 'Commercial paint',
}

const TRADE_BADGE: Record<TradeKey, string> = {
  roofing: 'Roof',
  solar: 'Solar',
  painting: 'Paint',
  'commercial-painting': 'Comm',
}

type JobSort = 'newest' | 'oldest' | 'address' | 'status'

const SORTS: { key: JobSort; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'address', label: 'Address A–Z' },
  { key: 'status', label: 'Needs action' },
]

// 'status' sort surfaces what still needs the tradie: drafts first, then
// inspection-routed, confirmed last.
const STATUS_RANK: Record<TradeJobSummary['status'], number> = {
  draft: 0,
  inspection: 1,
  confirmed: 2,
}

// Neutral status pills — the label carries the state. Muted to match the
// de-coloured Quotes sub-tab so the two sibling tabs read as one surface.
const STATUS_PILL: Record<TradeJobSummary['status'], string> = {
  confirmed: 'border-ink-line text-text-sec',
  inspection: 'border-ink-line text-text-dim',
  draft: 'border-ink-line text-text-dim',
}

// Rows shown per trade group before the "Show all N" toggle kicks in.
const GROUP_PREVIEW = 5

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}

function compareJobs(a: TradeJobSummary, b: TradeJobSummary, sort: JobSort): number {
  if (sort === 'oldest') return (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
  if (sort === 'address') {
    // Address-less rows sink to the bottom rather than sorting as ''.
    if (!a.address && !b.address) return 0
    if (!a.address) return 1
    if (!b.address) return -1
    return a.address.localeCompare(b.address)
  }
  if (sort === 'status') {
    const d = STATUS_RANK[a.status] - STATUS_RANK[b.status]
    if (d !== 0) return d
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  }
  // newest
  return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
}

export function SavedJobsSection({
  accessToken,
  renderWhenEmpty = false,
  onCount,
}: {
  accessToken: string | null
  /** When true (the section is its own active sub-tab), render an empty state
   *  instead of collapsing to null once the fetch resolves with zero jobs. */
  renderWhenEmpty?: boolean
  /** Reports the current job count up so a parent tab can show a badge. */
  onCount?: (count: number) => void
}) {
  const [jobs, setJobs] = useState<TradeJobSummary[] | null>(null)
  const [filter, setFilter] = useState<'all' | TradeKey>('all')
  const [sort, setSort] = useState<JobSort>('newest')
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<TradeKey>>(new Set())
  // Two-step delete: first tap arms the row (confirmKey), second tap fires.
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/tenant/trade-jobs', {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (!res.ok) return
        const json = (await res.json()) as { jobs?: TradeJobSummary[] }
        const arr = Array.isArray(json.jobs) ? json.jobs : []
        if (!cancelled) {
          setJobs(arr)
          onCount?.(arr.length)
        }
      } catch {
        /* network error — leave hidden */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accessToken, onCount])

  async function deleteJob(job: TradeJobSummary) {
    if (!accessToken) return
    const key = `${job.trade}:${job.id}`
    setBusyKey(key)
    setDeleteError(null)
    try {
      const res = await fetch('/api/tenant/trade-jobs', {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ trade: job.trade, id: job.id }),
      })
      // 404 = row already gone (deleted in another tab) — treat as success
      // so the stale row can't become a permanently-undeletable phantom.
      if (!res.ok && res.status !== 404) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        setDeleteError(
          res.status === 409 || json.error === 'job_already_paid'
            ? "That job took a deposit — it can't be deleted."
            : 'Could not delete that job — try again shortly.',
        )
        return
      }
      const next = (jobs ?? []).filter(
        (j) => !(j.trade === job.trade && j.id === job.id),
      )
      setJobs(next)
      onCount?.(next.length)
      // Don't strand the tradie on an empty category: if the deleted row was
      // the filtered trade's last job, fall back to 'All'.
      if (filter !== 'all' && !next.some((j) => j.trade === filter)) {
        setFilter('all')
      }
    } catch {
      setDeleteError('Could not delete that job — try again shortly.')
    } finally {
      // Clear only our own keys — another row may have been armed while this
      // request was in flight; wiping unconditionally would disarm it.
      setBusyKey((k) => (k === key ? null : k))
      setConfirmKey((k) => (k === key ? null : k))
    }
  }

  // Not fetched yet → stay invisible (no flash). Fetched-but-empty → a proper
  // empty state when this section is its own active sub-tab, else collapse.
  if (!jobs) return null
  if (jobs.length === 0) {
    if (!renderWhenEmpty) return null
    return (
      <section className="border border-ink-line bg-ink-card px-5 py-10 text-center">
        <div className="font-mono text-[0.7rem] font-bold uppercase tracking-[0.16em] text-text-pri">
          No saved jobs yet
        </div>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-sec">
          Roofing, solar and painting estimates you save from the measure tools
          land here — kept separate from your quote pipeline.
        </p>
      </section>
    )
  }

  const visibleTrades = TRADE_ORDER.filter((t) => jobs.some((j) => j.trade === t))
  const activeTrades = filter === 'all' ? visibleTrades : visibleTrades.filter((t) => t === filter)
  const countFor = (t: TradeKey) => jobs.filter((j) => j.trade === t).length

  const pills: { key: 'all' | TradeKey; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: jobs.length },
    ...visibleTrades.map((t) => ({ key: t, label: TRADE_LABEL[t], count: countFor(t) })),
  ]

  return (
    <section className="border border-ink-line bg-ink-card">
      {/* ── Header: title + count + sort ─────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-line px-5 py-4">
        <div>
          <div className="font-mono text-[0.7rem] font-bold uppercase tracking-[0.16em] text-text-pri">
            Saved jobs
          </div>
          <div className="mt-1 text-xs leading-relaxed text-text-sec">
            {jobs.length} job{jobs.length === 1 ? '' : 's'} across{' '}
            {visibleTrades.length} trade{visibleTrades.length === 1 ? '' : 's'} —
            roofing, solar and painting estimates saved outside the quote pipeline.
          </div>
        </div>
        <label className="flex items-center gap-2 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as JobSort)}
            className="cursor-pointer border border-ink-line bg-ink-card px-2.5 py-2 font-mono text-[0.65rem] font-bold uppercase tracking-[0.14em] text-text-pri focus:border-accent focus:outline-none"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ── Category pills with counts ───────────────────────────── */}
      <div className="flex flex-wrap gap-2 border-b border-ink-line px-5 py-3">
        {pills.map((p) => {
          const active = filter === p.key
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setFilter(p.key)}
              aria-pressed={active}
              className={`inline-flex items-center gap-2 border px-3.5 py-2 font-mono text-[0.65rem] font-bold uppercase tracking-[0.14em] transition-colors cursor-pointer ${
                active
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-ink-line bg-ink-card text-text-dim hover:border-text-dim hover:text-text-pri'
              }`}
            >
              {p.label}
              <span className={active ? 'text-accent' : 'text-text-sec'}>{p.count}</span>
            </button>
          )
        })}
      </div>

      {deleteError && (
        <div
          role="alert"
          className="border-b border-danger/50 bg-danger/10 px-5 py-2.5 text-xs text-text-pri"
        >
          {deleteError}
        </div>
      )}

      {/* ── Trade groups ─────────────────────────────────────────── */}
      {activeTrades.map((t) => {
        const rows = jobs.filter((j) => j.trade === t).sort((a, b) => compareJobs(a, b, sort))
        const expanded = expandedGroups.has(t)
        const shown = expanded ? rows : rows.slice(0, GROUP_PREVIEW)
        return (
          <div key={t} className="border-b border-ink-line last:border-b-0">
            <div className="flex items-center justify-between gap-3 bg-ink-deep/30 px-5 py-2">
              <div className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.16em] text-text-sec">
                {TRADE_LABEL[t]} <span className="text-text-dim">· {rows.length}</span>
              </div>
              {rows.length > GROUP_PREVIEW && (
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() =>
                    setExpandedGroups((prev) => {
                      const next = new Set(prev)
                      if (next.has(t)) next.delete(t)
                      else next.add(t)
                      return next
                    })
                  }
                  className="cursor-pointer font-mono text-[0.6rem] font-bold uppercase tracking-[0.14em] text-accent transition-colors hover:text-accent-press"
                >
                  {expanded ? 'Show less' : `Show all ${rows.length}`}
                </button>
              )}
            </div>
            <ul className="divide-y divide-ink-line">
              {shown.map((job) => {
                const key = `${job.trade}:${job.id}`
                const armed = confirmKey === key
                const busy = busyKey === key
                return (
                  <li
                    key={key}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex shrink-0 items-center border border-ink-line px-1.5 py-0.5 font-mono text-[0.55rem] font-bold uppercase tracking-[0.16em] text-text-dim">
                          {TRADE_BADGE[job.trade]}
                        </span>
                        <span className="truncate text-sm font-semibold text-text-pri">
                          {job.address ?? 'No address'}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-text-dim">
                        {job.headline && (
                          <>
                            <span>{job.headline}</span>
                            <span aria-hidden="true">·</span>
                          </>
                        )}
                        <span
                          className={`border px-2 py-0.5 text-[0.55rem] font-semibold uppercase tracking-[0.12em] ${STATUS_PILL[job.status]}`}
                        >
                          {job.status}
                        </span>
                        {job.createdAt && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{fmtDate(job.createdAt)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {armed ? (
                        <>
                          <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-danger">
                            Delete this job?
                          </span>
                          {/* Both buttons lock while ANY delete is in flight —
                              one shared request slot means a second fire could
                              double-delete or clobber this row's spinner. */}
                          <button
                            type="button"
                            onClick={() => void deleteJob(job)}
                            disabled={busyKey !== null}
                            className="inline-flex min-h-[44px] items-center gap-1.5 border border-danger/60 bg-danger/10 px-3.5 py-2 text-[0.65rem] font-semibold uppercase tracking-wider text-danger transition-colors hover:bg-danger/20 disabled:opacity-50"
                          >
                            {busy ? <Loader2 size={13} className="animate-spin" /> : null}
                            {busy ? 'Deleting…' : 'Delete'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmKey(null)}
                            disabled={busy}
                            className="inline-flex min-h-[44px] items-center border border-ink-line px-3.5 py-2 text-[0.65rem] font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          {job.href ? (
                            <Link
                              href={job.href}
                              target="_blank"
                              className="inline-flex min-h-[44px] items-center gap-1.5 border border-ink-line px-3.5 py-2 text-[0.65rem] font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent"
                            >
                              View →
                            </Link>
                          ) : (
                            <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-text-dim">
                              No link yet
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmKey(key)
                              setDeleteError(null)
                            }}
                            disabled={busyKey !== null}
                            aria-label={`Delete ${TRADE_LABEL[job.trade]} job${
                              job.address ? ` at ${job.address}` : ''
                            }`}
                            className="inline-flex h-11 w-11 items-center justify-center border border-ink-line text-text-dim transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
