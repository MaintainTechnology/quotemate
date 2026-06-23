'use client'

// Dashboard → Historical Quotes tab (spec specs/historical-quotes.md, R15).
//
// Five sections, all tenant-scoped via `Authorization: Bearer <accessToken>`
// (same contract as FilesTab): (a) Import a CSV/PDF of past quotes, (b) Review
// the latest import's proposed categorisations, (c) Browse/filter confirmed
// history, (d) Analytics (avg price per job type), (e) Calibration — push
// historical averages into the pricing book after explicit approval.

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Upload, Loader2, TrendingUp, Check, X, SlidersHorizontal } from 'lucide-react'

// Canonical job types — kept local so this client component doesn't import the
// server intake schema (mirrors the dashboard's own local job-type lists).
const JOB_TYPE_OPTIONS = [
  'downlights', 'power_points', 'ceiling_fans', 'smoke_alarms', 'outdoor_lighting',
  'switchboard', 'oven_cooktop', 'ev_charger', 'fault_finding', 'renovation',
  'blocked_drain', 'hot_water', 'tap_repair', 'tap_replace', 'toilet_repair',
  'toilet_replace', 'gas_fitting', 'burst_pipe', 'bathroom_renovation',
  'cctv_inspection', 'prv_install', 'other',
] as const

type BatchRow = {
  id: string
  source_kind: string
  trade: string | null
  job_type: string | null
  job_type_confidence: 'high' | 'medium' | 'low' | null
  raw_description: string | null
  quoted_at: string | null
  price_ex_gst: number | null
  price_inc_gst: number | null
  gst_basis: string
  status: string
}

type Batch = {
  id: string
  source_kind: string
  filename: string | null
  status: string
  row_count: number
  error: string | null
}

type JobTypeStats = {
  job_type: string
  trade: string | null
  count: number
  avg_price_inc_gst: number
  avg_price_ex_gst: number
  min_price_inc_gst: number
  max_price_inc_gst: number
  most_recent_quoted_at: string | null
}

type Proposal = {
  job_type: string
  trade: string
  name: string
  proposed_unit_price_ex_gst: number
  sample_count: number
  existing_price_ex_gst: number | null
  is_new: boolean
}

function money(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })
}

function jobLabel(jt: string | null): string {
  if (!jt) return 'Unclassified'
  return jt.charAt(0).toUpperCase() + jt.slice(1).replace(/_/g, ' ')
}

