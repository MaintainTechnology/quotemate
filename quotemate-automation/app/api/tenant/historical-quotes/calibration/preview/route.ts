// POST /api/tenant/historical-quotes/calibration/preview (spec R13) — compute
// proposed tenant_custom_assemblies upserts from confirmed history (per job type
// with >= MIN_SAMPLES). READ-ONLY: this writes nothing; it returns a diff
// (proposed vs. existing price) for the tradie to approve.

import { tenantFromBearer } from '@/lib/estimation/auth'
import { getAnalyticsRows, getExistingCustomAssemblyPrices } from '@/lib/historical-quotes/repo'
import { aggregateByJobType } from '@/lib/historical-quotes/analytics'
import { buildCalibrationProposals, MIN_SAMPLES } from '@/lib/historical-quotes/calibration'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const rows = await getAnalyticsRows(tenant.id)
  const stats = aggregateByJobType(rows)
  const existing = await getExistingCustomAssemblyPrices(tenant.id)
  const proposals = buildCalibrationProposals(stats, existing)

  return Response.json({ proposals, min_samples: MIN_SAMPLES })
}
