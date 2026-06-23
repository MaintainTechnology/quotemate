// GET /api/tenant/historical-quotes/hint?job_type=&trade= (spec R11) — the
// aggregate for one job type, for the in-quote review hint. Returns { count: 0 }
// cleanly when the tenant has no confirmed history for that job type.

import { tenantFromBearer } from '@/lib/estimation/auth'
import { getAnalyticsRows } from '@/lib/historical-quotes/repo'
import { hintFor } from '@/lib/historical-quotes/analytics'
import { isJobType } from '@/lib/historical-quotes/job-types'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const jobType = url.searchParams.get('job_type')
  if (!jobType || !isJobType(jobType)) {
    return Response.json({ error: 'invalid_job_type' }, { status: 400 })
  }

  const rows = await getAnalyticsRows(tenant.id, jobType)
  return Response.json(hintFor(rows, jobType))
}
