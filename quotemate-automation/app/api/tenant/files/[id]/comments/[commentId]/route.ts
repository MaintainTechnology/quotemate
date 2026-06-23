// PATCH/DELETE /api/tenant/files/[id]/comments/[commentId] — edit or soft-
// delete the tradie's OWN comment (specs/files-tab.md R9, R-edge).
//
// The document must belong to the authenticated tenant (else 404), the comment
// must belong to that document (else 404), and the caller must be the comment's
// author (else 403). DELETE is a soft delete (deleted_at) so the thread stays
// auditable.

import {
  tenantFromBearer,
  getFileDocMeta,
  findComment,
  isOwnCommentOnDoc,
  updateCommentBody,
  softDeleteComment,
  validateCommentBody,
  toDto,
  type Viewer,
} from '@/lib/filestore/comments'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; commentId: string }> },
) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { id, commentId } = await ctx.params
  const doc = await getFileDocMeta(id)
  if (!doc || doc.tenant_id !== tenant.id) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const comment = await findComment(commentId)
  const { found, own } = isOwnCommentOnDoc(comment, id, 'tenant', tenant.userId)
  if (!found) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!own) return Response.json({ error: 'forbidden' }, { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const v = validateCommentBody((body as { body?: unknown } | null)?.body)
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 })

  const row = await updateCommentBody(commentId, v.body)
  const viewer: Viewer = { role: 'tenant', userId: tenant.userId, businessName: tenant.business_name }
  return Response.json({ ok: true, comment: toDto(row, viewer) })
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; commentId: string }> },
) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { id, commentId } = await ctx.params
  const doc = await getFileDocMeta(id)
  if (!doc || doc.tenant_id !== tenant.id) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const comment = await findComment(commentId)
  const { found, own } = isOwnCommentOnDoc(comment, id, 'tenant', tenant.userId)
  if (!found) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!own) return Response.json({ error: 'forbidden' }, { status: 403 })

  await softDeleteComment(commentId)
  return Response.json({ ok: true })
}
