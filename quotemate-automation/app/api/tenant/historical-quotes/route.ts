// GET /api/tenant/historical-quotes (spec R9) — browse confirmed historical
// quotes with optional filters: job_type, trade, from/to (quoted_at), q
// (free-text over raw_description). Tenant-scoped.

import { tenantFromBearer } from '@/lib/estimation/auth'
import { listConfirmed } from '@/lib/historical-quotes/repo'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const quotes = await listConfirmed(tenant.id, {
    job_type: url.searchParams.get('job_type'),
    trade: url.searchParams.get('trade'),
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    q: url.searchParams.get('q'),
  })

  return Response.json({ quotes })
}
