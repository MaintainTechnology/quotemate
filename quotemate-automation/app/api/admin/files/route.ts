// GET /api/admin/files?tenantId=… — admin-gated list of a tenant's archived
// documents, for the staff Files console (specs/files-tab.md R10). Returns a
// safe projection plus the open comment count and thread resolved state; never
// returns storage_path / kb_document_id.

import { createClient } from '@supabase/supabase-js'
import { adminFromBearer, commentCounts, isUuid } from '@/lib/filestore/comments'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

export async function GET(req: Request) {
  const admin = await adminFromBearer(req)
  if (!admin) return Response.json({ ok: false, error: 'forbidden' }, { status: 403 })

  const tenantId = new URL(req.url).searchParams.get('tenantId') ?? ''
  if (!isUuid(tenantId)) {
    return Response.json({ ok: false, error: 'missing_tenant' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('tenant_file_documents')
    .select('id, display_name, source_kind, trade, state, created_at, comments_resolved_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  const counts = await commentCounts(tenantId)
  const documents = (data ?? []).map((d) => ({
    id: d.id as string,
    display_name: (d.display_name as string | null) ?? null,
    source_kind: (d.source_kind as string | null) ?? null,
    trade: (d.trade as string | null) ?? null,
    state: (d.state as string | null) ?? null,
    created_at: (d.created_at as string | null) ?? null,
    comment_count: counts.get(d.id as string) ?? 0,
    resolved: !!d.comments_resolved_at,
  }))

  return Response.json({ ok: true, documents })
}
