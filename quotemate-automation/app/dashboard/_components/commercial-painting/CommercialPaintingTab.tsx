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
  Eye,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import { PlanOverlay } from '../PlanOverlay'
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
  measurementParseFailed: boolean
  hasCorrections: boolean
}

export default function CommercialPaintingTab({ accessToken }: { accessToken: string | null }) {
  const [runId, setRunId] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const [statusNote, setStatusNote] = useState<string | null>(null)
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
  const [savedQuote, setSavedQuote] = useState<{
    quoteViewUrl: string
    pdfUrl: string | null
    delivery?: { attempted: boolean; sent?: boolean; mms?: boolean; reason?: string }
  } | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // ── In-tab document viewer (shared PlanOverlay for PDFs, <img> for
  // photos). Files are fetched once with the auth header and cached for
  // the session — they never round-trip again on page changes.
  const [viewer, setViewer] = useState<
    | { uploadId: string; filename: string; kind: 'pdf'; file: File }
    | { uploadId: string; filename: string; kind: 'image'; objectUrl: string }
    | null
  >(null)
  const [viewerLoading, setViewerLoading] = useState<string | null>(null)
  const fileCache = useRef(new Map<string, { kind: 'pdf'; file: File } | { kind: 'image'; objectUrl: string }>())

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
      setRunStatus((body.run.status as string) ?? null)
      setStatusNote((body.run.status_note as string) ?? null)
      setJobName(body.run.job_name ?? '')
      setSiteAddress(body.run.site_address ?? '')
      setSavedQuote(null)
      setViewer(null)
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
          measurement_parse_failed?: boolean
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
          measurementParseFailed: sheets.measurement_parse_failed === true,
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
  // Three steps: sign (get direct-to-storage URLs), PUT each file
  // straight to Supabase Storage (Vercel 413s any function body over
  // ~4.5 MB, so files can't go through the API), then complete
  // (classify + register).
  async function uploadFiles(files: FileList | File[]) {
    const list = [...files]
    if (list.length === 0) return
    setUploading(true)
    setErrMsg(null)
    const fail = (body: { error?: string; detail?: string; filename?: string } | null, status?: number) => {
      setErrMsg(
        body?.error === 'file_too_large'
          ? `${body.filename} is over 32 MB.`
          : body?.error === 'unsupported_type'
            ? `${body.filename} isn’t a PDF or image.`
            : body?.detail
              ? `Upload failed: ${body.detail}`
              : body?.error
                ? `Upload failed (${body.error}). Please try again.`
                : `Upload failed (HTTP ${status ?? '?'}). Please try again.`,
      )
    }
    try {
      const signRes = await fetch(`${API}/upload/sign`, authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          files: list.map((f) => ({ name: f.name, size: f.size, type: f.type })),
          ...(jobName.trim() ? { job_name: jobName.trim() } : {}),
          ...(siteAddress.trim() ? { site_address: siteAddress.trim() } : {}),
          ...(runId ? { paint_run_id: runId } : {}),
        }),
      }))
      const signBody = await signRes.json().catch(() => null)
      if (!signRes.ok || !signBody?.ok) {
        fail(signBody, signRes.status)
        return
      }
      const targets = signBody.uploads as Array<{ uploadId: string; signedUrl: string }>

      for (let i = 0; i < list.length; i++) {
        const put = await fetch(targets[i].signedUrl, {
          method: 'PUT',
          headers: { 'content-type': list[i].type, 'x-upsert': 'true' },
          body: list[i],
        })
        if (!put.ok) {
          setErrMsg(`Uploading ${list[i].name} failed (HTTP ${put.status}). Please try again.`)
          return
        }
      }

      const res = await fetch(`${API}/upload/complete`, authed({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          paintRunId: signBody.paintRunId,
          files: list.map((f, i) => ({
            uploadId: targets[i].uploadId,
            name: f.name,
            size: f.size,
            type: f.type,
          })),
        }),
      }))
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) {
        fail(body, res.status)
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

  async function openViewer(upload: UploadRow) {
    if (viewer?.uploadId === upload.id) {
      setViewer(null) // toggle off
      return
    }
    const cached = fileCache.current.get(upload.id)
    if (cached) {
      setViewer({ uploadId: upload.id, filename: upload.filename, ...cached })
      return
    }
    setViewerLoading(upload.id)
    setErrMsg(null)
    try {
      // The API hands back a short-lived signed storage URL; the bytes
      // come straight from Supabase (plan sets exceed Vercel's ~4.5 MB
      // function-response cap).
      const res = await fetch(`${API}/upload/${upload.id}/file`, authed())
      const meta = await res.json().catch(() => null)
      if (!res.ok || !meta?.ok || !meta.url) {
        setErrMsg('Could not load that document. Please try again.')
        return
      }
      const fileRes = await fetch(meta.url as string)
      if (!fileRes.ok) {
        setErrMsg('Could not load that document. Please try again.')
        return
      }
      const raw = await fileRes.blob()
      const mime = (meta.mime as string) || raw.type
      const blob = raw.type === mime ? raw : new Blob([raw], { type: mime })
      const entry =
        mime === 'application/pdf'
          ? ({ kind: 'pdf', file: new File([blob], upload.filename, { type: mime }) } as const)
          : ({ kind: 'image', objectUrl: URL.createObjectURL(blob) } as const)
      fileCache.current.set(upload.id, entry)
      setViewer({ uploadId: upload.id, filename: upload.filename, ...entry })
    } catch {
      setErrMsg('Could not load that document. Please try again.')
    } finally {
      setViewerLoading(null)
    }
  }

  async function removeUpload(uploadId: string) {
    try {
      const res = await fetch(`${API}/upload/${uploadId}`, authed({ method: 'DELETE' }))
      const body = await res.json().catch(() => null)
      if (res.status === 409) {
        setErrMsg(
          body?.detail ??
            'This document is the source of the run’s takeoff and can’t be removed. Start a new run instead.',
        )
        return
      }
      if (!res.ok) {
        setErrMsg('Removing the document failed. Please try again.')
        return
      }
      setUploads((prev) => prev.filter((u) => u.id !== uploadId))
      fileCache.current.delete(uploadId)
      setViewer((v) => (v?.uploadId === uploadId ? null : v))
    } catch {
      setErrMsg('Removing the document failed. Please try again.')
    }
  }

  const hasPlanSet = uploads.some((u) => u.doc_type === 'plan_set')

  // ── Stage 2: AI takeoff ────────────────────────────────────────────
  async function runTakeoff() {
    if (!runId) return
    setExtracting(true)
    setExtractStep(0)
    setErrMsg(null)
    setBom(null)
    setSavedQuote(null)
    try {
      // Persist job facts typed after the upload, so they reach the
      // saved quote + tender PDF.
      if (jobName.trim() || siteAddress.trim()) {
        await fetch(`${API}/run/${runId}`, authed({
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ job_name: jobName, site_address: siteAddress }),
        })).catch(() => {})
      }
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
            : body?.error === 'extraction_in_flight'
              ? 'An extraction is already running for this run — it takes a few minutes. Use the run in “Recent runs” to pick up the result.'
              : body?.error === 'rate_limited'
                ? body?.detail ?? 'Takeoff limit reached — try again shortly.'
                : 'The takeoff failed — you can retry. Nothing was lost.',
        )
        if (body?.error !== 'extraction_in_flight') setRunStatus('failed')
        return
      }
      setRunStatus('ready')
      setStatusNote(null)
      setExtraction({
        id: body.extractionId,
        items: body.items as PaintTakeoffItem[],
        flags: body.flags as ReconcileFlag[],
        finishesSchedule: body.finishesSchedule ?? [],
        overallNote: body.overallNote ?? '',
        measurementLineCount: body.measurementLineCount ?? 0,
        measurementParseFailed: body.measurementParseFailed === true,
        hasCorrections: false,
      })
      if (body.job?.name && !jobName) setJobName(body.job.name)
      if (body.job?.address && !siteAddress) setSiteAddress(body.job.address)
    } catch {
      setErrMsg('The takeoff failed or the connection dropped — reopen the run from “Recent runs” in a few minutes to check for a result before retrying.')
    } finally {
      setExtracting(false)
    }
  }

  // ── Stage 2→3: confirm + price ─────────────────────────────────────
  async function confirmAndPrice(items: PaintTakeoffItem[], labourRatePerHr: number | null) {
    if (!runId || !extraction) return
    setPricing(true)
    setErrMsg(null)
    // Edits invalidate the previous pricing AND any quote saved from it.
    setBom(null)
    setSavedQuote(null)
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
        body: JSON.stringify({
          paintRunId: runId,
          extractionId: extraction.id,
          ...(labourRatePerHr != null ? { labourRatePerHr } : {}),
        }),
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
        body: JSON.stringify({
          paintRunId: runId,
          extractionId: extraction.id,
          ...(customerPhone.trim() ? { customerPhone: customerPhone.trim() } : {}),
          ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
        }),
      }))
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setErrMsg('Saving the quote failed. The pricing is kept — try again.')
        return
      }
      setSavedQuote({
        quoteViewUrl: body.quoteViewUrl,
        pdfUrl: body.pdfUrl ?? null,
        delivery: body.delivery ?? undefined,
      })
    } catch {
      setErrMsg('Saving the quote failed. The pricing is kept — try again.')
    } finally {
      setSaving(false)
    }
  }

  function resetRun() {
    setRunId(null)
    setRunStatus(null)
    setStatusNote(null)
    setJobName('')
    setSiteAddress('')
    setUploads([])
    setExtraction(null)
    setBom(null)
    setSavedQuote(null)
    setCustomerName('')
    setCustomerPhone('')
    setViewer(null)
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

      {/* Run-status banners — a resumed run must explain itself. */}
      {runStatus === 'failed' && !extracting && (
        <div role="alert" className="border border-ink-line border-l-4 border-l-warning bg-ink-card px-4 py-3">
          <p className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-warning">
            Last takeoff failed
          </p>
          <p className="mt-1 text-sm text-text-sec">
            {statusNote ?? 'The model could not read the documents.'} Adjust the documents if needed, then run the takeoff again.
          </p>
        </div>
      )}
      {runStatus === 'extracting' && !extracting && (
        <div className="flex flex-wrap items-center gap-3 border border-ink-line border-l-4 border-l-accent bg-ink-card px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />
          <p className="flex-1 text-sm text-text-sec">
            A takeoff is running on the server for this run — it takes a few minutes.
          </p>
          <button
            type="button"
            onClick={() => { if (runId) void loadRun(runId) }}
            className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-accent transition-colors hover:text-accent-press"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Check now
          </button>
        </div>
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
                      onClick={() => void openViewer(u)}
                      aria-label={`View ${u.filename}`}
                      aria-pressed={viewer?.uploadId === u.id}
                      className={`cursor-pointer p-1 transition-colors hover:text-accent ${
                        viewer?.uploadId === u.id ? 'text-accent' : 'text-text-dim'
                      }`}
                    >
                      {viewerLoading === u.id
                        ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        : <Eye className="h-4 w-4" aria-hidden />}
                    </button>
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

            {/* In-tab document viewer — the Estimator's PlanOverlay for
                PDFs (full-page browsing), plain image for site photos. */}
            {viewer && (
              <div className="mt-4">
                <div className="flex items-center gap-3 border border-b-0 border-ink-line bg-ink-deep px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-accent">
                    Viewing · {viewer.filename}
                  </span>
                  <button
                    type="button"
                    onClick={() => setViewer(null)}
                    aria-label="Close viewer"
                    className="cursor-pointer p-1 text-text-dim transition-colors hover:text-text-pri"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                {viewer.kind === 'pdf' ? (
                  <div className="[&>div]:mt-0 [&>div]:border-t">
                    <PlanOverlay file={viewer.file} items={[]} selectedIdx={null} requirePins={false} />
                  </div>
                ) : (
                  <div className="border border-ink-line bg-ink-deep p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={viewer.objectUrl} alt={viewer.filename} className="max-h-[34rem] w-auto" />
                  </div>
                )}
              </div>
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
              <div className="flex flex-wrap items-center gap-4">
                <h3 className="font-extrabold uppercase tracking-tight text-text-pri">Confirm the takeoff</h3>
                {uploads.some((u) => u.doc_type === 'plan_set') && (
                  <button
                    type="button"
                    onClick={() => {
                      const planSet = uploads.find((u) => u.doc_type === 'plan_set')
                      if (planSet) void openViewer(planSet)
                    }}
                    className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-accent transition-colors hover:text-accent-press"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                    {viewer ? 'Close plan viewer' : 'View plan set'}
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-text-sec">
                {extraction.measurementLineCount > 0
                  ? `Reconciled against the painter’s ${extraction.measurementLineCount}-line measurement takeoff — resolve the flags, adjust anything, then price.`
                  : 'Check quantities, systems and heights, then price. Nothing is priced until you confirm.'}
              </p>

              {extraction.measurementParseFailed && (
                <p role="alert" className="mt-4 border border-ink-line border-l-4 border-l-warning bg-ink-deep px-4 py-3 text-sm text-text-sec">
                  The measurements document could not be transcribed, so this takeoff is
                  plan-only — no reconciliation flags were produced. Check quantities
                  against the painter’s takeoff by hand, or re-run after fixing the document.
                </p>
              )}

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
                defaultLabourRate={bom?.labour.ratePerHr ?? null}
                onConfirm={(items, labourRatePerHr) => void confirmAndPrice(items, labourRatePerHr)}
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

              {/* Customer delivery — text the quote + tender PDF (MMS), the
                  same send path as the electrical/plumbing/solar SMS quotes. */}
              <div className="mt-6 border-t border-ink-line pt-5">
                <p className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
                  Text the quote to the customer (optional)
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Customer name (optional)"
                    className={inputClass}
                  />
                  <input
                    type="tel"
                    inputMode="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Customer mobile e.g. 0412 345 678"
                    className={inputClass}
                  />
                </div>
                <p className="mt-2 text-xs text-text-dim">
                  Enter a mobile to send an SMS + the tender PDF (as an MMS) the moment you save.
                  Leave blank to just create the quote and share the link yourself.
                </p>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-4">
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
                  ) : customerPhone.trim() ? (
                    'Save & text quote'
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
                    {savedQuote.delivery?.attempted && savedQuote.delivery.sent && (
                      <span className="text-success">
                        Texted to customer ✓{savedQuote.delivery.mms ? ' (incl. PDF)' : ''}
                      </span>
                    )}
                    {savedQuote.delivery?.attempted && !savedQuote.delivery.sent && (
                      <span className="text-warning">Couldn’t text the customer — share the link above</span>
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
                  disabled={extracting || pricing || saving}
                  onClick={() => void loadRun(r.id)}
                  className="flex w-full cursor-pointer items-center gap-3 bg-ink-deep px-4 py-3 text-left transition-colors hover:bg-ink disabled:cursor-not-allowed disabled:opacity-50"
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
