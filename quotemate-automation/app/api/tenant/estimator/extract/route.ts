// POST /api/tenant/estimator/extract — Estimator (Beta).
//
// Accepts a multipart upload of one electrical plan PDF, runs the live Claude
// take-off (~1–2 min), persists plan_uploads + plan_extractions for the authed
// tenant, and returns the extracted items for the dashboard to render + edit.
//
// Counts only — no pricing/labour. The raw PDF bytes are not stored (v1).

import { tenantFromBearer, estimatorSupabase as supabase } from '@/lib/estimation/auth'
import { runExtraction } from '@/lib/estimation/extract'
import { resolveFileStoreConfig, createFileStoreClient } from '@/lib/estimation/filestore-client'
import { supplementExtraction } from '@/lib/estimation/supplement'
import { provisionSessionStore } from '@/lib/filestore/provision'

/** File-store supplementation is opt-in (default off). */
function supplementEnabled(): boolean {
  const v = process.env.ESTIMATOR_FILESTORE_SUPPLEMENT_ENABLED
  return v === 'true' || v === '1'
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// The take-off is a single long Claude call (~60–110s); match the intake route.
export const maxDuration = 300

const MAX_PDF_BYTES = 32 * 1024 * 1024

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ ok: false, error: 'expected multipart/form-data' }, { status: 400 })
  }

  const file = form.get('pdf')
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: 'missing "pdf" file' }, { status: 400 })
  }
  if (file.type && file.type !== 'application/pdf') {
    return Response.json({ ok: false, error: 'file must be a PDF' }, { status: 400 })
  }
  if (file.size > MAX_PDF_BYTES) {
    return Response.json(
      { ok: false, error: `PDF too large (${(file.size / 1e6).toFixed(1)} MB; max 32 MB)` },
      { status: 413 },
    )
  }
  const sheetHint = String(form.get('sheet_hint') ?? '').slice(0, 200)
  const pdf = Buffer.from(await file.arrayBuffer())

  // 1. record the upload
  const { data: upload, error: upErr } = await supabase
    .from('plan_uploads')
    .insert({
      tenant_id: tenant.id,
      filename: file.name || 'plan.pdf',
      sheet_hint: sheetHint || null,
      size_bytes: file.size,
    })
    .select('id')
    .single()
  if (upErr || !upload) {
    return Response.json({ ok: false, error: upErr?.message ?? 'could not record upload' }, { status: 500 })
  }

  // 2. run the take-off
  let result
  try {
    result = await runExtraction({ pdf, sheetHint })
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'extraction failed', planUploadId: upload.id },
      { status: 502 },
    )
  }
  if (!result.parsed) {
    return Response.json(
      { ok: false, error: 'the model did not return a readable take-off — try a clearer sheet hint', planUploadId: upload.id },
      { status: 422 },
    )
  }

  // 2b. (opt-in) ephemeral file-store supplementation — verify/correct/fill the
  // extracted counts against the plan's own text, then tear the store down. This
  // never throws and degrades to the original extraction if anything goes wrong.
  let parsed = result.parsed
  if (supplementEnabled()) {
    try {
      const cfg = resolveFileStoreConfig(process.env)
      const client = cfg ? createFileStoreClient(cfg) : null
      const supp = await supplementExtraction({
        parsed,
        pdf,
        filename: file.name || 'plan.pdf',
        client,
      })
      parsed = supp.changes.length > 0 && supp.note
        ? { ...supp.parsed, overall_note: [supp.parsed.overall_note, supp.note].filter(Boolean).join(' — ') }
        : supp.parsed
    } catch {
      // belt-and-braces: supplementExtraction is already non-throwing
      parsed = result.parsed
    }
  }

  // 3. persist the extraction
  const { data: extraction, error: exErr } = await supabase
    .from('plan_extractions')
    .insert({
      plan_upload_id: upload.id,
      tenant_id: tenant.id,
      items: parsed.items,
      sheets_used: parsed.sheets_used,
      overall_note: parsed.overall_note || null,
      model: result.model,
      runtime_seconds: result.runtimeSeconds,
    })
    .select('id, items, sheets_used, overall_note, model, runtime_seconds, created_at')
    .single()
  if (exErr || !extraction) {
    return Response.json({ ok: false, error: exErr?.message ?? 'could not save extraction' }, { status: 500 })
  }

  // Index the uploaded plan into this session's persistent store so the
  // estimator chatbot can later answer questions grounded in it. The raw bytes
  // are otherwise discarded after extraction — this is the only point they
  // exist server-side. Runs after the response; never blocks the take-off.
  provisionSessionStore({
    estimator: 'electrical',
    sessionId: extraction.id,
    documents: [{ name: file.name || 'plan.pdf', bytes: pdf, mime: 'application/pdf' }],
  })

  return Response.json({
    ok: true,
    planUploadId: upload.id,
    extractionId: extraction.id,
    filename: file.name || 'plan.pdf',
    items: parsed.items,
    sheetsUsed: parsed.sheets_used,
    overallNote: parsed.overall_note,
    model: result.model,
    runtimeSeconds: result.runtimeSeconds,
  })
}
