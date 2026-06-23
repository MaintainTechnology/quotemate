// /api/tenant/files (GET) — list the authenticated tradie's archived
// documents (per-tenant file store, spec 2026-06-19, Phase 2).
//
// Auth pattern mirrors /api/tenant/me + /api/tenant/services/[id]: the
// client sends `Authorization: Bearer <supabase-access-token>`; the server
// validates via supabase.auth.getUser(token) and resolves the tradie's
// tenant by owner_user_id. The service-role key is used for the data query
// (RLS bypass — tenancy is enforced app-layer by the tenant_id filter).
//
// SECURITY: rows are scoped to the authenticated tenant_id ONLY, and we
// return a safe projection — storage_path, kb_document_id and the tenant's
// file_store_id NEVER reach the browser.

import { createClient } from '@supabase/supabase-js'
import { commentCounts } from '@/lib/filestore/comments'

export const dynamic = 'force-dynamic'

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

// ─── GET /api/tenant/files ─────────────────────────────────────────
export async function GET(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Safe projection only — never select storage_path / kb_document_id.
  const { data, error } = await supabase
    .from('tenant_file_documents')
    .select('id, display_name, source_kind, trade, state, created_at, bytes, comments_resolved_at')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Decorate with the comment thread state for the list indicators (R15).
  // Best-effort: a failure to load counts must never break the documents list.
  let counts = new Map<string, number>()
  try {
    counts = await commentCounts(tenant.id)
  } catch {
    /* counts stay empty — the list still renders */
  }
  const documents = (data ?? []).map((d) => ({
    id: d.id as string,
    display_name: (d.display_name as string | null) ?? null,
    source_kind: (d.source_kind as string | null) ?? null,
    trade: (d.trade as string | null) ?? null,
    state: (d.state as string | null) ?? null,
    created_at: (d.created_at as string | null) ?? null,
    bytes: (d.bytes as number | null) ?? null,
    comment_count: counts.get(d.id as string) ?? 0,
    resolved: !!d.comments_resolved_at,
  }))

  return Response.json({ documents })
}
