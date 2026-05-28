// GET /api/admin/agents/queue
//
// Single endpoint the admin overview + per-agent pages read from. Returns:
//   - eval_runs       (latest 10)
//   - catalogue_findings (latest 50, by status filter)
//   - tradie_edit_patterns (latest 50, by status filter)
//   - quick counts so the overview can render badges without a 2nd call
//
// Admin-gated. No browser-side keys.

import { createClient } from '@supabase/supabase-js'
import { resolveAdminUserId } from '@/lib/admin-loader/route-auth'
import { isFindingStatus } from '@/lib/agents/findings'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  const adminId = await resolveAdminUserId(supabase, req)
  if (!adminId) return Response.json({ error: 'forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const statusRaw = url.searchParams.get('status') || 'pending'
  const status = isFindingStatus(statusRaw) ? statusRaw : 'pending'

  const [evalRuns, catalogue, patterns, catPending, patPending] =
    await Promise.all([
      supabase
        .from('eval_runs')
        .select('id, prompt_version, catalogue_version, total_score, per_category, started_at, completed_at')
        .order('started_at', { ascending: false })
        .limit(10),
      supabase
        .from('catalogue_findings')
        .select(
          'id, source_table, source_row_id, finding_type, current_value, suggested_value, confidence, status, created_at, reviewed_by, reviewed_at',
        )
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('tradie_edit_patterns')
        .select(
          'id, tenant_id, trade, job_type, field, edit_direction, median_delta, sample_count, observed_period_start, observed_period_end, status, created_at, reviewed_by, reviewed_at',
        )
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(50),
      // Pending counts for the badge headers (independent of the
      // currently-selected status filter).
      supabase
        .from('catalogue_findings')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabase
        .from('tradie_edit_patterns')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
    ])

  return Response.json({
    ok: true,
    status,
    eval_runs: evalRuns.data ?? [],
    catalogue_findings: catalogue.data ?? [],
    tradie_edit_patterns: patterns.data ?? [],
    counts: {
      catalogue_pending: catPending.count ?? 0,
      tradie_pending: patPending.count ?? 0,
    },
    errors: [
      evalRuns.error?.message,
      catalogue.error?.message,
      patterns.error?.message,
    ].filter(Boolean),
  })
}
