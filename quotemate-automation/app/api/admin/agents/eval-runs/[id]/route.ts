// GET /api/admin/agents/eval-runs/[id]
//
// Per-run drill-down. Returns the eval_runs row + every eval_run_items
// row, so the admin can see the expected vs actual + dimension scores
// for each fixture in a single payload.

import { createClient } from '@supabase/supabase-js'
import { resolveAdminUserId } from '@/lib/admin-loader/route-auth'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const adminId = await resolveAdminUserId(supabase, req)
  if (!adminId) return Response.json({ error: 'forbidden' }, { status: 403 })

  const { id } = await ctx.params

  const [runResp, itemsResp] = await Promise.all([
    supabase
      .from('eval_runs')
      .select('id, prompt_version, catalogue_version, total_score, per_category, started_at, completed_at')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('eval_run_items')
      .select(
        'id, intake_fixture_id, expected, actual, dim_price, dim_material, dim_tier, dim_scope, dim_routing, notes',
      )
      .eq('run_id', id)
      .order('intake_fixture_id'),
  ])

  if (runResp.error) {
    return Response.json({ error: runResp.error.message }, { status: 500 })
  }
  if (!runResp.data) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  return Response.json({
    ok: true,
    run: runResp.data,
    items: itemsResp.data ?? [],
  })
}
