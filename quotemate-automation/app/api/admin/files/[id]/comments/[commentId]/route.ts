// PATCH/DELETE /api/admin/files/[id]/comments/[commentId] — edit or soft-
// delete a staffer's OWN admin comment (specs/files-tab.md R10). Admin-gated;
// the comment must belong to the document and be authored by this admin user
// (else 403 — staff cannot edit a tenant's comment).

import {
  adminFromBearer,
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
  const admin = await adminFromBearer(req)
  if (!admin) return Response.json({ error: 'forbidden' }, { status: 403 })

  const { id, commentId } = await ctx.params
  const doc = await getFileDocMeta(id)
  if (!doc) return Response.json({ error: 'not_found' }, { status: 404 })

  const comment = await findComment(commentId)
  const { found, own } = isOwnCommentOnDoc(comment, id, 'admin', admin.userId)
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
  const viewer: Viewer = { role: 'admin', userId: admin.userId, businessName: doc.business_name }
  return Response.json({ ok: true, comment: toDto(row, viewer) })
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; commentId: string }> },
) {
  const admin = await adminFromBearer(req)
  if (!admin) return Response.json({ error: 'forbidden' }, { status: 403 })

  const { id, commentId } = await ctx.params
  const doc = await getFileDocMeta(id)
  if (!doc) return Response.json({ error: 'not_found' }, { status: 404 })

  const comment = await findComment(commentId)
  const { found, own } = isOwnCommentOnDoc(comment, id, 'admin', admin.userId)
  if (!found) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!own) return Response.json({ error: 'forbidden' }, { status: 403 })

  await softDeleteComment(commentId)
  return Response.json({ ok: true })
}
