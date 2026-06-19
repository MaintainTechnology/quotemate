// GET /api/tenant/files/[id]/download — stream the FULL archived document
// for the authenticated tradie (per-tenant file store, spec 2026-06-19, P2).
//
// The full, unredacted document lives in the private `quote-pdfs` Supabase
// Storage bucket (tenant_file_documents.storage_path). Downloads come ONLY
// from Supabase Storage — never from the Gemini KB (which holds the
// PII-minimized text summary, not the original file).
//
// SECURITY: we look the row up by id, then assert it belongs to the
// authenticated tenant. A mismatch (or a missing row) returns 404 — never a
// 403 — so the endpoint doesn't leak the existence of another tenant's doc.

import { createClient } from '@supabase/supabase-js'
import { downloadQuotePdf } from '@/lib/quote/pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

async function tenantFromBearer(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('owner_user_id', data.user.id)
    .maybeSingle()
  if (!tenant) return null
  return tenant as { id: string }
}

// Derive a sensible Content-Type from the stored file's extension. Quotes
// are always Gotenberg-rendered PDFs; invoices can be PDFs or images the
// tradie uploaded (jpg/png/etc). Unknown → octet-stream so the browser just
// downloads the bytes.
function contentTypeFor(
  storagePath: string,
  sourceKind: string | null,
): string {
  const ext = storagePath.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'pdf':
      return 'application/pdf'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'heic':
      return 'image/heic'
    case 'tif':
    case 'tiff':
      return 'image/tiff'
    case 'md':
      return 'text/markdown'
    default:
      // Quotes are always PDFs even if the path somehow lacks the extension.
      return sourceKind === 'quote' ? 'application/pdf' : 'application/octet-stream'
  }
}

// ─── GET /api/tenant/files/[id]/download ───────────────────────────
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const { data: row } = await supabase
    .from('tenant_file_documents')
    .select('id, tenant_id, source_kind, display_name, storage_path')
    .eq('id', id)
    .maybeSingle<{
      id: string
      tenant_id: string
      source_kind: string | null
      display_name: string | null
      storage_path: string | null
    }>()

  // Ownership gate — a wrong/foreign id is indistinguishable from "missing"
  // so we never confirm another tenant's document exists.
  if (!row || row.tenant_id !== tenant.id) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  if (!row.storage_path) {
    // Row exists but the full doc was never archived (e.g. ingest skipped /
    // still pending). Nothing to stream.
    return Response.json({ error: 'not_available' }, { status: 404 })
  }

  let bytes: Buffer
  try {
    bytes = await downloadQuotePdf(row.storage_path)
  } catch (e) {
    console.error('[tenant/files/download] storage download failed', {
      id: row.id,
      message: e instanceof Error ? e.message : String(e),
    })
    return Response.json({ error: 'download_failed' }, { status: 502 })
  }

  const contentType = contentTypeFor(row.storage_path, row.source_kind)
  const ext = row.storage_path.split('.').pop()?.toLowerCase() ?? 'pdf'
  const base = (row.display_name ?? 'document').replace(/[^\w.\- ]+/g, '_').trim() || 'document'
  const filename = base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, max-age=300',
    },
  })
}
