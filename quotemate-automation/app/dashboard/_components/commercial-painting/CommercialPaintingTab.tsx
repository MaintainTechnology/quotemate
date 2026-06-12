'use client'

// Commercial Painting tab — upload → classify → AI takeoff (+
// reconciliation) → confirm → price → quote (strategy v11).
//
// One workspace, three numbered stages in the Maintain command-centre
// idiom. The run is persisted server-side at every step (paint_runs +
// plan_uploads + plan_extractions), so a reload resumes from the
// history rail rather than losing work.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import type {
  PaintDocType,
  PaintTakeoffItem,
  PricedPaintBom,
  ReconcileFlag,
} from '@/lib/commercial-painting/types'
import { PaintTakeoffEditor } from './PaintTakeoffEditor'
import { PaintPricedSummary } from './PaintPricedSummary'
import { PaintPreviewPanel } from './PaintPreviewPanel'

const API = '/api/tenant/commercial-painting'

const DOC_TYPE_LABELS: Record<PaintDocType, string> = {
  plan_set: 'Plan set',
  measurement_takeoff: 'Measurements',
  services_layout: 'Services layout',
  site_photo: 'Site photo',
  other: 'Other',
}

const DOC_TYPES: PaintDocType[] = [
  'plan_set',
  'measurement_takeoff',
  'services_layout',
  'site_photo',
  'other',
]

/** The extraction really does take minutes on a full drawing set. */
const EXTRACT_STEPS = [
  'Reading the drawing register…',
  'Finding the finishes schedule…',
  'Measuring rooms and ceiling heights…',
  'Building the surface takeoff…',
  'Reconciling against the measurements doc…',
] as const

type UploadRow = {
  id: string
  filename: string
  doc_type: PaintDocType
  size_bytes: number | null
}

type RunRow = {
  id: string
  job_name: string | null
  site_address: string | null
  status: string
  created_at: string
}

type ExtractionState = {
  id: string
  items: PaintTakeoffItem[]
  flags: ReconcileFlag[]
  finishesSchedule: Array<{ code: string; product: string; sheen: string; surfaces: string }>
  overallNote: string
  measurementLineCount: number
  hasCorrections: boolean
}

