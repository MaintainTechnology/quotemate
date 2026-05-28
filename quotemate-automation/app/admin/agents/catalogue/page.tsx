'use client'

// /admin/agents/catalogue — Catalogue QA review queue.
//
// Loads pending catalogue_findings, renders each as a card with the
// current → suggested diff, plus approve/reject buttons that PATCH
// /api/admin/agents/findings/catalogue/[id]. "Run now" triggers a
// fresh sweep via the Railway proxy.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import {
  describeCatalogueFinding,
  relativeTime,
  type CatalogueFindingRow,
  type FindingStatus,
} from '@/lib/agents/findings'

const STATUS_TABS: FindingStatus[] = ['pending', 'approved', 'rejected', 'applied']

export default function CatalogueAgentPage() {
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<FindingStatus>('pending')
  const [rows, setRows] = useState<CatalogueFindingRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busyRun, setBusyRun] = useState(false)
  const [busyRow, setBusyRow] = useState<string | null>(null)
  const [runMsg, setRunMsg] = useState<string | null>(null)

  const load = useCallback(async (t: string, s: FindingStatus) => {
    setErr(null)
    try {
      const res = await fetch(`/api/admin/agents/queue?status=${s}`, {
        headers: { Authorization: `Bearer ${t}` },
        cache: 'no-store',
      })
      const json = (await res.json()) as {
        ok: boolean
        catalogue_findings: CatalogueFindingRow[]
        error?: string
      }
      if (!res.ok || !json.ok) {
        setErr(json.error || `HTTP ${res.status}`)
        return
      }
      setRows(json.catalogue_findings)
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
      const res = await fetch('/api/admin/agents/trigger/catalogue', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      })
      const json = (await res.json()) as Record<string, unknown>
      if (!res.ok || !json.ok) {
        setRunMsg(`Failed: ${String(json.error ?? `HTTP ${res.status}`)}`)
      } else {
        setRunMsg(
          `Sweep complete · ${String(json.rows_audited)} rows audited · ${String(json.findings_created)} new findings`,
        )
      }
      await load(token, status)
    } catch (e) {
      setRunMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyRun(false)
    }
  }, [token, load, status])

  const review = useCallback(
    async (id: string, nextStatus: 'approved' | 'rejected') => {
      if (!token) return
      setBusyRow(id)
      try {
        const res = await fetch(`/api/admin/agents/findings/catalogue/${id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        })
        const json = (await res.json()) as { ok: boolean; error?: string }
        if (!res.ok || !json.ok) {
          setErr(json.error || `HTTP ${res.status}`)
        } else {
          // Optimistic local update — drop the row from the current
          // filtered list. Saves a round-trip + feels snappy.
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
          QuoteMate &rarr; Admin &rarr; Quality Agents
        </Link>{' '}
        &rarr; Catalogue QA
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-4 flex-wrap">
        <h1 className="font-extrabold uppercase tracking-[-0.025em] text-[clamp(2rem,4vw,3rem)] leading-[1.05]">
          Catalogue QA
        </h1>
        <button
          type="button"
          onClick={triggerRun}
          disabled={busyRun || !token}
          className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.16em] border border-accent bg-accent/10 px-4 py-2 text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busyRun ? 'Sweeping…' : 'Run a sweep now'}
        </button>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-sec">
        Each sweep walks every active catalogue row, compares against
        supplier truth, and queues findings for your review. Approving a
        finding marks it ready to apply.
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
              {status === 'pending' ? 'queue clear' : `no ${status} findings`}
            </div>
            <p className="text-sm text-text-sec">
              {status === 'pending'
                ? 'No findings to review right now. Trigger a sweep above to scan the catalogue.'
                : `Switch to a different status tab to see findings.`}
            </p>
          </div>
        ) : (
          rows.map((r) => (
            <article key={r.id} className="border border-ink-line bg-ink-card p-5">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-accent font-bold">
                  {r.finding_type.replace(/_/g, ' ')}
                </div>
                <div className="font-mono text-[0.6rem] text-text-dim">
                  confidence {r.confidence ? Number(r.confidence).toFixed(2) : '—'} ·{' '}
                  {relativeTime(r.created_at)}
                </div>
              </div>
              <div className="mt-2 font-mono text-[0.65rem] text-text-sec">
                {r.source_table} · {r.source_row_id.slice(0, 8)}…
              </div>
              <div className="mt-2 text-sm text-text-pri">
                {describeCatalogueFinding(r)}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <DiffBlock label="Current" value={r.current_value} />
                <DiffBlock label="Suggested" value={r.suggested_value} highlight />
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

function DiffBlock({
  label,
  value,
  highlight,
}: {
  label: string
  value: unknown
  highlight?: boolean
}) {
  return (
    <div
      className={`border bg-ink-deep px-3 py-2 ${
        highlight ? 'border-accent/40' : 'border-ink-line'
      }`}
    >
      <div className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-text-dim mb-1">
        {label}
      </div>
      <pre className="font-mono text-[0.7rem] leading-snug text-text-pri whitespace-pre-wrap break-all">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
