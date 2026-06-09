// PATCH /api/tenant/estimator/extract/[id] — save the tradie's corrected counts.
//
// Body: { corrected_items: Array<{ type: string; symbol?: string; count: number }> }
// Scoped to the authed tenant; a mismatched id/tenant returns 404.

import { tenantFromBearer, estimatorSupabase as supabase } from '@/lib/estimation/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type CorrectedItem = { type: string; symbol: string; count: number }

function cleanCorrected(input: unknown): CorrectedItem[] | null {
  if (!Array.isArray(input)) return null
  const out: CorrectedItem[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const type = String(r.type ?? r.item ?? r.name ?? '').trim()
    if (!type) continue
    const count = Number(r.count)
    out.push({
      type,
      symbol: r.symbol != null ? String(r.symbol) : '',
      count: Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0,
    })
  }
  return out
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const corrected = cleanCorrected((body as Record<string, unknown>)?.corrected_items)
  if (corrected === null) {
    return Response.json({ ok: false, error: 'corrected_items must be an array' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('plan_extractions')
    .update({ corrected_items: corrected, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenant.id)
    .select('id')
    .maybeSingle()

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  if (!data) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })

  return Response.json({ ok: true, savedCount: corrected.length })
}
