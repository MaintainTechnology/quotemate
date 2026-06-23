// POST /api/tenant/historical-quotes/calibration/apply (spec R14) — persist the
// tradie-approved subset into tenant_custom_assemblies (enabled, auto-quoteable)
// so the estimator's lookup_assembly grounds future drafts on it. Prices are
// RECOMPUTED server-side from confirmed history — the client only names which
// job_types it approved, so it can't smuggle in an arbitrary price.

import { z } from 'zod'
import { tenantFromBearer } from '@/lib/estimation/auth'
import {
  getAnalyticsRows,
  getExistingCustomAssemblyPrices,
  upsertCustomAssemblies,
} from '@/lib/historical-quotes/repo'
import { aggregateByJobType } from '@/lib/historical-quotes/analytics'
import { buildCalibrationProposals } from '@/lib/historical-quotes/calibration'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({ job_types: z.array(z.string()).min(1).max(50) })

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'invalid_payload' }, { status: 400 })

  // Recompute proposals server-side; keep only the approved job_types that still
  // clear MIN_SAMPLES (buildCalibrationProposals enforces the threshold).
  const rows = await getAnalyticsRows(tenant.id)
  const stats = aggregateByJobType(rows)
  const existing = await getExistingCustomAssemblyPrices(tenant.id)
  const approved = new Set(parsed.data.job_types)
  const proposals = buildCalibrationProposals(stats, existing).filter((p) => approved.has(p.job_type))

  const applied = await upsertCustomAssemblies(
    proposals.map((p) => ({
      tenant_id: tenant.id,
      trade: p.trade,
      name: p.name,
      default_unit_price_ex_gst: p.proposed_unit_price_ex_gst,
    })),
  )

  return Response.json({ ok: true, applied, proposals })
}
