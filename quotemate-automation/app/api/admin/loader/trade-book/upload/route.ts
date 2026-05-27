// POST /api/admin/loader/trade-book/upload — admin-only PDF upload proxy.
//
// Closes the loop on the trade-book extraction workflow: instead of
// asking the admin to upload PDFs through the mt-filestore-kb console,
// the 01·b StepCard now drops a file directly here. We proxy the
// multipart payload up to mt-filestore-kb, holding the KB_API_KEY
// server-side (browser never sees it).
//
// Body: multipart/form-data
//   field "file"        — application/pdf, max 100MB
//   field "storeId"     — required: the kb store to upload into
//   field "displayName" — optional: friendly label for the document
//
// Returns: { ok: true, document: { name, displayName, state, ... } }
// Errors:  503 when KB_API_URL/KB_API_KEY missing
//          400 on missing/invalid file/storeId
//          413 when file > 100MB
//          415 on non-PDF mime
//          502 on mt-filestore-kb error
//          403 when caller isn't an admin

import { createClient } from '@supabase/supabase-js'
import { resolveAdminUserId } from '@/lib/admin-loader/route-auth'
import {
  kbUploadDocument,
  loadKbConfigFromEnv,
  KB_UPLOAD_MAX_BYTES,
} from '@/lib/admin-loader/mt-filestore-kb'

export const dynamic = 'force-dynamic'
// Trade-book PDFs can be 50-80MB and the Gemini indexing pipeline runs
// inside mt-filestore-kb during the upload response cycle; bump the
// timeout to match Vercel's max for a Pro plan.
export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const ALLOWED_MIME = new Set(['application/pdf'])

export async function POST(req: Request) {
  const adminId = await resolveAdminUserId(supabase, req)
  if (!adminId) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  let kbConfig
  try {
    kbConfig = loadKbConfigFromEnv()
  } catch (e: any) {
    return Response.json(
      { ok: false, error: `mt-filestore-kb not configured: ${e?.message ?? String(e)}` },
      { status: 503 },
    )
  }

  // Parse multipart. Next 16's native FormData parser handles this.
  let form: FormData
  try {
    form = await req.formData()
  } catch (e: any) {
    return Response.json(
      { ok: false, error: `invalid multipart body: ${e?.message ?? String(e)}` },
      { status: 400 },
    )
  }

  const storeIdRaw = form.get('storeId')
  const storeId = typeof storeIdRaw === 'string' ? storeIdRaw.trim() : ''
  if (!storeId) {
    return Response.json(
      { ok: false, error: 'storeId form field is required' },
      { status: 400 },
    )
  }

  const fileEntry = form.get('file')
  if (!(fileEntry instanceof Blob)) {
    return Response.json(
      { ok: false, error: 'file form field must be a file upload' },
      { status: 400 },
    )
  }
  const file = fileEntry as Blob & { name?: string; type: string }

  if (file.size > KB_UPLOAD_MAX_BYTES) {
    return Response.json(
      {
        ok: false,
        error: `file is ${file.size} bytes; max is ${KB_UPLOAD_MAX_BYTES}`,
      },
      { status: 413 },
    )
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return Response.json(
      {
        ok: false,
        error: `unsupported mime type "${file.type}" — only application/pdf is accepted`,
      },
      { status: 415 },
    )
  }

  const displayNameRaw = form.get('displayName')
  const displayName =
    typeof displayNameRaw === 'string' && displayNameRaw.trim().length > 0
      ? displayNameRaw.trim()
      : undefined

  try {
    const doc = await kbUploadDocument(kbConfig, {
      storeId,
      file: file as Blob & { name?: string },
      displayName,
    })
    return Response.json({ ok: true, document: doc })
  } catch (e: any) {
    return Response.json(
      {
        ok: false,
        error: `mt-filestore-kb upload error: ${e?.message ?? String(e)}`,
      },
      { status: 502 },
    )
  }
}
