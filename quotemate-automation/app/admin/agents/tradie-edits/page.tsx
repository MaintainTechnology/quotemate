'use client'

// /admin/agents/tradie-edits — Tradie-Override Learning patterns queue.
//
// Loads tradie_edit_patterns by status, renders each as a card with
// the median delta + sample count + observed window. Approve/reject
// works the same as Catalogue QA, just against the other table.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import {
  describeTradiePattern,
  relativeTime,
  type FindingStatus,
  type TradieEditPatternRow,
} from '@/lib/agents/findings'

const STATUS_TABS: FindingStatus[] = ['pending', 'approved', 'rejected', 'applied']

export default function TradieEditsAgentPage() {
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<FindingStatus>('pending')
  const [rows, setRows] = useState<TradieEditPatternRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busyRun, setBusyRun] = useState(false)
  const [busyRow, setBusyRow] = useState<string | null>(null)
  const [runMsg, setRunMsg] = useState<string | null>(null)
  const [lookbackHours, setLookbackHours] = useState(168)

  const load = useCallback(async (t: string, s: FindingStatus) => {
    setErr(null)
    try {
      const res = await fetch(`/api/admin/agents/queue?status=${s}`, {
        headers: { Authorization: `Bearer ${t}` },
        cache: 'no-store',
      })
      const json = (await res.json()) as {
        ok: boolean
        tradie_edit_patterns: TradieEditPatternRow[]
        error?: string
      }
      if (!res.ok || !json.ok) {
        setErr(json.error || `HTTP ${res.status}`)
        return
      }
      setRows(json.tradie_edit_patterns)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    const sb = getBrowserSupabase()
    sb.auth.getSession().then(({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      if (t) void load(t, status)
      else setErr('Not signed in')
    })
  }, [load, status])

  const triggerRun = useCallback(async () => {
    if (!token) return
    setBusyRun(true)
    setRunMsg(null)
    try {
      const res = await fetch('/api/admin/agents/trigger/tradie-learn', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookback_hours: lookbackHours }),
      })
      const json = (await res.json()) as Record<string, unknown>
      if (!res.ok || !json.ok) {
        setRunMsg(`Failed: ${String(json.error ?? `HTTP ${res.status}`)}`)
      } else {
        setRunMsg(
          `Cluster complete · ${String(json.events_seen)} events · ${String(json.patterns_created)} new patterns`,
        )
      }
      await load(token, status)
    } catch (e) {
      setRunMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyRun(false)
    }
  }, [token, load, status, lookbackHours])

  const review = useCallback(
    async (id: string, nextStatus: 'approved' | 'rejected') => {
      if (!token) return
      setBusyRow(id)
      try {
        const res = await fetch(`/api/admin/agents/findings/tradie-edit/${id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        })
        const json = (await res.json()) as { ok: boolean; error?: string }
        if (!res.ok || !json.ok) {
          setErr(json.error || `HTTP ${res.status}`)
        } else {
          setRows((prev) => prev.filter((r) => r.id !== id))
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setBusyRow(null)
      }
    },
    [token],
  )

  return (
    <main className="mx-auto min-h-screen max-w-6xl bg-ink-deep px-5 pb-24 pt-12 text-text-pri sm:px-8">
      <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-text-dim">
        <Link href="/admin/agents" className="hover:text-accent transition-colors">
          QuoteMax &rarr; Admin &rarr; Quality Agents
        </Link>{' '}
        &rarr; Tradie-Learn
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-4 flex-wrap">
        <h1 className="font-extrabold uppercase tracking-[-0.025em] text-[clamp(2rem,4vw,3rem)] leading-[1.05]">
          Tradie-Learn
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-text-dim">
            Lookback (h)
          </label>
          <input
            type="number"
            min={1}
            max={720}
            value={lookbackHours}
            onChange={(e) => setLookbackHours(Math.max(1, parseInt(e.target.value, 10) || 168))}
            className="w-20 border border-ink-line bg-ink-card px-2 py-1.5 font-mono text-xs text-text-pri focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={triggerRun}
            disabled={busyRun || !token}
            className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.16em] border border-accent bg-accent/10 px-4 py-2 text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyRun ? 'Clustering…' : 'Cluster now'}
          </button>
        </div>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-sec">
        Each pass clusters tradie corrections from the last N hours of
        quote follow-up activity. Approving a pattern marks it ready for
        a catalogue or prompt adjustment.
      </p>

      <div className="mt-6 flex flex-wrap gap-2 border-b border-ink-line">
        {STATUS_TABS.map((s) => {
          const active = status === s
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`font-mono text-[0.65rem] font-bold uppercase tracking-[0.16em] px-3 py-2 border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-dim hover:text-text-pri'
              }`}
            >
              {s}
            </button>
          )
        })}
      </div>

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

      <section className="mt-8 space-y-3">
        {rows.length === 0 ? (
          <div className="border border-dashed border-ink-line bg-ink-card px-5 py-8 text-center">
            <div className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-text-dim mb-2">
              {status === 'pending' ? 'no patterns' : `no ${status} patterns`}
            </div>
            <p className="text-sm text-text-sec">
              {status === 'pending'
                ? 'No tradie-edit patterns to review. Cluster a fresh window above.'
                : 'Switch to a different status tab to see other patterns.'}
            </p>
          </div>
        ) : (
          rows.map((r) => (
            <article key={r.id} className="border border-ink-line bg-ink-card p-5">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-accent font-bold">
                  {r.edit_direction.toUpperCase()} · {r.field}
                </div>
                <div className="font-mono text-[0.6rem] text-text-dim">
                  n={r.sample_count} · {relativeTime(r.created_at)}
                </div>
              </div>
              <div className="mt-2 text-sm text-text-pri">
                {describeTradiePattern(r)}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3 font-mono text-[0.6rem] text-text-dim">
                <span>tenant: {r.tenant_id?.slice(0, 8) ?? '—'}…</span>
                <span>
                  observed: {r.observed_period_start?.slice(0, 10) ?? '—'} →{' '}
                  {r.observed_period_end?.slice(0, 10) ?? '—'}
                </span>
                <span>
                  median Δ:{' '}
                  <span className="text-text-pri">
                    {r.median_delta != null
                      ? `${Number(r.median_delta) > 0 ? '+' : ''}${Number(r.median_delta)}`
                      : '—'}
                  </span>
                </span>
              </div>
              {r.status === 'pending' && (
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => review(r.id, 'approved')}
                    disabled={busyRow === r.id}
                    className="font-mono text-[0.6rem] font-bold uppercase tracking-[0.16em] border border-accent bg-accent/10 px-3 py-1.5 text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => review(r.id, 'rejected')}
                    disabled={busyRow === r.id}
                    className="font-mono text-[0.6rem] font-bold uppercase tracking-[0.16em] border border-warning/40 px-3 py-1.5 text-warning transition-colors hover:bg-warning/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              )}
              {r.status !== 'pending' && (
                <div className="mt-3 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-text-dim">
                  {r.status} {r.reviewed_at && `· ${relativeTime(r.reviewed_at)}`}
                </div>
              )}
            </article>
          ))
        )}
      </section>
    </main>
  )
}
