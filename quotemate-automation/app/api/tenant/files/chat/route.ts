// POST /api/tenant/files/chat — answer a question grounded in the
// authenticated tradie's own archived documents (per-tenant file store,
// spec 2026-06-19, Phase 2).
//
// Auth pattern mirrors /api/tenant/me: `Authorization: Bearer <token>` →
// supabase.auth.getUser → tenant by owner_user_id. The service-role key is
// used for the tenant lookup (RLS bypass; tenancy enforced app-layer).
//
// The Gemini File Search store id (tenants.file_store_id) is resolved
// SERVER-SIDE and lazily created if missing. It is NEVER accepted from, nor
// returned to, the browser — the client only ever sends { query } and gets
// back { answer, citations }.

import { createClient } from '@supabase/supabase-js'
import { searchTenantStore, ensureTenantStore } from '@/lib/filestore/tenant-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// File-search round-trip to the KB service can take a few seconds.
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

type TenantRow = {
  id: string
  business_name: string | null
  file_store_id: string | null
}

async function tenantFromBearer(req: Request): Promise<TenantRow | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, business_name, file_store_id')
    .eq('owner_user_id', data.user.id)
    .maybeSingle<TenantRow>()
  return tenant ?? null
}

type Citation = {
  title: string | null
  snippet: string | null
  /** Authoritative tenant_file_documents.id for deep-linking the citation to
   *  the archive download (R18/R19) — resolved server-side from display_name,
   *  scoped to this tenant. Null when the cited title doesn't map to a row. */
  documentId: string | null
}

const NO_DOCS = { answer: 'No documents indexed yet.', citations: [] as Citation[] }

// ─── POST /api/tenant/files/chat ───────────────────────────────────
export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const query =
    body && typeof body === 'object' && typeof (body as { query?: unknown }).query === 'string'
      ? (body as { query: string }).query.trim()
      : ''
  if (!query) {
    return Response.json({ error: 'invalid_payload' }, { status: 400 })
  }

  // Resolve the store id server-side; lazily create it if the tenant has
  // never been provisioned one. ensureTenantStore is best-effort and never
  // throws — a null result means the KB is unavailable / unconfigured.
  let storeId = tenant.file_store_id
  if (!storeId) {
    storeId = await ensureTenantStore(tenant.id, tenant.business_name)
    if (storeId) {
      // Persist the freshly-created id so we don't re-resolve next time.
      // Best-effort: a write failure must not fail the chat.
      await supabase
        .from('tenants')
        .update({ file_store_id: storeId })
        .eq('id', tenant.id)
        .then(undefined, () => undefined)
    }
  }

  if (!storeId) {
    return Response.json(NO_DOCS)
  }

  try {
    const result = await searchTenantStore({ storeId, query })
    const answer = (result.answer ?? '').trim()
    const passages = result.passages ?? []
    // Empty answer with no passages → treat as nothing indexed / no match.
    if (!answer && passages.length === 0) {
      return Response.json(NO_DOCS)
    }

    // Resolve each cited document title → its tenant_file_documents.id (scoped
    // to this tenant) so the UI can deep-link to the archive download by id
    // instead of a fragile title string-match. The KB returns the doc's
    // displayName (sometimes with a .md suffix); our rows store it extension-free.
    const norm = (t: string | null | undefined) => (t ?? '').replace(/\.md$/i, '').trim()
    const titles = [...new Set(passages.map((p) => norm(p.documentTitle)).filter(Boolean))]
    const idByName = new Map<string, string>()
    if (titles.length > 0) {
      const { data: rows } = await supabase
        .from('tenant_file_documents')
        .select('id, display_name')
        .eq('tenant_id', tenant.id)
        .in('display_name', titles)
      for (const r of (rows ?? []) as Array<{ id: string; display_name: string }>) {
        idByName.set(r.display_name, r.id)
      }
    }
    const citations: Citation[] = passages.map((p) => ({
      title: p.documentTitle ?? null,
      snippet: p.text ?? null,
      documentId: idByName.get(norm(p.documentTitle)) ?? null,
    }))
    return Response.json({
      answer: answer || 'No answer found in your documents.',
      citations,
    })
  } catch (e) {
    console.error('[tenant/files/chat] search failed', {
      tenantId: tenant.id,
      message: e instanceof Error ? e.message : String(e),
    })
    return Response.json(
      { error: 'search_failed', answer: 'Could not search your documents right now — try again shortly.', citations: [] },
      { status: 502 },
    )
  }
}
