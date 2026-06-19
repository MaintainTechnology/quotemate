// POST /api/tenant/calibration/upload — A5 invoice upload entry point.
//
// Accepts a base64-encoded invoice image, runs Gemini vision extraction,
// persists the upload + extraction to the DB, and returns the structured
// extraction back to the caller so the dashboard can show it immediately.
//
// V1 scope (image only — PDF support is later):
//   1. POST body: { image_base64, mime_type }  (multipart later)
//   2. Insert invoice_uploads row with status='extracting'
//   3. Call extractInvoice(...)
//   4. On success: insert invoice_extractions row, flip status='extracted'
//      On failure: flip status='failed' + set error
//   5. Return { ok: true|false, upload_id, extraction?, error? }
//
// Synchronous — extraction takes ~3-10s for an image, well within the
// route timeout. If we add PDF support we'll fan extraction out to
// after()/queue. Single-tenant scoped; no cross-tenant access.

import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { extractInvoice } from '@/lib/invoice/extract'
import { archiveAndIngestQuote } from '@/lib/filestore/ingest-quote'
import { buildInvoiceKbText } from '@/lib/filestore/minimize'
import { storeQuoteAsset } from '@/lib/quote/pdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BodySchema = z.object({
  image_base64: z.string().min(1),
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
})

async function tenantFromBearer(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, trade, trades')
    .eq('owner_user_id', data.user.id)
    .maybeSingle()
  if (!tenant) return null
  return tenant as { id: string; trade: string | null; trades: string[] | null }
}

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'validation_failed', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  // 1. Stub upload row immediately so failures still appear in the audit.
  const { data: upload, error: upErr } = await supabase
    .from('invoice_uploads')
    .insert({
      tenant_id: tenant.id,
      mime_type: parsed.data.mime_type,
      status: 'extracting',
    })
    .select('id')
    .single()
  if (upErr || !upload) {
    return Response.json(
      { ok: false, error: 'upload_insert_failed', message: upErr?.message ?? 'no row returned' },
      { status: 500 },
    )
  }

  // 2. Run extraction.
  const result = await extractInvoice({
    imageBase64: parsed.data.image_base64,
    mimeType: parsed.data.mime_type,
  })

  if (!result.ok) {
    await supabase
      .from('invoice_uploads')
      .update({ status: 'failed', error: `${result.reason}: ${result.message}` })
      .eq('id', upload.id)
      .eq('tenant_id', tenant.id)
    return Response.json(
      {
        ok: false,
        upload_id: upload.id,
        error: result.reason,
        message: result.message,
      },
      { status: 502 },
    )
  }

  // 3. Persist the structured extraction.
  const ext = result.extraction
  const { data: extRow, error: extErr } = await supabase
    .from('invoice_extractions')
    .insert({
      upload_id: upload.id,
      tenant_id: tenant.id,
      raw: result.raw,
      scope_description: ext.scope_description,
      total_inc_gst: ext.total_inc_gst,
      job_type_guess: ext.job_type_guess ?? null,
      quantity: ext.quantity ?? null,
      customer_name: ext.customer_name ?? null,
      customer_suburb: ext.customer_suburb ?? null,
      invoice_date: ext.invoice_date ?? null,
    })
    .select('id')
    .single()
  if (extErr) {
    await supabase
      .from('invoice_uploads')
      .update({ status: 'failed', error: `extraction_insert: ${extErr.message}` })
      .eq('id', upload.id)
      .eq('tenant_id', tenant.id)
    return Response.json(
      { ok: false, upload_id: upload.id, error: 'extraction_insert_failed', message: extErr.message },
      { status: 500 },
    )
  }

  await supabase
    .from('invoice_uploads')
    .update({ status: 'extracted', error: null })
    .eq('id', upload.id)
    .eq('tenant_id', tenant.id)

  // ── Per-tenant file-store archive + KB ingest (spec 2026-06-19). Runs
  //    post-ack so the synchronous response is unchanged. (a) archive the RAW
  //    uploaded image to access-controlled Supabase Storage; (b) push ONLY the
  //    PII-minimized invoice summary into the tenant's KB. Both are best-effort
  //    and never throw into the response; archiveAndIngestQuote STUBs when
  //    TENANT_FILESTORE_ENABLED!=='true'. The raw image never reaches the KB.
  const tenantId = tenant.id
  const uploadId = upload.id
  const imageBase64 = parsed.data.image_base64
  const mimeType = parsed.data.mime_type
  after(async () => {
    try {
      const ext2mime: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/heic': 'heic',
      }
      const fileExt = ext2mime[mimeType] ?? mimeType.split('/')[1] ?? 'bin'
      const storedPath = await storeQuoteAsset(
        `invoices/${uploadId}.${fileExt}`,
        Buffer.from(imageBase64, 'base64'),
        mimeType,
      )
      // Persist the archive location so a reconcile/backfill retry can rebuild
      // the full-doc path (source-doc.buildInvoice reads invoice_uploads.storage_path);
      // without it a failed invoice ingest could never recover (lockstep needs a
      // full doc).
      await supabase.from('invoice_uploads').update({ storage_path: storedPath }).eq('id', uploadId)
      const kb = buildInvoiceKbText({ extraction: ext })
      await archiveAndIngestQuote({
        tenantId,
        sourceKind: 'invoice',
        sourceId: uploadId,
        fullDocPath: storedPath,
        kbText: kb.markdown,
        contentHash: kb.contentHash,
      })
    } catch {
      // best-effort archive — must never affect the (already-sent) response.
    }
  })

  return Response.json({
    ok: true,
    upload_id: upload.id,
    extraction_id: extRow?.id,
    extraction: ext,
  })
}
