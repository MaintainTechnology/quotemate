'use client'

// Estimator (Beta) — upload an electrical plan PDF, get an AI quantity
// take-off. The tab owns intake (premium drag-and-drop upload) and the run
// history; the results themselves live full-width at
// /dashboard/estimator/[runId]. On a successful analysis the PDF is handed to
// that page in memory (it is never stored server-side) and we navigate there.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { runDeviceCount, runItemCount, runStatus } from '@/lib/estimation/run-status'
import { RunStatusChip } from './estimator/badges'
import { stashPlanFile } from './estimator/plan-file-store'
import { money, type ExtractResponse, type HistoryUpload } from './estimator/types'

type Props = { accessToken: string | null }

export function EstimatorBetaTab({ accessToken }: Props) {
  const router = useRouter()

  const [file, setFile] = useState<File | null>(null)
  const [sheetHint, setSheetHint] = useState('ELECTRICAL / POWER & DATA')
  const [analysing, setAnalysing] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const [history, setHistory] = useState<HistoryUpload[] | null>(null)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/tenant/estimator/history', {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        })
        const json = (await res.json()) as { ok: boolean; uploads?: HistoryUpload[] }
        if (!cancelled) setHistory(json.ok && json.uploads ? json.uploads : [])
      } catch {
        if (!cancelled) setHistory([]) // history is best-effort
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accessToken])

  const acceptFile = (f: File | null | undefined) => {
    if (!f) return
    if (f.type && f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setErrMsg('That file isn’t a PDF — export the plan sheet as PDF and try again.')
      return
    }
    setErrMsg(null)
    setFile(f)
  }

  const analyse = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!accessToken || !file) return
      setAnalysing(true)
      setErrMsg(null)
      try {
        const fd = new FormData()
        fd.append('pdf', file)
        fd.append('sheet_hint', sheetHint)
        const res = await fetch('/api/tenant/estimator/extract', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: fd,
        })
        const json = (await res.json()) as ExtractResponse
        if (!json.ok) {
          setErrMsg(json.error || 'Extraction failed.')
          return
        }
        // Hand the PDF to the run page in memory, then open the full view.
        stashPlanFile(json.extractionId, file)
        router.push(`/dashboard/estimator/${json.extractionId}`)
      } catch (err) {
        setErrMsg(err instanceof Error ? err.message : String(err))
      } finally {
        setAnalysing(false)
      }
    },
    [accessToken, file, sheetHint, router],
  )

  return (
    <div className="space-y-7">
      {/* ── Upload ─────────────────────────────────────────────── */}
      <form
        onSubmit={analyse}
        aria-busy={analysing ? 'true' : 'false'}
        className="border border-ink-line bg-ink-card p-7 motion-safe:animate-[fade-up_220ms_ease-out_both] sm:p-9"
      >
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
          Plan take-off
        </div>
        <h3 className="mt-2 max-w-2xl font-extrabold uppercase tracking-tight text-2xl leading-[1.05] text-text-pri sm:text-3xl">
          From drawing to <span className="text-accent">counted scope</span> in two minutes
        </h3>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-sec">
          Upload an electrical plan PDF. The AI reads the legend, counts every symbol and pins each one to the
          drawing — then you verify, correct and price it from your own catalogue.
        </p>

        {/* Drop zone */}
        <label
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            acceptFile(e.dataTransfer.files?.[0])
          }}
          className={`mt-6 flex cursor-pointer flex-col items-center justify-center gap-2 border border-dashed px-6 py-10 text-center transition-colors has-focus-visible:outline-2 has-focus-visible:outline-accent ${
            dragOver
              ? 'border-accent bg-accent/5'
              : file
                ? 'border-teal-glow/60 bg-ink-deep'
                : 'border-ink-line bg-ink-deep hover:border-accent/60'
          }`}
        >
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => acceptFile(e.target.files?.[0])}
            disabled={analysing}
            aria-label="Plan PDF"
            className="sr-only"
          />
          {file ? (
            <>
              <span className="font-mono text-sm font-semibold text-teal-glow">✓ {file.name}</span>
              <span className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-text-dim">
                {(file.size / 1e6).toFixed(1)} MB · click or drop to swap
              </span>
            </>
          ) : (
            <>
              <span className="font-mono text-2xl text-text-dim" aria-hidden="true">
                ⌖
              </span>
              <span className="text-sm font-semibold text-text-pri">Drop the plan PDF here</span>
              <span className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-text-dim">
                or click to browse · max 32 MB
              </span>
            </>
          )}
        </label>

        <div className="mt-5 grid gap-5 sm:grid-cols-[2fr_1fr]">
          <label className="block">
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
              Sheet hint
            </div>
            <input
              type="text"
              value={sheetHint}
              onChange={(e) => setSheetHint(e.target.value)}
              placeholder="ELECTRICAL / POWER & DATA"
              disabled={analysing}
              aria-label="Sheet hint"
              className="mt-2 w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-text-dim">
              Which sheet matters — the title-block name, e.g. “LIGHTING” or “POWER &amp; DATA”.
            </p>
          </label>
          <div className="flex items-start pt-7">
            <button
              type="submit"
              disabled={analysing || !file || !accessToken}
              className="inline-flex w-full items-center justify-center gap-2 bg-accent px-6 py-3.5 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analysing ? (
                <>
                  <span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-white/40 border-t-white" aria-hidden="true" />
                  Analysing… ~1–2 min
                </>
              ) : (
                <>
                  Analyse plan <span aria-hidden="true">→</span>
                </>
              )}
            </button>
          </div>
        </div>

        {analysing && (
          <p role="status" className="mt-4 font-mono text-xs text-text-dim">
            Live read of the drawing — legend first, then symbol counts, then pin locations. You’ll land on the
            full results view when it’s done.
          </p>
        )}

        {errMsg && (
          <div role="alert" className="mt-5 border border-ink-line border-l-4 border-l-warning bg-ink-deep px-4 py-3">
            <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-warning">
              Something went wrong
            </div>
            <p className="mt-1 text-sm text-text-sec">{errMsg}</p>
          </div>
        )}

        <p className="mt-6 border-t border-ink-line pt-4 text-xs leading-relaxed text-text-dim">
          <span className="border border-warning px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-warning">
            Beta
          </span>{' '}
          The AI reads the plan’s legend and counts symbols. Dense areas (GPO clusters, downlight grids) are the
          least reliable and come back flagged <span className="text-warning">low</span> — verify every count
          before quoting. Your PDF is analysed live and never stored on our servers.
        </p>
      </form>

      {/* ── Run history ────────────────────────────────────────── */}
      <section
        aria-label="Run history"
        className="border border-ink-line bg-ink-card p-7 motion-safe:animate-[fade-up_220ms_ease-out_80ms_both] sm:p-9"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
              Run history
            </div>
            <h3 className="mt-2 font-extrabold uppercase tracking-tight text-xl text-text-pri sm:text-2xl">
              Past analyses
            </h3>
          </div>
          {history && history.length > 0 && (
            <span className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-text-dim">
              last {history.length} upload{history.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {history === null ? (
          <output aria-live="polite" className="mt-5 block py-6 text-center">
            <span className="inline-block h-4 w-4 animate-spin border-2 border-accent/40 border-t-accent align-middle" aria-hidden="true" />
            <span className="ml-3 align-middle font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim">
              Loading history…
            </span>
          </output>
        ) : history.length === 0 ? (
          <div className="mt-5 border border-dashed border-ink-line bg-ink-deep px-6 py-10 text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim">
              No saved runs yet
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-sec">
              Every successful analysis is saved here automatically — counts, corrections and pricing — so you can
              reopen it any time, on any device.
            </p>
          </div>
        ) : (
          <ul className="mt-5 divide-y divide-ink-line border-t border-ink-line">
            {history.map((u) => {
              const ex = u.plan_extractions?.[0]
              const status = ex ? runStatus(ex) : 'draft'
              const items = ex ? runItemCount(ex) : 0
              const devices = ex ? runDeviceCount(ex) : 0
              const total = ex?.priced_total
              return (
                <li key={u.id}>
                  {ex ? (
                    <button
                      type="button"
                      onClick={() => router.push(`/dashboard/estimator/${ex.id}`)}
                      className="group flex w-full flex-wrap items-center gap-x-5 gap-y-2 py-4 text-left transition-colors hover:bg-ink-deep focus-visible:outline-2 focus-visible:outline-accent sm:flex-nowrap"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-text-pri group-hover:text-accent">
                          {u.filename}
                        </span>
                        <span className="mt-0.5 block font-mono text-xs text-text-dim">
                          {new Date(u.created_at).toLocaleString('en-AU')}
                          {u.sheet_hint ? ` · ${u.sheet_hint}` : ''}
                        </span>
                      </span>
                      <span className="font-mono text-xs tabular-nums text-text-sec">
                        {items} lines · {devices} devices
                      </span>
                      {typeof total === 'number' && (
                        <span className="font-mono text-sm font-bold tabular-nums text-accent">{money(total)}</span>
                      )}
                      <RunStatusChip status={status} />
                      <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim transition-colors group-hover:text-accent">
                        Open <span aria-hidden="true">→</span>
                      </span>
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-4 opacity-60">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-text-sec">{u.filename}</span>
                        <span className="mt-0.5 block font-mono text-xs text-text-dim">
                          {new Date(u.created_at).toLocaleString('en-AU')}
                          {u.sheet_hint ? ` · ${u.sheet_hint}` : ''}
                        </span>
                      </span>
                      <span className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-warning">
                        extraction failed
                      </span>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
