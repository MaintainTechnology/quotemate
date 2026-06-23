// POST /api/tenant/historical-quotes/review (spec R8) — apply per-row
// corrections: confirm/reject and optionally override the job_type. Only
// confirmed rows feed analytics, hints and calibration. Tenant-scoped.

import { z } from 'zod'
import { tenantFromBearer } from '@/lib/estimation/auth'
import { applyReview } from '@/lib/historical-quotes/repo'
import { JobTypeEnum } from '@/lib/historical-quotes/job-types'

export const dynamic = 'force-dynamic'

const UpdateSchema = z.object({
  id: z.string().uuid(),
  job_type: JobTypeEnum.optional(),
  status: z.enum(['confirmed', 'rejected']),
})
const BodySchema = z.object({ updates: z.array(UpdateSchema).min(1).max(5000) })

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

  const updated = await applyReview(tenant.id, parsed.data.updates)
  return Response.json({ ok: true, updated })
}
