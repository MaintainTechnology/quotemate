'use client'

// Full-view workspace for one saved estimator run — the premium results
// dashboard at /dashboard/estimator/[runId]. Loads the run, lets the tradie
// verify + edit every line, recount dense sheets, and price the take-off with
// a full audit trail. The plan overlay needs the original PDF: it arrives via
// the in-memory handoff from the tab, or the tradie re-attaches it.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { runStatus, type RunStatus } from '@/lib/estimation/run-status'
import { PlanOverlay } from '../PlanOverlay'
import { RunStatusChip } from './badges'
import { Methodology } from './Methodology'
import { getPlanFile, stashPlanFile } from './plan-file-store'
import { PricedSummary } from './PricedSummary'
import { StatStrip, type Stat } from './StatStrip'
import { TakeoffTable } from './TakeoffTable'
import {
  itemsToRows,
  money,
  rowsToItems,
  type EditableRow,
  type PriceResponse,
  type PricedBom,
  type RefineResponse,
  type RunDetail,
} from './types'

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'not_found' }
  | { phase: 'ready' }

export function RunWorkspace({ runId }: { runId: string }) {
  const router = useRouter()
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' })

  const [run, setRun] = useState<RunDetail | null>(null)
  const [rows, setRows] = useState<EditableRow[]>([])
  const [hasSavedCorrections, setHasSavedCorrections] = useState(false)
  const [dirty, setDirty] = useState(false)

  const [file, setFile] = useState<File | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const [saving, setSaving] = useState(false)
  const [pricing, setPricing] = useState(false)
  const [refining, setRefining] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [priced, setPriced] = useState<PricedBom | null>(null)
  const [pricedAt, setPricedAt] = useState<string | null>(null)
  const [priceInfo, setPriceInfo] = useState<{ catalogueSize: number; source: string } | null>(null)

  // Mount: session → run fetch → seed editor state (+ the handed-off PDF).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = getBrowserSupabase()
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token ?? null
      if (!token) {
        router.replace('/signin')
        return
      }
      if (cancelled) return
      setAccessToken(token)
      try {
        const res = await fetch(`/api/tenant/estimator/extract/${runId}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (res.status === 404) {
          if (!cancelled) setLoad({ phase: 'not_found' })
          return
        }
        const json = (await res.json()) as { ok: boolean; run?: RunDetail; error?: string }
        if (!json.ok || !json.run) {
          if (!cancelled) setLoad({ phase: 'error', message: json.error || 'Could not load this run.' })
          return
        }
        if (cancelled) return
        const r = json.run
        setRun(r)
        setRows(itemsToRows(r.corrected_items ?? r.items ?? []))
        setHasSavedCorrections(Array.isArray(r.corrected_items))
        setPriced(r.priced_bom)
        setPricedAt(r.priced_at)
        setFile(getPlanFile(r.id))
        setLoad({ phase: 'ready' })
      } catch (err) {
        if (!cancelled) setLoad({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [runId, router])

  const onRowsChange = useCallback((next: EditableRow[]) => {
    setRows(next)
    setDirty(true)
    setPriced(null)
    setPricedAt(null)
    setNotice(null)
  }, [])

  const price = useCallback(
    async (token: string) => {
      setPricing(true)
      setErrMsg(null)
      try {
        const res = await fetch('/api/tenant/estimator/price', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // The price route only consumes count provenance — pins stay client-side.
            items: rowsToItems(rows).map((i) => ({ type: i.type, count: i.count, confidence: i.confidence, note: i.note })),
            extractionId: runId,
          }),
        })
        const json = (await res.json()) as PriceResponse
        if (!json.ok) {
          setErrMsg(json.error || 'Could not price the take-off.')
          return false
        }
        setPriced(json.bom)
        setPricedAt(new Date().toISOString())
        setPriceInfo({ catalogueSize: json.catalogueSize, source: json.pricingBookSource })
        setNotice(`Take-off priced — ${money(json.bom.totalIncGst)} inc GST.`)
        return true
      } catch (err) {
        setErrMsg(err instanceof Error ? err.message : String(err))
        return false
      } finally {
        setPricing(false)
      }
    },
    [rows, runId],
  )

  const save = useCallback(async () => {
    if (!accessToken) return
    setSaving(true)
    setErrMsg(null)
    setNotice(null)
    const wasPriced = priced !== null || pricedAt !== null
    try {
      const res = await fetch(`/api/tenant/estimator/extract/${runId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ corrected_items: rowsToItems(rows) }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string }
      if (!json.ok) {
        setErrMsg(json.error || 'Could not save corrections.')
        return
      }
      setDirty(false)
      setHasSavedCorrections(true)
      setNotice('Corrected counts saved.')
      // Saving invalidates the persisted BOM server-side; re-price so the run
      // stays priced without a second click (deterministic — no LLM cost).
      if (wasPriced) await price(accessToken)
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [accessToken, rows, runId, priced, pricedAt, price])

  // The densest pinned page — default target for a tiled recount.
  const dominantPage = useMemo(() => {
    const counts = new Map<number, number>()
    for (const r of rows) for (const l of r.locations ?? []) counts.set(l.page, (counts.get(l.page) ?? 0) + 1)
    let best: number | null = null
    let bestCount = 0
    for (const [p, c] of counts) if (c > bestCount) { best = p; bestCount = c }
    return best
  }, [rows])

  const refine = useCallback(async () => {
    if (!accessToken || !file || dominantPage === null) return
    const targetRows = rows.filter((r) => r.confidence === 'low')
    const targets = (targetRows.length > 0 ? targetRows : rows).map((r) => ({
      type: r.type.trim(),
      symbol: r.symbol,
      hint: r.note?.slice(0, 200),
    }))
    setRefining(true)
    setErrMsg(null)
    setNotice(null)
    try {
      const fd = new FormData()
      fd.append('pdf', file)
      fd.append('page', String(dominantPage))
      fd.append('targets', JSON.stringify(targets))
      const res = await fetch('/api/tenant/estimator/refine', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: fd,
      })
      const json = (await res.json()) as RefineResponse
      if (!json.ok) {
        setErrMsg(json.error || 'Refine failed.')
        return
      }
      setPriced(null)
      setPricedAt(null)
      setDirty(true)
      setRows((rs) =>
        rs.map((r) => {
          // The route trims target types before echoing them back — match trimmed.
          const refined = json.items.find((i) => i.type === r.type.trim())
          if (!refined) return r
          const prev = Number(r.count) || 0
          return {
            ...r,
            count: String(refined.count),
            locations: refined.locations,
            confidence: r.confidence === 'low' ? 'medium' : r.confidence,
            note: `${r.note ? r.note + ' — ' : ''}tiled recount on p${json.page}: ${refined.count}${refined.count !== prev ? ` (was ${prev})` : ''}`,
          }
        }),
      )
      setNotice(
        `Recounted ${json.items.length} item${json.items.length === 1 ? '' : 's'} on page ${json.page} across ${json.tiles} tiles in ${json.runtimeSeconds}s (${json.model}). Save to keep the new counts.`,
      )
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setRefining(false)
    }
  }, [accessToken, file, rows, dominantPage])

  const attachFile = (f: File | null) => {
    if (!f) return
    setFile(f)
    if (run) stashPlanFile(run.id, f)
  }

  if (load.phase === 'loading') {
    return (
      <WorkspaceShell>
        <output aria-live="polite" className="block border border-ink-line bg-ink-card px-6 py-16 text-center">
          <span className="inline-block h-5 w-5 animate-spin border-2 border-accent/40 border-t-accent align-middle" aria-hidden="true" />
          <span className="ml-3 align-middle font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim">
            Loading run…
          </span>
        </output>
      </WorkspaceShell>
    )
  }

  if (load.phase === 'not_found') {
    return (
      <WorkspaceShell>
        <div className="border border-ink-line bg-ink-card p-10">
          <h1 className="font-extrabold uppercase tracking-tight text-2xl text-text-pri">Run not found</h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-text-sec">
            This analysis doesn’t exist or belongs to another account. It may have been deleted.
          </p>
          <Link
            href="/dashboard?tab=estimator"
            className="mt-6 inline-flex items-center gap-2 bg-accent px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press focus-visible:outline-2 focus-visible:outline-accent"
          >
            ← Back to the Estimator
          </Link>
        </div>
      </WorkspaceShell>
    )
  }

  if (load.phase === 'error' || !run) {
    return (
      <WorkspaceShell>
        <div className="border border-ink-line border-l-4 border-l-warning bg-ink-card px-6 py-5">
          <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-warning">
            Something went wrong
          </div>
          <p className="mt-2 text-sm text-text-sec">{load.phase === 'error' ? load.message : 'No run data.'}</p>
        </div>
      </WorkspaceShell>
    )
  }

  const filename = run.plan_uploads?.filename ?? 'Plan'
  const status: RunStatus = priced || pricedAt ? 'priced' : hasSavedCorrections ? 'verified' : runStatus(run)
  const totalDevices = rows.reduce((s, r) => s + (Number(r.count) || 0), 0)
  const lowCount = rows.filter((r) => r.confidence === 'low').length
  const pinCount = rows.reduce((s, r) => s + (r.locations?.length ?? 0), 0)

  const stats: Stat[] = [
    { label: 'Line items', value: String(rows.length), detail: `${pinCount} pins on the plan` },
    {
      label: 'Devices counted',
      value: String(totalDevices),
      detail: run.runtime_seconds ? `read in ${run.runtime_seconds}s` : undefined,
    },
    {
      label: 'To verify',
      value: String(lowCount),
      detail: lowCount > 0 ? 'low-confidence lines' : 'all counts high or medium',
      tone: lowCount > 0 ? 'warning' : 'good',
    },
    priced
      ? { label: 'Estimate inc GST', value: money(priced.totalIncGst), detail: 'indicative — verify before sending', tone: 'accent' }
      : { label: 'Estimate', value: '—', detail: 'price the take-off below', tone: 'default' },
  ]

  return (
    <WorkspaceShell>
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="motion-safe:animate-[fade-up_220ms_ease-out_both]">
        <nav aria-label="Breadcrumb" className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
          <Link href="/dashboard?tab=estimator" className="transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">
            QuoteMate · Estimator
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-text-sec">Run</span>
        </nav>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="font-extrabold uppercase tracking-tight text-2xl text-text-pri sm:text-4xl">
            {filename.replace(/\.pdf$/i, '')}
          </h1>
          <RunStatusChip status={status} />
        </div>
        <p className="mt-2 font-mono text-xs text-text-dim">
          {new Date(run.plan_uploads?.created_at ?? run.created_at).toLocaleString('en-AU')}
          {run.plan_uploads?.sheet_hint ? ` · ${run.plan_uploads.sheet_hint}` : ''}
          {run.model ? ` · ${run.model}` : ''}
          {run.sheets_used?.length ? ` · ${run.sheets_used.join(', ')}` : ''}
        </p>
      </header>

      {/* ── KPI strip ──────────────────────────────────────────── */}
      <div className="motion-safe:animate-[fade-up_220ms_ease-out_60ms_both]">
        <StatStrip stats={stats} />
      </div>

      {errMsg && (
        <div role="alert" className="border border-ink-line border-l-4 border-l-warning bg-ink-card px-4 py-3">
          <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-warning">
            Something went wrong
          </div>
          <p className="mt-1 text-sm text-text-sec">{errMsg}</p>
        </div>
      )}
      {notice && !errMsg && (
        <p role="status" className="font-mono text-xs text-teal-glow">
          ✓ {notice}
        </p>
      )}

      {/* ── Take-off ledger ───────────────────────────────────── */}
      <section
        aria-label="Quantity take-off"
        className="border border-ink-line bg-ink-card p-6 sm:p-8 motion-safe:animate-[fade-up_220ms_ease-out_120ms_both]"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-accent">
              Take-off
            </div>
            <h2 className="mt-1.5 font-extrabold uppercase tracking-tight text-xl text-text-pri sm:text-2xl">
              Quantity ledger
            </h2>
          </div>
          <p className="max-w-sm text-xs leading-relaxed text-text-dim">
            Every line is yours to correct — fix a count, remove a false positive, add what the AI missed. Edits
            invalidate the price until you re-price.
          </p>
        </div>

        <div className="mt-5">
          <TakeoffTable
            rows={rows}
            onRowsChange={onRowsChange}
            selectedIdx={selectedIdx}
            onSelect={setSelectedIdx}
            disabled={saving || refining}
          />
        </div>

        {run.overall_note && (
          <p className="mt-5 border-t border-ink-line pt-4 text-sm text-text-sec">
            <span className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
              Model note ·{' '}
            </span>
            {run.overall_note}
          </p>
        )}

        {/* Plan overlay — needs the original PDF (never stored server-side). */}
        {file ? (
          <>
            {file.name !== filename && (
              <p className="mt-4 font-mono text-xs text-warning">
                Pins were generated from “{filename}” — make sure “{file.name}” is the same drawing.
              </p>
            )}
            <PlanOverlay
              file={file}
              items={rows.map((r) => ({ type: r.type, locations: r.locations }))}
              selectedIdx={selectedIdx}
              onSelect={setSelectedIdx}
            />
          </>
        ) : (
          <div className="mt-5 border border-dashed border-ink-line bg-ink-deep px-5 py-4">
            <p className="text-sm text-text-sec">
              The plan viewer and dense-item recount need the original PDF — it’s never stored on our servers.
            </p>
            <label className="mt-3 inline-flex cursor-pointer items-center gap-3 has-focus-visible:outline-2 has-focus-visible:outline-accent">
              <span className="border border-accent px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-accent transition-colors hover:bg-accent hover:text-white">
                Re-attach {filename}
              </span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                aria-label={`Re-attach ${filename}`}
                onChange={(e) => attachFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        )}
      </section>

      {/* ── Priced BOM ────────────────────────────────────────── */}
      {priced && (
        <section className="border border-ink-line bg-ink-card p-6 sm:p-8">
          <PricedSummary bom={priced} info={priceInfo} pricedAt={pricedAt} />
        </section>
      )}

      {/* ── Transparency ──────────────────────────────────────── */}
      <div className="motion-safe:animate-[fade-up_220ms_ease-out_180ms_both]">
        <Methodology
          model={run.model}
          runtimeSeconds={run.runtime_seconds}
          sheets={run.sheets_used ?? []}
          bom={priced}
        />
      </div>

      {/* ── Sticky action bar ─────────────────────────────────── */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-ink-line bg-ink-deep/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-3">
          <span className="font-mono text-xs tabular-nums text-text-dim">
            {rows.length} lines · {totalDevices} devices
            {dirty && <span className="ml-2 text-warning">● unsaved edits</span>}
          </span>
          {/* Always-mounted polite live region — reliable busy announcements. */}
          <span role="status" className="sr-only">
            {refining
              ? 'Recounting dense items — takes about a minute.'
              : pricing
                ? 'Pricing the take-off…'
                : saving
                  ? 'Saving corrected counts…'
                  : ''}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={refine}
              disabled={refining || saving || !file || dominantPage === null}
              title={
                dominantPage === null
                  ? 'No pin locations on this run — run a fresh analysis to enable recounts'
                  : !file
                    ? 'Re-attach the plan PDF to enable recounts'
                    : `Tiled high-DPI recount of the low-confidence items on page ${dominantPage}`
              }
              className="inline-flex items-center gap-2 border border-ink-line px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-sec transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {refining ? (
                <>
                  <Spinner /> Refining… ~1 min
                </>
              ) : (
                'Refine dense items'
              )}
            </button>
            <button
              type="button"
              onClick={() => accessToken && void price(accessToken)}
              disabled={pricing || saving || rows.length === 0}
              className="inline-flex items-center gap-2 border border-accent px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-accent transition-colors hover:bg-accent hover:text-white focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pricing ? (
                <>
                  <Spinner /> Pricing…
                </>
              ) : priced ? (
                'Re-price'
              ) : (
                'Price this take-off'
              )}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || refining}
              className="inline-flex items-center gap-2 bg-accent px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Spinner light /> Saving…
                </>
              ) : (
                <>
                  Save corrected counts <span aria-hidden="true">→</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  )
}

function Spinner({ light }: { light?: boolean }) {
  return (
    <span
      className={`inline-block h-3.5 w-3.5 animate-spin border-2 ${
        light ? 'border-white/40 border-t-white' : 'border-accent/40 border-t-accent'
      }`}
      aria-hidden="true"
    />
  )
}

function WorkspaceShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-ink-deep px-4 pb-10 pt-8 text-text-pri sm:px-6">
      <div className="mx-auto max-w-screen-2xl space-y-7">{children}</div>
    </main>
  )
}
