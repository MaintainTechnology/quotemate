// POST /api/tenant/files/[id]/resolve — mark the document's comment thread
// resolved or re-open it (specs/files-tab.md R9). Body: { resolved: boolean }.
// The document must belong to the authenticated tenant (else 404).

import {
  tenantFromBearer,
  getFileDocMeta,
  setThreadResolved,
} from '@/lib/filestore/comments'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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
    body = {}
  }
  const resolved = !!(body as { resolved?: unknown } | null)?.resolved
  const state = await setThreadResolved(id, resolved, 'tenant')
  return Response.json({ ok: true, ...state })
}