export function HistoricalQuotesTab({ accessToken }: { accessToken: string | null }) {
  const authHeaders = useCallback(
    (): Record<string, string> => (accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    [accessToken],
  )

  // ── Analytics + browse ────────────────────────────────────────────
  const [analytics, setAnalytics] = useState<JobTypeStats[] | null>(null)
  const [quotes, setQuotes] = useState<BatchRow[] | null>(null)
  const [filterJobType, setFilterJobType] = useState<string>('')
  const [search, setSearch] = useState('')

  const loadAnalytics = useCallback(async () => {
    if (!accessToken) return
    try {
      const res = await fetch('/api/tenant/historical-quotes/analytics', {
        headers: authHeaders(),
        cache: 'no-store',
      })
      if (!res.ok) return
      const json = (await res.json()) as { analytics: JobTypeStats[] }
      setAnalytics(json.analytics ?? [])
    } catch {
      /* best-effort */
    }
  }, [accessToken, authHeaders])

  const loadQuotes = useCallback(async () => {
    if (!accessToken) return
    try {
      const params = new URLSearchParams()
      if (filterJobType) params.set('job_type', filterJobType)
      if (search.trim()) params.set('q', search.trim())
      const res = await fetch(`/api/tenant/historical-quotes?${params.toString()}`, {
        headers: authHeaders(),
        cache: 'no-store',
      })
      if (!res.ok) return
      const json = (await res.json()) as { quotes: BatchRow[] }
      setQuotes(json.quotes ?? [])
    } catch {
      /* best-effort */
    }
  }, [accessToken, authHeaders, filterJobType, search])

  useEffect(() => {
    void (async () => {
      await loadAnalytics()
      await loadQuotes()
    })()
  }, [loadAnalytics, loadQuotes])

  // ── Import + poll + review ────────────────────────────────────────
  const [uploading, setUploading] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [batch, setBatch] = useState<Batch | null>(null)
  const [batchRows, setBatchRows] = useState<BatchRow[]>([])
  const [savingReview, setSavingReview] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<number | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const pollBatch = useCallback(
    (batchId: string) => {
      stopPolling()
      pollRef.current = window.setInterval(async () => {
        try {
          const res = await fetch(`/api/tenant/historical-quotes/batches/${batchId}`, {
            headers: authHeaders(),
            cache: 'no-store',
          })
          if (!res.ok) return
          const json = (await res.json()) as { batch: Batch; rows: BatchRow[] }
          setBatch(json.batch)
          if (json.batch.status === 'awaiting_review') {
            setBatchRows(json.rows)
            stopPolling()
          } else if (json.batch.status === 'failed') {
            setImportError(json.batch.error ?? 'Import failed')
            stopPolling()
          }
        } catch {
          /* keep polling */
        }
      }, 2500)
    },
    [authHeaders, stopPolling],
  )

  useEffect(() => () => stopPolling(), [stopPolling])

  async function onUpload(e: FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file || !accessToken) return
    setUploading(true)
    setImportError(null)
    setBatch(null)
    setBatchRows([])
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/tenant/historical-quotes/import', {
        method: 'POST',
        headers: authHeaders(),
        body: form,
      })
      const json = (await res.json()) as { batchId?: string; error?: string; detail?: string }
      if (!res.ok || !json.batchId) {
        setImportError(json.detail ?? json.error ?? 'Upload failed')
        return
      }
      setBatch({ id: json.batchId, source_kind: '', filename: file.name, status: 'parsing', row_count: 0, error: null })
      pollBatch(json.batchId)
      if (fileRef.current) fileRef.current.value = ''
    } catch {
      setImportError('Upload failed — try again shortly.')
    } finally {
      setUploading(false)
    }
  }

  function setRowJobType(id: string, jobType: string) {
    setBatchRows((rows) => rows.map((r) => (r.id === id ? { ...r, job_type: jobType } : r)))
  }
  function setRowStatus(id: string, status: 'confirmed' | 'rejected') {
    setBatchRows((rows) => rows.map((r) => (r.id === id ? { ...r, status } : r)))
  }
  function setAllStatus(status: 'confirmed' | 'rejected') {
    setBatchRows((rows) => rows.map((r) => ({ ...r, status })))
  }

  async function saveReview() {
    if (!accessToken || batchRows.length === 0) return
    setSavingReview(true)
    try {
      const updates = batchRows
        .filter((r) => r.status === 'confirmed' || r.status === 'rejected')
        .map((r) => ({
          id: r.id,
          job_type: r.job_type ?? undefined,
          status: (r.status === 'confirmed' ? 'confirmed' : 'rejected') as 'confirmed' | 'rejected',
        }))
      if (updates.length === 0) return
      const res = await fetch('/api/tenant/historical-quotes/review', {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ updates }),
      })
      if (res.ok) {
        setBatch(null)
        setBatchRows([])
        await loadAnalytics()
        await loadQuotes()
      }
    } finally {
      setSavingReview(false)
    }
  }

  // ── Calibration ───────────────────────────────────────────────────
  const [proposals, setProposals] = useState<Proposal[] | null>(null)
  const [selectedJobTypes, setSelectedJobTypes] = useState<Set<string>>(new Set())
  const [calibrating, setCalibrating] = useState(false)
  const [calibrationMsg, setCalibrationMsg] = useState<string | null>(null)

  async function previewCalibration() {
    if (!accessToken) return
    setCalibrating(true)
    setCalibrationMsg(null)
    try {
      const res = await fetch('/api/tenant/historical-quotes/calibration/preview', {
        method: 'POST',
        headers: authHeaders(),
      })
      if (!res.ok) return
      const json = (await res.json()) as { proposals: Proposal[] }
      setProposals(json.proposals ?? [])
      setSelectedJobTypes(new Set((json.proposals ?? []).map((p) => p.job_type)))
    } finally {
      setCalibrating(false)
    }
  }

  async function applyCalibration() {
    if (!accessToken || !proposals) return
    const job_types = proposals.map((p) => p.job_type).filter((jt) => selectedJobTypes.has(jt))
    if (job_types.length === 0) return
    setCalibrating(true)
    try {
      const res = await fetch('/api/tenant/historical-quotes/calibration/apply', {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ job_types }),
      })
      const json = (await res.json()) as { applied?: number }
      if (res.ok) {
        setCalibrationMsg(`Applied ${json.applied ?? 0} price${json.applied === 1 ? '' : 's'} to your pricing book.`)
        setProposals(null)
      }
    } finally {
      setCalibrating(false)
    }
  }

  const reviewing = batch && (batch.status === 'awaiting_review' || batchRows.length > 0)
  const importing = batch && !reviewing && batch.status !== 'failed'

  return (
    <div className="max-w-4xl">
      {/* ── Import ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="font-extrabold uppercase tracking-tight text-text-pri text-xl">Historical quotes</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-sec">
          Import your past quotes (a CSV export or PDF) to see what you’ve charged before and price new
          jobs consistently. Your data stays private to your business.
        </p>

        <form onSubmit={onUpload} className="mt-5 flex flex-wrap items-stretch gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.pdf"
            className="flex-1 min-w-[16rem] border border-ink-line bg-ink-card px-3 py-2.5 text-sm text-text-pri file:mr-3 file:border-0 file:bg-ink-deep file:px-3 file:py-1 file:text-text-pri"
          />
          <button
            type="submit"
            disabled={uploading}
            className="inline-flex items-center gap-2 bg-accent px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:bg-accent-press disabled:opacity-50"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? 'Uploading…' : 'Import'}
          </button>
        </form>

        {importError && (
          <div className="mt-4 border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-text-pri">
            {importError}
          </div>
        )}
        {importing && (
          <div className="mt-4 flex items-center gap-2 border border-ink-line bg-ink-card px-4 py-3 text-sm text-text-sec">
            <Loader2 size={14} className="animate-spin text-accent" />
            Parsing and categorising “{batch?.filename}”…
          </div>
        )}
      </section>

      {/* ── Review ─────────────────────────────────────────────────── */}
      {reviewing && (
        <section className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-extrabold uppercase tracking-tight text-text-pri text-lg">
              Review categorisations
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAllStatus('confirmed')}
                className="border border-ink-line px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-text-pri hover:border-accent hover:text-accent"
              >
                Confirm all
              </button>
              <button
                type="button"
                onClick={saveReview}
                disabled={savingReview}
                className="inline-flex items-center gap-2 bg-accent px-4 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-white hover:bg-accent-press disabled:opacity-50"
              >
                {savingReview ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Save review
              </button>
            </div>
          </div>
          <p className="mt-2 text-sm text-text-sec">
            We matched each imported quote to a job type. Correct any that are off, then confirm — only
            confirmed quotes feed your analytics and pricing.
          </p>
          <ul className="mt-4 divide-y divide-ink-line border border-ink-line bg-ink-card">
            {batchRows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text-pri">{r.raw_description ?? '(no description)'}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-text-dim">
                    <span>{money(r.price_inc_gst)} inc GST</span>
                    {r.job_type_confidence ? <span>· {r.job_type_confidence} confidence</span> : null}
                    {r.gst_basis === 'unknown' ? (
                      <span className="text-accent" title="GST basis wasn’t stated — inc-GST assumed">
                        · GST assumed
                      </span>
                    ) : null}
                  </div>
                </div>
                <select
                  value={r.job_type ?? 'other'}
                  onChange={(e) => setRowJobType(r.id, e.target.value)}
                  className="border border-ink-line bg-ink-deep px-2 py-1 text-xs text-text-pri"
                >
                  {JOB_TYPE_OPTIONS.map((jt) => (
                    <option key={jt} value={jt}>
                      {jobLabel(jt)}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Confirm"
                    onClick={() => setRowStatus(r.id, 'confirmed')}
                    className={`inline-flex h-7 w-7 items-center justify-center border ${
                      r.status === 'confirmed'
                        ? 'border-success bg-success/15 text-success'
                        : 'border-ink-line text-text-dim hover:border-success hover:text-success'
                    }`}
                  >
                    <Check size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label="Reject"
                    onClick={() => setRowStatus(r.id, 'rejected')}
                    className={`inline-flex h-7 w-7 items-center justify-center border ${
                      r.status === 'rejected'
                        ? 'border-danger bg-danger/15 text-danger'
                        : 'border-ink-line text-text-dim hover:border-danger hover:text-danger'
                    }`}
                  >
                    <X size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Analytics ──────────────────────────────────────────────── */}
      <section className="mt-12">
        <h3 className="font-extrabold uppercase tracking-tight text-text-pri text-lg">Your pricing by job</h3>
        <p className="mt-2 text-sm text-text-sec">
          Averages across your confirmed history — what you’ve typically charged per job type.
        </p>
        {!analytics || analytics.length === 0 ? (
          <div className="mt-6 border border-ink-line bg-ink-card p-6 text-center text-sm text-text-sec">
            No confirmed history yet. Import and review some quotes to see your averages.
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto border border-ink-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-ink-deep font-mono text-[0.6rem] uppercase tracking-[0.12em] text-text-dim">
                  <th className="px-3 py-2 text-left">Job</th>
                  <th className="px-3 py-2 text-right">Jobs</th>
                  <th className="px-3 py-2 text-right">Avg (inc GST)</th>
                  <th className="px-3 py-2 text-right">Range</th>
                  <th className="px-3 py-2 text-right">Last</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-line bg-ink-card">
                {analytics.map((a) => (
                  <tr key={a.job_type}>
                    <td className="px-3 py-2 text-text-pri">{jobLabel(a.job_type)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-sec">{a.count}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-text-pri">
                      {money(a.avg_price_inc_gst)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-dim">
                      {money(a.min_price_inc_gst)}–{money(a.max_price_inc_gst)}
                    </td>
                    <td className="px-3 py-2 text-right text-text-dim">
                      {a.most_recent_quoted_at ? a.most_recent_quoted_at.slice(0, 7) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Calibration ────────────────────────────────────────────── */}
      <section className="mt-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-extrabold uppercase tracking-tight text-text-pri text-lg">
            Calibrate my pricing book
          </h3>
          <button
            type="button"
            onClick={previewCalibration}
            disabled={calibrating}
            className="inline-flex items-center gap-2 border border-ink-line px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-text-pri hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {calibrating ? <Loader2 size={12} className="animate-spin" /> : <SlidersHorizontal size={12} />}
            Preview
          </button>
        </div>
        <p className="mt-2 text-sm text-text-sec">
          Turn your historical averages into pricing-book entries the AI uses when drafting new quotes.
          Nothing changes until you apply your selection.
        </p>
        {calibrationMsg && (
          <div className="mt-4 border border-success/50 bg-success/10 px-4 py-3 text-sm text-text-pri">
            {calibrationMsg}
          </div>
        )}
        {proposals && (
          proposals.length === 0 ? (
            <div className="mt-4 border border-ink-line bg-ink-card p-5 text-sm text-text-sec">
              Not enough confirmed history yet (need at least 3 quotes for a job type).
            </div>
          ) : (
            <div className="mt-4 border border-ink-line bg-ink-card">
              <ul className="divide-y divide-ink-line">
                {proposals.map((p) => (
                  <li key={p.job_type} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedJobTypes.has(p.job_type)}
                      onChange={(e) =>
                        setSelectedJobTypes((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(p.job_type)
                          else next.delete(p.job_type)
                          return next
                        })
                      }
                      className="h-4 w-4 accent-[var(--accent,#f60)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-text-pri">{p.name}</div>
                      <div className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-text-dim">
                        {p.sample_count} jobs · {p.is_new ? 'new entry' : `was ${money(p.existing_price_ex_gst)} ex GST`}
                      </div>
                    </div>
                    <div className="text-right text-sm font-semibold tabular-nums text-text-pri">
                      {money(p.proposed_unit_price_ex_gst)} <span className="text-text-dim">ex GST</span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end border-t border-ink-line px-4 py-3">
                <button
                  type="button"
                  onClick={applyCalibration}
                  disabled={calibrating || selectedJobTypes.size === 0}
                  className="inline-flex items-center gap-2 bg-accent px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white hover:bg-accent-press disabled:opacity-50"
                >
                  {calibrating ? <Loader2 size={13} className="animate-spin" /> : <TrendingUp size={13} />}
                  Apply to pricing book
                </button>
              </div>
            </div>
          )
        )}
      </section>

      {/* ── Browse ─────────────────────────────────────────────────── */}
      <section className="mt-12">
        <h3 className="font-extrabold uppercase tracking-tight text-text-pri text-lg">Browse history</h3>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={filterJobType}
            onChange={(e) => setFilterJobType(e.target.value)}
            className="border border-ink-line bg-ink-card px-2.5 py-2 text-sm text-text-pri"
          >
            <option value="">All job types</option>
            {JOB_TYPE_OPTIONS.map((jt) => (
              <option key={jt} value={jt}>
                {jobLabel(jt)}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search descriptions…"
            className="flex-1 min-w-[12rem] border border-ink-line bg-ink-card px-3 py-2 text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
          />
        </div>
        {!quotes || quotes.length === 0 ? (
          <div className="mt-6 border border-ink-line bg-ink-card p-6 text-center text-sm text-text-sec">
            No confirmed historical quotes{filterJobType || search ? ' match your filters' : ' yet'}.
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-ink-line border border-ink-line bg-ink-card">
            {quotes.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-text-pri">{q.raw_description ?? '(no description)'}</div>
                  <div className="mt-0.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-text-dim">
                    {jobLabel(q.job_type)}
                    {q.quoted_at ? ` · ${q.quoted_at}` : ''}
                  </div>
                </div>
                <div className="text-right text-sm font-semibold tabular-nums text-text-pri">
                  {money(q.price_inc_gst)} <span className="text-text-dim">inc GST</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
