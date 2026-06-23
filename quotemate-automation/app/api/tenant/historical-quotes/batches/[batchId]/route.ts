// GET /api/tenant/historical-quotes/batches/[batchId] (spec R8) — the batch and
// its rows (proposed categorisations) so the review UI can show + correct them.
// Another tenant's batchId returns 404 (no existence leak).

import { tenantFromBearer } from '@/lib/estimation/auth'
import { getBatch, getBatchRows } from '@/lib/historical-quotes/repo'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ batchId: string }> }) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { batchId } = await ctx.params
  const batch = await getBatch(tenant.id, batchId)
  if (!batch) return Response.json({ error: 'not_found' }, { status: 404 })

  const rows = await getBatchRows(tenant.id, batchId)
  return Response.json({ batch, rows })
}
