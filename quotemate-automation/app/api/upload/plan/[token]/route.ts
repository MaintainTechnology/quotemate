// POST /api/upload/plan/[token] — customer plan-PDF submission (SMS estimator).
//
// Token comes from the SMS link the plan-estimation branch sent
// (plan_upload_requests.token). Unlike the dashboard estimator route, this
// flow is asynchronous: the PDF is STORED (plan-pdfs bucket), the request
// flips to 'analysing', the response returns immediately, and the take-off +
// pricing + report + results-SMS pipeline runs in after()
// (lib/estimation/sms-run.ts). No tradie action required.
//
// A 'failed' request accepts a re-upload on the same token; a completed one
// returns an idempotent ok.

import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { after } from 'next/server'
import { uploadPlanPdf } from '@/lib/storage/plan-pdf'
import { runSmsPlanAnalysis } from '@/lib/estimation/sms-run'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// after() work includes the ~1–2 min Claude take-off — match the dashboard
// extract route's budget.
export const maxDuration = 300

const MAX_PDF_BYTES = 32 * 1024 * 1024

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  const { data: request } = await supabase
    .from('plan_upload_requests')
    .select('id, tenant_id, status, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (!request) {
    return Response.json({ ok: false, error: 'Invalid or expired link' }, { status: 404 })
  }
  if (new Date(request.expires_at as string).getTime() < Date.now()) {
    return Response.json({ ok: false, error: 'This link has expired — text us for a fresh one' }, { status: 410 })
  }
  if (request.status === 'complete') {
    return Response.json({ ok: true, alreadyDone: true })
  }
  if (request.status === 'analysing') {
    return Response.json({ ok: false, error: 'Your plan is already being analysed — results arrive by SMS shortly' }, { status: 409 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ ok: false, error: 'Bad request' }, { status: 400 })
  }

  const file = form.get('pdf')
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: 'No PDF in upload' }, { status: 400 })
  }
  if (file.type && file.type !== 'application/pdf') {
    return Response.json({ ok: false, error: 'File must be a PDF' }, { status: 400 })
  }
  if (file.size > MAX_PDF_BYTES) {
    return Response.json(
      { ok: false, error: `PDF too large (${(file.size / 1e6).toFixed(1)} MB; max 32 MB)` },
      { status: 413 },
    )
  }

  // 1. Retain the PDF — the analysis runs after this response is sent.
  let pdfPath: string
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    pdfPath = await uploadPlanPdf({ requestId: request.id as string, kind: 'plan', data: bytes })
  } catch (e) {
    console.error('[upload/plan] storage write failed', e instanceof Error ? e.message : e)
    return Response.json({ ok: false, error: 'Storage write failed — try again' }, { status: 500 })
  }

  // 2. Record the upload (source='sms' provenance shows in the tradie's
  //    Estimator run history exactly like a dashboard run).
  const { data: upload, error: upErr } = await supabase
    .from('plan_uploads')
    .insert({
      tenant_id: request.tenant_id,
      filename: file.name || 'plan.pdf',
      size_bytes: file.size,
      source: 'sms',
      pdf_path: pdfPath,
    })
    .select('id')
    .single()
  if (upErr || !upload) {
    console.error('[upload/plan] plan_uploads insert failed', upErr?.message)
    return Response.json({ ok: false, error: 'Could not record upload' }, { status: 500 })
  }

  // 3. Flip the request to analysing and kick the pipeline post-response.
  await supabase
    .from('plan_upload_requests')
    .update({
      status: 'analysing',
      error: null,
      plan_upload_id: upload.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', request.id)

  after(async () => {
    try {
      await runSmsPlanAnalysis(request.id as string)
    } catch (e) {
      console.error('[upload/plan] analysis pipeline threw', e instanceof Error ? e.message : e)
      await supabase
        .from('plan_upload_requests')
        .update({
          status: 'failed',
          error: e instanceof Error ? e.message : String(e),
          updated_at: new Date().toISOString(),
        })
        .eq('id', request.id)
    }
  })

  return Response.json({ ok: true })
}
