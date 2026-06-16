// POST /api/tenant/commercial-painting/extract — tenant-scoped (Bearer).
//
// Runs the AI takeoff for a paint run (spec §4): Opus over the plan set
// (+ services layout as access/masking context), Sonnet transcription of
// the painter's measurements doc when present, then the PURE reconciler
// merges the two with per-line source/delta provenance. Persists one
// plan_extractions row (trade='commercial_painting') and advances
// paint_runs.status draft → extracting → ready | failed.
//
// Synchronous with a 300 s ceiling — the proven electrical-estimator
// pattern (Opus over a 15-page set runs minutes; the tab shows staged
// progress and the run survives a tab close via run status polling).
//
// Body: { paintRunId: string }

import { tenantFromBearer, estimatorSupabase } from '@/lib/estimation/auth'
import { downloadPaintDoc } from '@/lib/commercial-painting/storage'
import {
  runPaintExtraction,
  runMeasurementParse,
} from '@/lib/commercial-painting/extract'
import { reconcileTakeoff } from '@/lib/commercial-painting/reconcile'
import { pipelineLog } from '@/lib/log/pipeline'
import type { MeasurementLine } from '@/lib/commercial-painting/types'
import { loadKbConfigFromEnv } from '@/lib/admin-loader/mt-filestore-kb'
import { supplementTakeoffViaKb, type KbSupplementFile } from '@/lib/commercial-painting/kb-runner'
import type { PaintSupplementFlag } from '@/lib/commercial-painting/kb-supplement'
import { provisionSessionStore } from '@/lib/filestore/provision'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** An 'extracting' run younger than this is treated as genuinely in
 *  flight; older means the function died without reaching its catch
 *  (maxDuration kill / OOM) and the run is recoverable by retrying. */
const IN_FLIGHT_STALE_MS = 10 * 60 * 1000

/** Per-tenant Opus budget: extractions started in the trailing hour. */
const MAX_EXTRACTIONS_PER_HOUR = 8

