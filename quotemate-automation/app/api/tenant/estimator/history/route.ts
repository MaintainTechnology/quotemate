// GET /api/tenant/estimator/history — the authed tenant's past ELECTRICAL plan
// uploads, each with its extraction (items + any saved corrections). Newest first.
//
// `plan_uploads` is shared across trades (migration 107 gave it a `trade`
// column; Commercial Painting writes its own document uploads here too, tagged
// trade='commercial_painting' with a paint_run_id). This tab is the electrical
// Estimator (Beta), so the list is filtered to trade='electrical' — otherwise a
// tenant's commercial-painting uploads leak into its "Past analyses". The column
// is NOT NULL DEFAULT 'electrical', so every legacy electrical row is tagged too.

import { tenantFromBearer, estimatorSupabase as supabase } from '@/lib/estimation/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('plan_uploads')
    .select(
      'id, filename, sheet_hint, source, created_at, plan_extractions(id, items, corrected_items, sheets_used, overall_note, model, runtime_seconds, created_at, priced_at, priced_total:priced_bom->totalIncGst)',
    )
    .eq('tenant_id', tenant.id)
    .eq('trade', 'electrical')
    .order('created_at', { ascending: false })
    .limit(25)

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  return Response.json({ ok: true, uploads: data ?? [] })
}