export default function CommercialPaintingTab({ accessToken }: { accessToken: string | null }) {
  const [runId, setRunId] = useState<string | null>(null)
  const [jobName, setJobName] = useState('')
  const [siteAddress, setSiteAddress] = useState('')
  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [recentRuns, setRecentRuns] = useState<RunRow[]>([])

  const [extraction, setExtraction] = useState<ExtractionState | null>(null)
  const [bom, setBom] = useState<PricedPaintBom | null>(null)

  const [uploading, setUploading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractStep, setExtractStep] = useState(0)
  const [pricing, setPricing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedQuote, setSavedQuote] = useState<{ quoteViewUrl: string; pdfUrl: string | null } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const authed = useCallback(
    (init?: RequestInit): RequestInit => ({
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
    }),
    [accessToken],
  )

  // Walk staged copy while the model reads the set.
  useEffect(() => {
    if (!extracting) return
    const t = setInterval(
      () => setExtractStep((i) => Math.min(i + 1, EXTRACT_STEPS.length - 1)),
      18000,
    )
    return () => clearInterval(t)
  }, [extracting])

  // History rail for resume.
  useEffect(() => {
    if (!accessToken) return
    fetch(`${API}/runs`, authed())
      .then((r) => r.json())
      .then((b) => {
        if (b?.ok) setRecentRuns(b.runs as RunRow[])
      })
      .catch(() => {})
  }, [accessToken, authed])

  const loadRun = useCallback(
    async (id: string) => {
      setErrMsg(null)
      const res = await fetch(`${API}/run/${id}`, authed())
      const body = await res.json()
      if (!body?.ok) {
        setErrMsg('Could not load that run.')
        return
      }
      setRunId(body.run.id)
      setJobName(body.run.job_name ?? '')
      setSiteAddress(body.run.site_address ?? '')
      setUploads(
        (body.uploads as Array<UploadRow & { doc_type: string | null }>).map((u) => ({
          ...u,
          doc_type: (u.doc_type ?? 'other') as PaintDocType,
        })),
      )
      if (body.extraction) {
        const sheets = (body.extraction.sheets_used ?? {}) as {
          finishes_schedule?: ExtractionState['finishesSchedule']
          flags?: ReconcileFlag[]
          measurement_line_count?: number
        }
        const corrected = body.extraction.corrected_items as PaintTakeoffItem[] | null
        setExtraction({
          id: body.extraction.id,
          items:
            Array.isArray(corrected) && corrected.length > 0
              ? corrected
              : ((body.extraction.items ?? []) as PaintTakeoffItem[]),
          flags: sheets.flags ?? [],
          finishesSchedule: sheets.finishes_schedule ?? [],
          overallNote: body.extraction.overall_note ?? '',
          measurementLineCount: sheets.measurement_line_count ?? 0,
          hasCorrections: Array.isArray(corrected) && corrected.length > 0,
        })
        setBom((body.extraction.priced_bom as PricedPaintBom | null) ?? null)
      } else {
        setExtraction(null)
        setBom(null)
      }
    },
    [authed],
  )

  // ── Stage 1: documents ─────────────────────────────────────────────
  async function uploadFiles(files: FileList | File[]) {
    const list = [...files]
    if (list.length === 0) return
    setUploading(true)
    setErrMsg(null)
    try {
      const fd = new FormData()
      for (const f of list) fd.append('files', f)
      if (jobName.trim()) fd.append('job_name', jobName.trim())
      if (siteAddress.trim()) fd.append('site_address', siteAddress.trim())
      if (runId) fd.append('paint_run_id', runId)
      const res = await fetch(`${API}/upload`, authed({ method: 'POST', body: fd }))
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setErrMsg(
          body?.error === 'file_too_large'
            ? `${body.filename} is over 32 MB.`
            : body?.error === 'unsupported_type'
              ? `${body.filename} isn’t a PDF or image.`
              : 'Upload failed. Please try again.',
        )
        return
      }
      setRunId(body.paintRunId)
      setUploads((prev) => [
        ...prev,
        ...(body.uploads as Array<UploadRow & { doc_type: string }>).map((u) => ({
          ...u,
          doc_type: u.doc_type as PaintDocType,
        })),
      ])
    } catch {
      setErrMsg('Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  async function setDocType(uploadId: string, docType: PaintDocType) {
    setUploads((prev) => prev.map((u) => (u.id === uploadId ? { ...u, doc_type: docType } : u)))
    await fetch(`${API}/upload/${uploadId}`, authed({
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doc_type: docType }),
    })).catch(() => {})
  }

  async function removeUpload(uploadId: string) {
    setUploads((prev) => prev.filter((u) => u.id !== uploadId))
    await fetch(`${API}/upload/${uploadId}`, authed({ method: 'DELETE' })).catch(() => {})
  }

  const hasPlanSet = uploads.some((u) => u.doc_type === 'plan_set')

  // ── Stage 2: AI takeoff ────────────────────────────────────────────
  async function runTakeoff() {
    if (!runId) return
    setExtracting(true)
    setExtractStep(0)
    setErrMsg(null)
    setBom(null)
    try {
      const res = await fetch(`${API}/extract`, authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paintRunId: runId }),
      }))
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setErrMsg(
          body?.error === 'plan_set_required'
            ? 'Mark one document as the plan set first.'
            : 'The takeoff failed — you can retry. Nothing was lost.',
        )
        return
      }
      setExtraction({
        id: body.extractionId,
        items: body.items as PaintTakeoffItem[],
        flags: body.flags as ReconcileFlag[],
        finishesSchedule: body.finishesSchedule ?? [],
        overallNote: body.overallNote ?? '',
        measurementLineCount: body.measurementLineCount ?? 0,
        hasCorrections: false,
      })
      if (body.job?.name && !jobName) setJobName(body.job.name)
      if (body.job?.address && !siteAddress) setSiteAddress(body.job.address)
    } catch {
      setErrMsg('The takeoff failed — you can retry. Nothing was lost.')
    } finally {
      setExtracting(false)
    }
  }

  // ── Stage 2→3: confirm + price ─────────────────────────────────────
  async function confirmAndPrice(items: PaintTakeoffItem[]) {
    if (!runId || !extraction) return
    setPricing(true)
    setErrMsg(null)
    try {
      const save = await fetch(`${API}/run/${runId}`, authed({
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ extractionId: extraction.id, corrected_items: items }),
      }))
      const saveBody = await save.json()
      if (!save.ok || !saveBody.ok) {
        setErrMsg('Saving the confirmed takeoff failed. Please try again.')
        return
      }
      setExtraction((prev) => (prev ? { ...prev, items, hasCorrections: true } : prev))
      const res = await fetch(`${API}/price`, authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paintRunId: runId, extractionId: extraction.id }),
      }))
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setErrMsg('Pricing failed. The takeoff is saved — try pricing again.')
        return
      }
      setBom(body.bom as PricedPaintBom)
    } catch {
      setErrMsg('Pricing failed. The takeoff is saved — try pricing again.')
    } finally {
      setPricing(false)
    }
  }

  async function saveAsQuote() {
    if (!runId || !extraction) return
    setSaving(true)
    setErrMsg(null)
    try {
      const res = await fetch(`${API}/save-quote`, authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paintRunId: runId, extractionId: extraction.id }),
      }))
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setErrMsg('Saving the quote failed. The pricing is kept — try again.')
        return
      }
      setSavedQuote({ quoteViewUrl: body.quoteViewUrl, pdfUrl: body.pdfUrl ?? null })
    } catch {
      setErrMsg('Saving the quote failed. The pricing is kept — try again.')
    } finally {
      setSaving(false)
    }
  }

  function resetRun() {
    setRunId(null)
    setJobName('')
    setSiteAddress('')
    setUploads([])
    setExtraction(null)
    setBom(null)
    setSavedQuote(null)
    setErrMsg(null)
  }

  // Low-confidence banner: >50% of m² in low-confidence lines (spec §8).
  const lowShare = (() => {
    if (!extraction) return 0
    const m2 = extraction.items.filter((i) => i.unit === 'm2' && !i.excluded)
    const total = m2.reduce((s, i) => s + i.quantity, 0)
    if (total <= 0) return 0
    return m2.filter((i) => i.confidence === 'low').reduce((s, i) => s + i.quantity, 0) / total
  })()

  const inputClass =
    'w-full border border-ink-line bg-ink-deep px-3.5 py-2.5 text-sm text-text-pri placeholder:text-text-dim outline-none transition-colors focus:border-accent'

  return (
    <div className="space-y-8">
      {errMsg && (
        <p role="alert" className="border border-ink-line border-l-4 border-l-warning bg-ink-card px-4 py-3 text-sm text-text-sec">
          {errMsg}
        </p>
      )}

      {/* ── 01 · Documents ──────────────────────────────────────────── */}
      <section className="border border-ink-line bg-ink-card p-6 sm:p-7">
        <div className="flex items-start gap-5">
          <span className="font-mono text-4xl font-bold leading-none text-accent sm:text-5xl">01</span>
          <div className="min-w-0 flex-1">
            <h3 className="font-extrabold uppercase tracking-tight text-text-pri">Job documents</h3>
            <p className="mt-1 text-sm leading-relaxed text-text-sec">
              Drop the architectural plan set (required) plus anything else you have —
              a painter’s measurement takeoff, services layouts, site photos. Each file
              is auto-classified; correct it if we guessed wrong.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-text-dim">Job name</span>
                <input value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="IGA Swan Street fit-out" className={`mt-1 ${inputClass}`} />
              </label>
              <label className="block">
                <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-text-dim">Site address</span>
                <input value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} placeholder="480 Swan St, Richmond VIC" className={`mt-1 ${inputClass}`} />
              </label>
            </div>

            <label
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void uploadFiles(e.dataTransfer.files) }}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 border border-dashed px-6 py-9 text-center transition-colors ${
                dragOver ? 'border-accent bg-ink' : 'border-ink-line bg-ink-deep hover:border-accent'
              }`}
            >
              <UploadCloud className="h-6 w-6 text-accent" aria-hidden />
              <span className="text-sm text-text-sec">
                Drag PDFs or photos here, or <span className="font-semibold text-accent">browse</span>
              </span>
              <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-text-dim">
                PDF · PNG · JPG · up to 32 MB each
              </span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => { if (e.target.files) void uploadFiles(e.target.files); e.target.value = '' }}
              />
            </label>

            {uploads.length > 0 && (
              <ul className="mt-4 divide-y divide-ink-line border border-ink-line">
                {uploads.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-3 bg-ink-deep px-4 py-3">
                    {u.doc_type === 'site_photo'
                      ? <ImageIcon className="h-4 w-4 shrink-0 text-text-dim" aria-hidden />
                      : <FileText className="h-4 w-4 shrink-0 text-text-dim" aria-hidden />}
                    <span className="min-w-0 flex-1 truncate text-sm text-text-pri" title={u.filename}>{u.filename}</span>
                    <select
                      value={u.doc_type}
                      onChange={(e) => void setDocType(u.id, e.target.value as PaintDocType)}
                      aria-label={`Document type for ${u.filename}`}
                      className="cursor-pointer border border-ink-line bg-ink-card px-2 py-1.5 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-text-sec outline-none focus:border-accent"
                    >
                      {DOC_TYPES.map((t) => (
                        <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void removeUpload(u.id)}
                      aria-label={`Remove ${u.filename}`}
                      className="cursor-pointer p-1 text-text-dim transition-colors hover:text-warning"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => void runTakeoff()}
                disabled={!hasPlanSet || uploading || extracting}
                className="inline-flex cursor-pointer items-center gap-2.5 bg-accent px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
              >
                {extracting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    <span aria-live="polite">{EXTRACT_STEPS[extractStep]}</span>
                  </>
                ) : uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Uploading…
                  </>
                ) : (
                  'Run AI takeoff'
                )}
              </button>
              {!hasPlanSet && uploads.length > 0 && (
                <span className="text-sm text-text-dim">Mark one document as the plan set to continue.</span>
              )}
              {extracting && (
                <span className="text-sm text-text-dim">A full drawing set takes 2–4 minutes.</span>
              )}
              {runId && !extracting && (
                <button type="button" onClick={resetRun} className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-text-dim transition-colors hover:text-text-sec">
                  <Plus className="h-3.5 w-3.5" aria-hidden /> New run
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── 02 · Confirm the takeoff ────────────────────────────────── */}
      {extraction && (
        <section className="border border-ink-line bg-ink-card p-6 sm:p-7">
          <div className="flex items-start gap-5">
            <span className="font-mono text-4xl font-bold leading-none text-accent sm:text-5xl">02</span>
            <div className="min-w-0 flex-1">
              <h3 className="font-extrabold uppercase tracking-tight text-text-pri">Confirm the takeoff</h3>
              <p className="mt-1 text-sm leading-relaxed text-text-sec">
                {extraction.measurementLineCount > 0
                  ? `Reconciled against the painter’s ${extraction.measurementLineCount}-line measurement takeoff — resolve the flags, adjust anything, then price.`
                  : 'Check quantities, systems and heights, then price. Nothing is priced until you confirm.'}
              </p>

              {lowShare > 0.5 && (
                <p role="alert" className="mt-4 border border-ink-line border-l-4 border-l-warning bg-ink-deep px-4 py-3 text-sm text-text-sec">
                  More than half this takeoff’s area is low-confidence. Recommend a site
                  measure before this quote goes anywhere near a tender.
                </p>
              )}

              <PaintTakeoffEditor
                key={extraction.id}
                initialItems={extraction.items}
                flags={extraction.flags}
                finishesSchedule={extraction.finishesSchedule}
                overallNote={extraction.overallNote}
                pricing={pricing}
                onConfirm={(items) => void confirmAndPrice(items)}
              />
            </div>
          </div>
        </section>
      )}

      {/* ── 03 · Tender price ───────────────────────────────────────── */}
      {bom && extraction && runId && (
        <section className="border border-ink-line bg-ink-card p-6 sm:p-7">
          <div className="flex items-start gap-5">
            <span className="font-mono text-4xl font-bold leading-none text-accent sm:text-5xl">03</span>
            <div className="min-w-0 flex-1">
              <h3 className="font-extrabold uppercase tracking-tight text-text-pri">Tender price</h3>
              <PaintPricedSummary bom={bom} />

              <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-ink-line pt-5">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveAsQuote()}
                  className="inline-flex cursor-pointer items-center gap-2.5 bg-accent px-5 py-3 font-mono text-sm font-bold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Saving quote…
                    </>
                  ) : savedQuote ? (
                    'Save again'
                  ) : (
                    'Save as quote'
                  )}
                </button>
                {savedQuote && (
                  <span className="flex flex-wrap items-center gap-4 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.12em]">
                    <a href={savedQuote.quoteViewUrl} target="_blank" rel="noreferrer" className="cursor-pointer text-accent transition-colors hover:text-accent-press">
                      Open quote ↗
                    </a>
                    {savedQuote.pdfUrl && (
                      <a href={savedQuote.pdfUrl} target="_blank" rel="noreferrer" className="cursor-pointer text-accent transition-colors hover:text-accent-press">
                        Tender PDF ↗
                      </a>
                    )}
                  </span>
                )}
              </div>

              <PaintPreviewPanel
                accessToken={accessToken}
                paintRunId={runId}
                hasSitePhoto={uploads.some((u) => u.doc_type === 'site_photo')}
              />
            </div>
          </div>
        </section>
      )}

      {/* ── History rail ────────────────────────────────────────────── */}
      {recentRuns.length > 0 && (
        <section className="border border-ink-line bg-ink-card p-5">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-dim">Recent runs</span>
            <span className="h-px flex-1 bg-ink-line" aria-hidden />
          </div>
          <ul className="mt-3 grid gap-px bg-ink-line sm:grid-cols-2 lg:grid-cols-3">
            {recentRuns.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => void loadRun(r.id)}
                  className="flex w-full cursor-pointer items-center gap-3 bg-ink-deep px-4 py-3 text-left transition-colors hover:bg-ink"
                >
                  <RefreshCw className="h-3.5 w-3.5 shrink-0 text-text-dim" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text-pri">{r.job_name ?? r.site_address ?? 'Untitled run'}</span>
                    <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-text-dim">
                      {new Date(r.created_at).toLocaleDateString('en-AU')} · {r.status}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
