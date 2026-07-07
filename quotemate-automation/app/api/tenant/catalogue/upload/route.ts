// POST /api/tenant/catalogue/upload — upload a catalogue product photo
// from the dashboard (the alternative to pasting an image URL).
//
// Bearer-authed, tenant-scoped. The file lands in the PUBLIC
// catalogue-images bucket at <tenantId>/<stamp>-<rand>.<ext> and we
// return its permanent public URL. The caller stores that URL in
// tenant_material_catalogue.image_path — which already works
// everywhere (dashboard <img>, /q/choose/[token] <img>, and Gemini
// WP4 resolveProductImage's http(s) branch) with no path-signing.
//
// Best-effort bucket provisioning: if the bucket is missing we create
// it (public) on first use, so a forgotten ops step can't break this.

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = 'catalogue-images'
const MAX_BYTES = 8 * 1024 * 1024 // 8 MB — matches WP4 product-image MAX_BYTES
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

async function tenantFromBearer(req: Request) {
  // Dual-auth: Clerk session token OR legacy Supabase token. Resolver
  // returns null for missing/invalid token AND authed-but-no-tenant;
  // both collapse to null so the call sites' existing 401 stays unchanged.
  const resolved = await resolveTenantRequest(supabase, req, 'id')
  return (resolved?.tenant ?? null) as { id: string } | null
}

// Idempotent: only creates the bucket if it's genuinely missing. A
// concurrent create racing us just returns "already exists" → ignored.
async function ensureBucket() {
  const { data: existing } = await supabase.storage.getBucket(BUCKET)
  if (existing) return
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: Object.keys(ALLOWED),
  })
  if (error && !/exist/i.test(error.message)) {
    throw new Error(`bucket create failed: ${error.message}`)
  }
}

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return Response.json({ error: 'invalid_form_data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
    return Response.json({ error: 'no_file' }, { status: 400 })
  }

  const mime = (file.type || '').toLowerCase().split(';')[0].trim()
  const ext = ALLOWED[mime]
  if (!ext) {
    return Response.json(
      { error: 'unsupported_type', message: 'Use a JPG, PNG or WebP image.' },
      { status: 400 },
    )
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return Response.json(
      { error: 'too_large', message: 'Image must be between 0 and 8 MB.' },
      { status: 400 },
    )
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  // Re-check the decoded length — file.size can lie / be absent on some
  // clients; the bytes are the source of truth before we store them.
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    return Response.json({ error: 'too_large' }, { status: 400 })
  }

  try {
    await ensureBucket()
  } catch (e) {
    return Response.json(
      { error: 'storage_unavailable', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }

  const path = `${tenant.id}/${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: false })
  if (upErr) {
    return Response.json({ error: 'upload_failed', message: upErr.message }, { status: 500 })
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
  if (!pub?.publicUrl) {
    return Response.json({ error: 'no_public_url' }, { status: 500 })
  }

  return Response.json({ ok: true, url: pub.publicUrl, path })
}
