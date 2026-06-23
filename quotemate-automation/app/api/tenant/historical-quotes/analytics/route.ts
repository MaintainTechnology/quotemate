// GET /api/tenant/historical-quotes/analytics (spec R10) — per-job-type pricing
// analytics (count, avg/min/max inc-GST, most-recent) over CONFIRMED rows only.

import { tenantFromBearer } from '@/lib/estimation/auth'
import { getAnalyticsRows } from '@/lib/historical-quotes/repo'
import { aggregateByJobType } from '@/lib/historical-quotes/analytics'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const rows = await getAnalyticsRows(tenant.id)
  return Response.json({ analytics: aggregateByJobType(rows) })
}
