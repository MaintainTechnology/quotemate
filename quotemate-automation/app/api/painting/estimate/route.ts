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
import { effectivePaintingRateCardFromOverlay } from '@/lib/painting/rate-card-overlay'
import type { PaintingRateCard } from '@/lib/painting/types'

export const dynamic = 'force-dynamic'
// Solar footprint + Geoscape (address→buildings→sub-resources) + PropRadar
// (search→detail) enrichment run per estimate — raise the ceiling above the
// Vercel Hobby 10s default (needs Pro / Railway). Enrichers no-op without keys.
export const maxDuration = 30

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/** Best-effort — fetch the per-tenant painting rate-card overlay from
 *  pricing_book.overlays.painting_rate_card and shallow-merge it onto the
 *  default. Returns null on any miss so the caller uses the default.
 *
 *  A multi-trade tenant (e.g. electrical + painting) carries one
 *  pricing_book row per trade, and the painting rate card lives on the
 *  PAINTING row — but the tenant's primary (scalar) trade may be
 *  electrical. So we read every row for the tenant and prefer the
 *  painting row's card, then the primary-trade row's, then any row that
 *  happens to carry one. */
async function loadPaintingOverlay(
  tenantId: string,
  primaryTrade: string | null,
): Promise<unknown> {
  try {
    const { data } = await supabase
      .from('pricing_book')
      .select('trade, overlays')
      .eq('tenant_id', tenantId)
    if (!Array.isArray(data) || data.length === 0) return null
    const cardOf = (row: { overlays?: unknown } | undefined): unknown => {
      const overlays = (row?.overlays as Record<string, unknown> | null | undefined) ?? null
      return overlays?.painting_rate_card ?? null
    }
    const byTrade = (t: string) =>
      data.find((r) => (r as { trade?: string }).trade === t)
    return (
      cardOf(byTrade('painting')) ??
      (primaryTrade ? cardOf(byTrade(primaryTrade)) : null) ??
      cardOf(data.find((r) => cardOf(r) != null)) ??
      null
    )
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  // Dual-auth: Clerk session token OR legacy Supabase token. Tenant is
  // optional — no tenant just means the default painting rate card.
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

  let rateCard: PaintingRateCard | undefined
  if (auth.tenantId) {
    const overlayJson = await loadPaintingOverlay(auth.tenantId, auth.primaryTrade)
    if (overlayJson != null) rateCard = effectivePaintingRateCardFromOverlay(overlayJson)
  }

  const result = await estimatePainting(address, inputs, {
    rateCard,
  })

  if (!result.ok) {
    return Response.json({ ok: false, code: result.code, detail: result.detail }, { status: 200 })
  }

  return Response.json({ ok: true, estimate: result.estimate }, { status: 200 })
}
