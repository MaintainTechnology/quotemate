// GET/POST /api/tenant/files/[id]/comments — the tradie's two-party comment
// thread for one of their archived documents (specs/files-tab.md R9).
//
// Auth: Bearer Supabase token → tenant by owner_user_id. The document must
// belong to the authenticated tenant, else 404 (never leak another tenant's
// document existence). The tradie always authors as role 'tenant'.

import {
  tenantFromBearer,
  getFileDocMeta,
  listComments,
  insertComment,
  validateCommentBody,
  toDto,
  type Viewer,
} from '@/lib/filestore/comments'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const doc = await getFileDocMeta(id)
  if (!doc || doc.tenant_id !== tenant.id) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const viewer: Viewer = { role: 'tenant', userId: tenant.userId, businessName: tenant.business_name }
  const rows = await listComments(id)
  return Response.json({
    comments: rows.map((r) => toDto(r, viewer)),
    resolved: !!doc.resolved_at,
    resolved_at: doc.resolved_at,
    resolved_by: doc.resolved_by,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const doc = await getFileDocMeta(id)
  if (!doc || doc.tenant_id !== tenant.id) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const v = validateCommentBody((body as { body?: unknown } | null)?.body)
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 })

  const row = await insertComment({
    fileDocumentId: id,
    tenantId: tenant.id,
    authorRole: 'tenant',
    authorUserId: tenant.userId,
    body: v.body,
  })
  const viewer: Viewer = { role: 'tenant', userId: tenant.userId, businessName: tenant.business_name }
  return Response.json({ ok: true, comment: toDto(row, viewer) }, { status: 201 })
}
