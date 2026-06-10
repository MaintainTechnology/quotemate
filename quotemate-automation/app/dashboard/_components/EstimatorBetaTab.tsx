'use client'

// Estimator (Beta) — upload an electrical plan PDF, get an AI quantity take-off,
// verify each count against the drawing (plan-overlay pins), refine dense items
// with a tiled high-DPI recount, correct, save, and price with a full audit
// trace. The extraction is a live ~1–2 min Claude call via POST
// /api/tenant/estimator/extract; corrections save via PATCH .../extract/[id];
// past uploads load from .../history; dense recounts via .../refine.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { PlanOverlay, type PinLocation } from './PlanOverlay'

type Confidence = 'high' | 'medium' | 'low'
type Item = { type: string; symbol: string; count: number; confidence: Confidence; note?: string; locations?: PinLocation[] }
type Row = { type: string; symbol: string; count: string; confidence: Confidence; note?: string; locations?: PinLocation[] }

type ExtractResponse =
  | {
      ok: true
      extractionId: string
      planUploadId: string
      filename: string
      items: Item[]
      sheetsUsed: string[]
      overallNote: string
      model: string
      runtimeSeconds: number
    }
  | { ok: false; error: string }

type HistoryExtraction = {
  id: string
  items: Item[] | null
  corrected_items: Item[] | null
  sheets_used: string[] | null
  overall_note: string | null
  model: string | null
  runtime_seconds: number | null
  created_at: string
}
type HistoryUpload = {
  id: string
  filename: string
  sheet_hint: string | null
  created_at: string
  plan_extractions: HistoryExtraction[]
}

type PriceTrace = {
  countSource: { confidence?: Confidence; tally?: string }
  matchedSignals: string[]
  baseUnitPriceExGst: number
  markupPct: number
  materialFormula: string
  unitLabourHours: number
  hourlyRate: number
  labourFormula: string
}
type PricedLine = {
  type: string
  count: number
  matched: string
  unitPriceExGst: number
  materialExGst: number
  labourHours: number
  labourExGst: number
  lineExGst: number
  trace: PriceTrace
}
type RefineResponse =
  | { ok: true; page: number; model: string; tiles: number; runtimeSeconds: number; items: { type: string; count: number; locations: PinLocation[] }[] }
  | { ok: false; error: string }
type PricedBom = {
  lines: PricedLine[]
  unmatched: { type: string; count: number }[]
  materialExGst: number
  labourExGst: number
  labourFloorAddedExGst: number
  subtotalExGst: number
  gstExGst: number
  totalIncGst: number
  gstRegistered: boolean
  assumptions: { hourlyRate: number; markupPct: number; minLabourHours: number }
}
type PriceResponse =
  | { ok: true; bom: PricedBom; catalogueSize: number; pricingBookSource: string }
  | { ok: false; error: string }

type Props = { accessToken: string | null }

