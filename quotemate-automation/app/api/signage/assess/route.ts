// /api/signage/assess — HQ re-runs the vision assessment for a request
// (e.g. after a franchisee re-submits, or to re-score against an updated
// rule set). Idempotent via runAssessment's upsert on request_id.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { orgFromBearer } from '@/lib/signage/org'
import { runAssessment } from '@/lib/signage/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const Schema = z.object({ request_id: z.string().uuid() })

export async function POST(req: Request) {
  const ctx = await orgFromBearer(supabase, req)
  if (!ctx) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'invalid_request' }, { status: 400 })
  }

  // The request must belong to this org.
  const { data: reqRow } = await supabase
    .from('signage_requests')
    .select('id, org_id')
    .eq('id', parsed.data.request_id)
    .maybeSingle()
  if (!reqRow || (reqRow.org_id as string) !== ctx.orgId) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const result = await runAssessment(supabase, parsed.data.request_id)
  return Response.json(result, { status: result.ok ? 200 : 500 })
}