type UploadRow = {
  id: string
  filename: string
  doc_type: string | null
  pdf_path: string | null
}

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ ok: false, error: 'unauthorised' }, { status: 401 })

  let body: { paintRunId?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const paintRunId = body.paintRunId?.trim()
  if (!paintRunId) return Response.json({ ok: false, error: 'missing_paintRunId' }, { status: 400 })

  const { data: run } = await estimatorSupabase
    .from('paint_runs')
    .select('id, job_name, site_address, status, updated_at')
    .eq('id', paintRunId)
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (!run) return Response.json({ ok: false, error: 'run_not_found' }, { status: 404 })

  // ── In-flight guard: one extraction per run at a time. ────────────
  if (run.status === 'extracting') {
    const ageMs = Date.now() - new Date(run.updated_at as string).getTime()
    if (Number.isFinite(ageMs) && ageMs < IN_FLIGHT_STALE_MS) {
      return Response.json(
        {
          ok: false,
          error: 'extraction_in_flight',
          detail: 'An extraction is already running for this run — it takes a few minutes. Reload the run to pick up the result.',
        },
        { status: 409 },
      )
    }
    // Stale 'extracting' (function died mid-run): fall through and reclaim.
  }

  // ── Per-tenant Opus budget (cost/quota abuse guard). ──────────────
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: recentCount } = await estimatorSupabase
    .from('plan_extractions')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('trade', 'commercial_painting')
    .gte('created_at', hourAgo)
  if ((recentCount ?? 0) >= MAX_EXTRACTIONS_PER_HOUR) {
    return Response.json(
      {
        ok: false,
        error: 'rate_limited',
        detail: `Takeoff limit reached (${MAX_EXTRACTIONS_PER_HOUR}/hour). Try again shortly.`,
      },
      { status: 429 },
    )
  }

  const { data: uploadRows } = await estimatorSupabase
    .from('plan_uploads')
    .select('id, filename, doc_type, pdf_path')
    .eq('paint_run_id', paintRunId)
    .eq('tenant_id', tenant.id)
  const uploads = (uploadRows ?? []) as UploadRow[]

  const planSet = uploads.find((u) => u.doc_type === 'plan_set' && u.pdf_path)
  if (!planSet) {
    return Response.json(
      { ok: false, error: 'plan_set_required', detail: 'Upload an architectural plan set (or correct a document’s type) before running the takeoff.' },
      { status: 422 },
    )
  }
  const measurementDoc = uploads.find((u) => u.doc_type === 'measurement_takeoff' && u.pdf_path)
  const servicesDoc = uploads.find((u) => u.doc_type === 'services_layout' && u.pdf_path)

  const setStatus = (status: string, note?: string | null) =>
    estimatorSupabase
      .from('paint_runs')
      .update({ status, status_note: note ?? null, updated_at: new Date().toISOString() })
      .eq('id', paintRunId)

  // ── CAS claim: only one concurrent request transitions the run. ───
  const { data: claimed } = await estimatorSupabase
    .from('paint_runs')
    .update({ status: 'extracting', status_note: null, updated_at: new Date().toISOString() })
    .eq('id', paintRunId)
    .eq('status', run.status as string)
    .select('id')
    .maybeSingle()
  if (!claimed) {
    return Response.json(
      { ok: false, error: 'extraction_in_flight', detail: 'Another request just claimed this run.' },
      { status: 409 },
    )
  }

  const log = pipelineLog('estimate', paintRunId)
  log.step('paint takeoff started', {
    tenant: tenant.id,
    uploads: uploads.length,
    hasMeasurements: Boolean(measurementDoc),
    hasServices: Boolean(servicesDoc),
  })

  try {
    const planBytes = await downloadPaintDoc(planSet.pdf_path!)
    const servicesBytes = servicesDoc ? await downloadPaintDoc(servicesDoc.pdf_path!) : null

    const jobHint = [run.job_name, run.site_address].filter(Boolean).join(' — ') || undefined

    // Plan takeoff (Opus) and measurements transcription (Sonnet) are
    // independent — run them concurrently.
    const [extraction, measurements] = await Promise.all([
      runPaintExtraction({ planSet: planBytes, servicesLayout: servicesBytes, jobHint }),
      (async () => {
        if (!measurementDoc) return null
        const bytes = await downloadPaintDoc(measurementDoc.pdf_path!)
        return runMeasurementParse({ pdf: bytes })
      })(),
    ])

    if (!extraction.parsed || extraction.parsed.items.length === 0) {
      log.err('paint takeoff unparseable', undefined, { model: extraction.model, runtime: extraction.runtimeSeconds })
      await setStatus('failed', `The model could not produce a takeoff from the plan set. ${extraction.raw.slice(0, 280)}`)
      return Response.json(
        { ok: false, error: 'extraction_unparseable', model: extraction.model },
        { status: 502 },
      )
    }

    const measurementLines: MeasurementLine[] = measurements?.lines ?? []
    const reconciled = reconcileTakeoff(extraction.parsed.items, measurementLines)

    // ── KB file-store supplement (best-effort; spec 2026-06-15) ──────
    // Build a TEMPORARY File Search store from the tradie's own uploaded
    // PDFs, ask it (grounded in those docs) to verify/fill the takeoff
    // under hybrid rules, then delete the store. Any failure (missing KB
    // env, network, indexing timeout) degrades to the reconciled takeoff;
    // it never blocks the extraction. Disable with PAINT_KB_SUPPLEMENT_ENABLED=false.
    let finalItems = reconciled.items
    let kbFlags: PaintSupplementFlag[] = []
    if (process.env.PAINT_KB_SUPPLEMENT_ENABLED !== 'false') {
      try {
        const kbConfig = loadKbConfigFromEnv()
        const kbFiles: KbSupplementFile[] = [
          { name: planSet.filename || 'plan-set.pdf', bytes: planBytes, mime: 'application/pdf' },
        ]
        if (servicesBytes && servicesDoc) {
          kbFiles.push({ name: servicesDoc.filename || 'services-layout.pdf', bytes: servicesBytes, mime: 'application/pdf' })
        }
        if (measurementDoc) {
          try {
            const measBytes = await downloadPaintDoc(measurementDoc.pdf_path!)
            kbFiles.push({ name: measurementDoc.filename || 'measurements.pdf', bytes: measBytes, mime: 'application/pdf' })
          } catch {
            // skip the measurement doc if it cannot be re-fetched for the KB
          }
        }
        const sup = await supplementTakeoffViaKb({
          config: kbConfig,
          items: reconciled.items,
          jobHint,
          displayName: `paint-temp-${paintRunId}`,
          files: kbFiles,
        })
        finalItems = sup.items
        kbFlags = sup.flags
        log.step('paint takeoff kb-supplement', {
          usedKb: sup.usedKb,
          kbFlags: kbFlags.length,
          items: finalItems.length,
        })
      } catch (e) {
        log.step('paint takeoff kb-supplement skipped', {
          reason: e instanceof Error ? e.message : String(e),
        })
      }
    }

    const runtime = extraction.runtimeSeconds + (measurements?.runtimeSeconds ?? 0)
    const { data: extRow, error: extErr } = await estimatorSupabase
      .from('plan_extractions')
      .insert({
        plan_upload_id: planSet.id,
        tenant_id: tenant.id,
        trade: 'commercial_painting',
        paint_run_id: paintRunId,
        items: finalItems,
        sheets_used: {
          job: extraction.parsed.job,
          finishes_schedule: extraction.parsed.finishes_schedule,
          measurement_line_count: measurementLines.length,
          measurement_parse_failed: Boolean(measurementDoc && !measurements?.lines),
          flags: reconciled.flags,
          kb_flags: kbFlags,
        },
        overall_note: extraction.parsed.overall_note || null,
        model: extraction.model,
        runtime_seconds: Math.round(runtime * 100) / 100,
      })
      .select('id')
      .single()
    if (extErr || !extRow) {
      await setStatus('failed', extErr?.message ?? 'extraction insert failed')
      return Response.json(
        { ok: false, error: 'extraction_insert_failed', detail: extErr?.message ?? 'no row' },
        { status: 500 },
      )
    }

    // Backfill job facts the model read off the cover sheet.
    const jobUpdates: Record<string, string> = {}
    if (!run.job_name && extraction.parsed.job.name) jobUpdates.job_name = extraction.parsed.job.name
    if (!run.site_address && extraction.parsed.job.address) jobUpdates.site_address = extraction.parsed.job.address
    await estimatorSupabase
      .from('paint_runs')
      .update({ ...jobUpdates, status: 'ready', status_note: null, updated_at: new Date().toISOString() })
      .eq('id', paintRunId)

    // Index the tradie's uploaded plans into this run's persistent store so the
    // estimator chatbot can answer questions grounded in them. Runs after the
    // response; de-dupes against anything already indexed for the run.
    provisionSessionStore({
      estimator: 'paint',
      sessionId: paintRunId,
      label: (run.job_name as string | null) ?? null,
      documents: [
        { name: planSet.filename || 'plan-set.pdf', bytes: planBytes, mime: 'application/pdf' },
        ...(servicesBytes && servicesDoc
          ? [{ name: servicesDoc.filename || 'services-layout.pdf', bytes: servicesBytes, mime: 'application/pdf' }]
          : []),
      ],
    })

    log.ok('paint takeoff ready', {
      model: extraction.model,
      runtime: runtime,
      items: finalItems.length,
      flags: reconciled.flags.length,
      kbFlags: kbFlags.length,
      measurementLines: measurementLines.length,
    })

    return Response.json({
      ok: true,
      extractionId: extRow.id,
      items: finalItems,
      flags: reconciled.flags,
      kbFlags,
      finishesSchedule: extraction.parsed.finishes_schedule,
      job: extraction.parsed.job,
      overallNote: extraction.parsed.overall_note,
      measurementLineCount: measurementLines.length,
      measurementParseFailed: Boolean(measurementDoc && !measurements?.lines),
      model: extraction.model,
      runtimeSeconds: runtime,
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    log.err('paint takeoff failed', e)
    await setStatus('failed', detail.slice(0, 300))
    return Response.json({ ok: false, error: 'extraction_failed', detail }, { status: 502 })
  }
}