export function EstimatorBetaTab({ accessToken }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [sheetHint, setSheetHint] = useState('ELECTRICAL / POWER & DATA')
  const [analysing, setAnalysing] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const [extractionId, setExtractionId] = useState<string | null>(null)
  const [filename, setFilename] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [meta, setMeta] = useState<{ model: string; runtimeSeconds: number; sheets: string[]; note: string } | null>(null)

  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const [history, setHistory] = useState<HistoryUpload[]>([])
  const [showHistory, setShowHistory] = useState(false)

  const [pricing, setPricing] = useState(false)
  const [priced, setPriced] = useState<PricedBom | null>(null)
  const [priceInfo, setPriceInfo] = useState<{ catalogueSize: number; source: string } | null>(null)

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [refining, setRefining] = useState(false)
  const [refineNote, setRefineNote] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    if (!accessToken) return
    try {
      const res = await fetch('/api/tenant/estimator/history', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      })
      const json = (await res.json()) as { ok: boolean; uploads?: HistoryUpload[] }
      if (json.ok && json.uploads) setHistory(json.uploads)
    } catch {
      /* history is best-effort */
    }
  }, [accessToken])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const itemsToRows = (items: Item[]): Row[] =>
    items.map((i) => ({
      type: i.type,
      symbol: i.symbol ?? '',
      count: String(i.count ?? 0),
      confidence: i.confidence ?? 'medium',
      note: i.note,
      locations: i.locations,
    }))

  const analyse = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!accessToken || !file) return
      setAnalysing(true)
      setErrMsg(null)
      setSavedAt(null)
      setExtractionId(null)
      setRows([])
      setMeta(null)
      setSelectedIdx(null)
      setRefineNote(null)
      setPriced(null)
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
        setExtractionId(json.extractionId)
        setFilename(json.filename)
        setRows(itemsToRows(json.items))
        setMeta({ model: json.model, runtimeSeconds: json.runtimeSeconds, sheets: json.sheetsUsed, note: json.overallNote })
        void loadHistory()
      } catch (err) {
        setErrMsg(err instanceof Error ? err.message : String(err))
      } finally {
        setAnalysing(false)
      }
    },
    [accessToken, file, sheetHint, loadHistory],
  )

  const save = useCallback(async () => {
    if (!accessToken || !extractionId) return
    setSaving(true)
    setErrMsg(null)
    try {
      // Audit fields (confidence / zone tally / pin locations) ride along so the
      // overlay + pricing trace survive a reload from history.
      const corrected_items = rows.map((r) => ({
        type: r.type,
        symbol: r.symbol,
        count: Number(r.count) || 0,
        confidence: r.confidence,
        note: r.note,
        locations: r.locations,
      }))
      const res = await fetch(`/api/tenant/estimator/extract/${extractionId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ corrected_items }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string }
      if (!json.ok) {
        setErrMsg(json.error || 'Could not save corrections.')
        return
      }
      setSavedAt(Date.now())
      void loadHistory()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [accessToken, extractionId, rows, loadHistory])

  const price = useCallback(async () => {
    if (!accessToken || rows.length === 0) return
    setPricing(true)
    setErrMsg(null)
    setPriced(null)
    try {
      const items = rows.map((r) => ({ type: r.type, count: Number(r.count) || 0, confidence: r.confidence, note: r.note }))
      const res = await fetch('/api/tenant/estimator/price', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const json = (await res.json()) as PriceResponse
      if (!json.ok) {
        setErrMsg(json.error || 'Could not price the take-off.')
        return
      }
      setPriced(json.bom)
      setPriceInfo({ catalogueSize: json.catalogueSize, source: json.pricingBookSource })
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setPricing(false)
    }
  }, [accessToken, rows])

  const loadFromHistory = (u: HistoryUpload) => {
    const ex = u.plan_extractions?.[0]
    if (!ex) return
    setExtractionId(ex.id)
    setFilename(u.filename)
    setRows(itemsToRows(ex.corrected_items ?? ex.items ?? []))
    setMeta({
      model: ex.model ?? '',
      runtimeSeconds: ex.runtime_seconds ?? 0,
      sheets: ex.sheets_used ?? [],
      note: ex.overall_note ?? '',
    })
    setSavedAt(null)
    setErrMsg(null)
    setShowHistory(false)
    setPriced(null)
    setSelectedIdx(null)
    setRefineNote(null)
    // The raw PDF isn't stored server-side — the viewer/refine only work when
    // the selected file IS this upload. Drop a mismatched file to avoid pinning
    // one plan's counts onto another plan's drawing.
    if (file && file.name !== u.filename) setFile(null)
  }

  // The densest pinned page — the default sheet for a tiled recount (usually
  // the RCP grid that made the single-pass count unstable).
  const dominantPage = useMemo(() => {
    const counts = new Map<number, number>()
    for (const r of rows) for (const l of r.locations ?? []) counts.set(l.page, (counts.get(l.page) ?? 0) + 1)
    let best: number | null = null
    let bestCount = 0
    for (const [p, c] of counts) if (c > bestCount) { best = p; bestCount = c }
    return best
  }, [rows])

  /** Tiled high-DPI recount of the low-confidence rows on the dense sheet. */
  const refine = useCallback(async () => {
    if (!accessToken || !file || dominantPage === null) return
    const targetRows = rows.filter((r) => r.confidence === 'low')
    const targets = (targetRows.length > 0 ? targetRows : rows).map((r) => ({
      type: r.type,
      symbol: r.symbol,
      hint: r.note?.slice(0, 200),
    }))
    setRefining(true)
    setErrMsg(null)
    setRefineNote(null)
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
      setRows((rs) =>
        rs.map((r) => {
          const refined = json.items.find((i) => i.type === r.type)
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
      setRefineNote(`Recounted ${json.items.length} item(s) on page ${json.page} across ${json.tiles} tiles in ${json.runtimeSeconds}s (${json.model}).`)
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setRefining(false)
    }
  }, [accessToken, file, rows, dominantPage])

  const setCount = (idx: number, v: string) => {
    setPriced(null)
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, count: v } : r)))
  }

  const totalCount = rows.reduce((s, r) => s + (Number(r.count) || 0), 0)

  return (
    <div className="space-y-7">
      {/* Beta banner */}
      <div className="border border-ink-line border-l-4 border-l-warning bg-ink-card px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="border border-warning px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-warning">Beta</span>
          <span className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-warning">Experimental AI estimate</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-text-sec">
          The AI reads the plan&rsquo;s legend and counts symbols. Dense areas (GPO clusters, downlight grids)
          are the least reliable and come back flagged <span className="text-warning">low</span> — verify every count before quoting.
        </p>
      </div>

      {/* Upload form */}
      <form onSubmit={analyse} className="border border-ink-line bg-ink-card p-7 sm:p-8" aria-busy={analysing}>
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">Plan take-off</div>
        <h3 className="mt-2 font-extrabold uppercase tracking-tight text-xl text-text-pri sm:text-2xl">Upload an electrical plan PDF</h3>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-sec">
          The take-off is a live read of the plan and takes roughly 1&ndash;2 minutes. Counts only — pricing and labour come later.
        </p>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <label className="block">
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-text-dim">Plan PDF</div>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={analysing}
              aria-label="Plan PDF"
              className="mt-2 w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-sm text-text-sec file:mr-4 file:border-0 file:bg-accent file:px-4 file:py-2 file:font-mono file:text-xs file:font-semibold file:uppercase file:tracking-[0.14em] file:text-white hover:file:bg-accent-press disabled:opacity-50"
            />
          </label>
          <label className="block">
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-text-dim">Sheet hint</div>
            <input
              type="text"
              value={sheetHint}
              onChange={(e) => setSheetHint(e.target.value)}
              placeholder="ELECTRICAL / POWER & DATA"
              disabled={analysing}
              aria-label="Sheet hint"
              className="mt-2 w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
            />
          </label>
        </div>

        {errMsg && (
          <div className="mt-5 border border-ink-line border-l-4 border-l-warning bg-ink-deep px-4 py-3">
            <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-warning">Something went wrong</div>
            <p className="mt-1 text-sm text-text-sec">{errMsg}</p>
          </div>
        )}

        <div className="mt-7 flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={analysing || !file || !accessToken}
            className="inline-flex items-center gap-2 bg-accent px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
          >
            {analysing ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-white/40 border-t-white" aria-hidden="true" /> Analysing… ~1–2 min
              </>
            ) : (
              <>Analyse plan <span aria-hidden="true">&rarr;</span></>
            )}
          </button>
          {history.length > 0 && (
            <button type="button" onClick={() => setShowHistory((s) => !s)} disabled={analysing} className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim hover:text-accent disabled:opacity-50">
              {showHistory ? 'Hide history' : `Past uploads (${history.length})`}
            </button>
          )}
        </div>
      </form>

      {/* History list */}
      {showHistory && history.length > 0 && (
        <div className="border border-ink-line bg-ink-card p-6">
          <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-accent">Past uploads</div>
          <ul className="mt-3 divide-y divide-ink-line">
            {history.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <div className="text-sm text-text-pri">{u.filename}</div>
                  <div className="font-mono text-xs text-text-dim">{new Date(u.created_at).toLocaleString()}{u.sheet_hint ? ` · ${u.sheet_hint}` : ''}</div>
                </div>
                <button type="button" onClick={() => loadFromHistory(u)} disabled={!u.plan_extractions?.length} className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-accent hover:text-accent-press disabled:opacity-40">
                  Open →
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Results table */}
      {rows.length > 0 && (
        <div className="border border-ink-line bg-ink-card p-7 sm:p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">Take-off</div>
              <h3 className="mt-2 font-extrabold uppercase tracking-tight text-xl text-text-pri sm:text-2xl">{filename ?? 'Result'}</h3>
              {meta && (
                <p className="mt-2 font-mono text-xs text-text-dim">
                  {meta.model}{meta.runtimeSeconds ? ` · ${meta.runtimeSeconds}s` : ''}{meta.sheets?.length ? ` · ${meta.sheets.join(', ')}` : ''}
                </p>
              )}
            </div>
            {savedAt && !errMsg && <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-teal-glow">✓ Saved</span>}
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-line font-mono text-[0.66rem] uppercase tracking-[0.14em] text-text-dim">
                  <th className="py-2 pr-3 font-semibold">Item</th>
                  <th className="py-2 px-3 font-semibold">Symbol</th>
                  <th className="py-2 px-3 font-semibold">Count</th>
                  <th className="py-2 pl-3 font-semibold">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr
                    key={idx}
                    className={`border-b border-ink-line/60 align-top ${selectedIdx === idx ? 'bg-ink-deep' : ''}`}
                  >
                    <td className="py-2.5 pr-3">
                      <button
                        type="button"
                        onClick={() => setSelectedIdx((s) => (s === idx ? null : idx))}
                        className={`text-left text-sm ${selectedIdx === idx ? 'text-accent' : 'text-text-pri hover:text-accent'}`}
                        title={r.locations?.length ? 'Highlight this item’s pins on the plan' : undefined}
                      >
                        {r.type}
                        {r.locations?.length ? <span className="ml-1.5 font-mono text-[0.6rem] text-text-dim">📍{r.locations.length}</span> : null}
                      </button>
                      {r.note && <div className="mt-0.5 max-w-md text-xs text-text-dim">{r.note}</div>}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-sm text-text-sec">{r.symbol}</td>
                    <td className="py-2.5 px-3">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={r.count}
                        onChange={(e) => setCount(idx, e.target.value)}
                        disabled={saving}
                        aria-label={`${r.type} count`}
                        className="w-20 border border-ink-line bg-ink-deep px-2 py-1.5 font-mono text-sm text-text-pri focus:border-accent focus:outline-none"
                      />
                    </td>
                    <td className="py-2.5 pl-3">
                      <ConfidenceBadge confidence={r.confidence} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-mono text-sm">
                  <td className="py-3 pr-3 font-semibold uppercase tracking-[0.12em] text-text-dim">Total</td>
                  <td />
                  <td className="py-3 px-3 font-semibold text-text-pri">{totalCount}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {meta?.note && (
            <p className="mt-4 border-t border-ink-line pt-4 text-sm text-text-sec">
              <span className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-text-dim">Model note · </span>
              {meta.note}
            </p>
          )}

          {/* Plan overlay viewer — pins every counted symbol on the drawing.
              Needs the original PDF in-memory (it is never stored server-side). */}
          {file && filename === file.name ? (
            <PlanOverlay
              file={file}
              items={rows.map((r) => ({ type: r.type, locations: r.locations }))}
              selectedIdx={selectedIdx}
              onSelect={setSelectedIdx}
            />
          ) : (
            <p className="mt-4 font-mono text-xs text-text-dim">
              Plan viewer &amp; refine need the original PDF — re-select the file above to verify pins on the drawing.
            </p>
          )}

          {refineNote && !errMsg && (
            <p className="mt-3 font-mono text-xs text-teal-glow">✓ {refineNote}</p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button type="button" onClick={save} disabled={saving || !extractionId} className="inline-flex items-center gap-2 bg-accent px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? (<><span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-white/40 border-t-white" aria-hidden="true" /> Saving…</>) : (<>Save corrected counts <span aria-hidden="true">&rarr;</span></>)}
            </button>
            <button type="button" onClick={price} disabled={pricing || rows.length === 0} className="inline-flex items-center gap-2 border border-accent px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-accent transition-colors hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
              {pricing ? (<><span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-accent/40 border-t-accent" aria-hidden="true" /> Pricing…</>) : (<>Price this take-off</>)}
            </button>
            <button
              type="button"
              onClick={refine}
              disabled={refining || !file || filename !== file?.name || dominantPage === null}
              title={dominantPage === null ? 'No pin locations yet — run a fresh analysis first' : `Tiled high-DPI recount of the low-confidence items on page ${dominantPage}`}
              className="inline-flex items-center gap-2 border border-ink-line px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-sec transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {refining ? (<><span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-text-sec/40 border-t-text-sec" aria-hidden="true" /> Refining… ~1 min</>) : (<>Refine dense items</>)}
            </button>
            <span className="font-mono text-xs text-text-dim">Edit counts, then save or price (indicative).</span>
          </div>

          {priced && <PricedPanel bom={priced} info={priceInfo} />}
        </div>
      )}
    </div>
  )
}

function PricedPanel({ bom, info }: { bom: PricedBom; info: { catalogueSize: number; source: string } | null }) {
  const money = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const [openTrace, setOpenTrace] = useState<number | null>(null)
  return (
    <div className="mt-6 border-t border-ink-line pt-6">
      <div className="border border-ink-line border-l-4 border-l-warning bg-ink-deep px-4 py-3">
        <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-warning">Indicative estimate</div>
        <p className="mt-1 text-sm text-text-sec">
          Priced from your electrical catalogue at {money(bom.assumptions.hourlyRate)}/hr labour and {bom.assumptions.markupPct}% markup.
          Items not in your catalogue are flagged below and not priced — add them under Services/Catalogue. Verify before sending.
          Click a line&rsquo;s <span className="font-mono text-xs">how?</span> to see the full calculation chain.
        </p>
      </div>

      {bom.lines.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-line font-mono text-[0.62rem] uppercase tracking-[0.12em] text-text-dim">
                <th className="py-2 pr-3 font-semibold">Item → assembly</th>
                <th className="py-2 px-3 text-right font-semibold">Qty</th>
                <th className="py-2 px-3 text-right font-semibold">Unit</th>
                <th className="py-2 px-3 text-right font-semibold">Material</th>
                <th className="py-2 px-3 text-right font-semibold">Labour</th>
                <th className="py-2 pl-3 text-right font-semibold">Line</th>
              </tr>
            </thead>
            <tbody>
              {bom.lines.map((l, i) => (
                <Fragment key={i}>
                  <tr className="border-b border-ink-line/60">
                    <td className="py-2 pr-3 text-sm text-text-pri">
                      {l.type}
                      <span className="block font-mono text-xs text-text-dim">
                        &rarr; {l.matched}
                        <button
                          type="button"
                          onClick={() => setOpenTrace((s) => (s === i ? null : i))}
                          className={`ml-2 font-semibold uppercase tracking-widest ${openTrace === i ? 'text-accent' : 'text-text-dim hover:text-accent'}`}
                        >
                          how?
                        </button>
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-sm text-text-sec">{l.count}</td>
                    <td className="py-2 px-3 text-right font-mono text-sm text-text-sec">{money(l.unitPriceExGst)}</td>
                    <td className="py-2 px-3 text-right font-mono text-sm text-text-sec">{money(l.materialExGst)}</td>
                    <td className="py-2 px-3 text-right font-mono text-sm text-text-sec">{money(l.labourExGst)}<span className="block text-xs text-text-dim">{l.labourHours}h</span></td>
                    <td className="py-2 pl-3 text-right font-mono text-sm text-text-pri">{money(l.lineExGst)}</td>
                  </tr>
                  {openTrace === i && (
                    <tr className="border-b border-ink-line/60 bg-ink-deep">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="grid gap-2 text-xs sm:grid-cols-2">
                          <div>
                            <div className="font-mono font-semibold uppercase tracking-[0.12em] text-text-dim">1 · Count from drawing</div>
                            <p className="mt-1 text-text-sec">
                              {l.trace.countSource.tally ?? 'No zone tally recorded for this line.'}
                              {l.trace.countSource.confidence && (
                                <span className="ml-1.5 font-mono uppercase text-text-dim">[{l.trace.countSource.confidence} confidence]</span>
                              )}
                            </p>
                          </div>
                          <div>
                            <div className="font-mono font-semibold uppercase tracking-[0.12em] text-text-dim">2 · Catalogue match</div>
                            <p className="mt-1 text-text-sec">
                              &ldquo;{l.type}&rdquo; &rarr; <span className="text-text-pri">{l.matched}</span>
                              {l.trace.matchedSignals.length > 0 && (
                                <span className="block font-mono text-text-dim">matched on: {l.trace.matchedSignals.join(', ')}</span>
                              )}
                            </p>
                          </div>
                          <div>
                            <div className="font-mono font-semibold uppercase tracking-[0.12em] text-text-dim">3 · Material</div>
                            <p className="mt-1 font-mono text-text-sec">{l.trace.materialFormula}</p>
                            <p className="font-mono text-text-dim">base {money(l.trace.baseUnitPriceExGst)}/unit ex-GST + {l.trace.markupPct}% markup</p>
                          </div>
                          <div>
                            <div className="font-mono font-semibold uppercase tracking-[0.12em] text-text-dim">4 · Labour</div>
                            <p className="mt-1 font-mono text-text-sec">{l.trace.labourFormula}</p>
                            <p className="font-mono text-text-dim">{l.trace.unitLabourHours}h/unit at {money(l.trace.hourlyRate)}/h (labour is not marked up)</p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bom.unmatched.length > 0 && (
        <div className="mt-4">
          <div className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-warning">Not priced — not in your catalogue ({bom.unmatched.length})</div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {bom.unmatched.map((u, i) => (
              <li key={i} className="border border-warning/50 px-2 py-1 font-mono text-xs text-text-sec">{u.count}× {u.type}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 border-t border-ink-line pt-4">
        <div className="ml-auto max-w-xs space-y-1.5 font-mono text-sm">
          <SumRow label="Materials" value={money(bom.materialExGst)} />
          <SumRow label="Labour" value={money(bom.labourExGst)} />
          {bom.labourFloorAddedExGst > 0 && <SumRow label="Min-labour top-up" value={money(bom.labourFloorAddedExGst)} />}
          <SumRow label="Subtotal (ex GST)" value={money(bom.subtotalExGst)} />
          {bom.gstRegistered && <SumRow label="GST 10%" value={money(bom.gstExGst)} />}
          <div className="flex items-center justify-between border-t border-ink-line pt-2 text-text-pri">
            <span className="font-semibold uppercase tracking-[0.12em]">Total inc GST</span>
            <span className="text-base font-bold">{money(bom.totalIncGst)}</span>
          </div>
        </div>
      </div>
      {info && (
        <p className="mt-3 text-right font-mono text-[0.66rem] text-text-dim">
          catalogue: {info.catalogueSize} assemblies · pricing book: {info.source}
        </p>
      )}
    </div>
  )
}

function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-text-sec">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const styles: Record<Confidence, string> = {
    high: 'border-teal-glow/60 text-teal-glow',
    medium: 'border-ink-line text-text-sec',
    low: 'border-warning text-warning',
  }
  return (
    <span className={`border px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.12em] ${styles[confidence]}`}>
      {confidence}
    </span>
  )
}
