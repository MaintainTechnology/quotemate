// POST /api/painting/estimate — runs an address + job inputs through the
// painting orchestrator and returns { ok, estimate } for the dashboard
// painting tool.
//
// Auth: same bearer-token pattern as /api/roofing/measure — the
// dashboard passes the Supabase access token. No tenant-data write
// happens here (Phase 1: read-only estimate). The orchestrator uses the
// Google Solar footprint lookup (mock fallback when no key is set).

import { createClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { EstimateRequestSchema } from '@/lib/painting/request-schema'
import { estimatePainting } from '@/lib/painting/measure'
import { loadPaintingRateCard } from '@/lib/painting/quote-dispatch'

export const dynamic = 'force-dynamic'
// Solar footprint + Geoscape (address→buildings→sub-resources) + PropRadar
// (search→detail) enrichment run per estimate — raise the ceiling above the
// Vercel Hobby 10s default (needs Pro / Railway). Enrichers no-op without keys.
export const maxDuration = 30

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: Request) {
  // A signed-in user without an owned pricing account cannot quote defaults.
  const resolved = await resolveTenantRequest(supabase, req, 'id, trade')
  if (!resolved) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const tenantRow = resolved.tenant as { id?: string; trade?: string | null } | null
  const auth = {
    tenantId: (tenantRow?.id as string | undefined) ?? null,
    primaryTrade: (tenantRow?.trade as string | null | undefined) ?? null,
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = EstimateRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { address, inputs } = parsed.data

  const rateCard = auth.tenantId
    ? await loadPaintingRateCard(supabase, auth.tenantId, auth.primaryTrade)
    : undefined
  if (!rateCard) {
    return Response.json({ ok: false, code: 'tenant_pricing_required',
      detail: 'Complete this account’s painting rates and GST setting before estimating.' }, { status: 422 })
  }

  const result = await estimatePainting(address, inputs, {
    rateCard,
  })

  if (!result.ok) {
    return Response.json({ ok: false, code: result.code, detail: result.detail }, { status: 200 })
  }

  return Response.json({ ok: true, estimate: result.estimate }, { status: 200 })
}
