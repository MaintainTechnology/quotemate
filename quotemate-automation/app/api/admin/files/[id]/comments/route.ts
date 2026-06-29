// GET/POST /api/admin/files/[id]/comments — QuoteMax staff side of the two-
// party comment thread (specs/files-tab.md R10). Admin-gated; staff can reach
// ANY tenant's document. Staff always author as role 'admin'.

import {
  adminFromBearer,
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
  const admin = await adminFromBearer(req)
  if (!admin) return Response.json({ error: 'forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const doc = await getFileDocMeta(id)
  if (!doc) return Response.json({ error: 'not_found' }, { status: 404 })

  const viewer: Viewer = { role: 'admin', userId: admin.userId, businessName: doc.business_name }
  const rows = await listComments(id)
  return Response.json({
    comments: rows.map((r) => toDto(r, viewer)),
    resolved: !!doc.resolved_at,
    resolved_at: doc.resolved_at,
    resolved_by: doc.resolved_by,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await adminFromBearer(req)
  if (!admin) return Response.json({ error: 'forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const doc = await getFileDocMeta(id)
  if (!doc) return Response.json({ error: 'not_found' }, { status: 404 })

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
    tenantId: doc.tenant_id,
    authorRole: 'admin',
    authorUserId: admin.userId,
    body: v.body,
  })
  const viewer: Viewer = { role: 'admin', userId: admin.userId, businessName: doc.business_name }
  return Response.json({ ok: true, comment: toDto(row, viewer) }, { status: 201 })
}
