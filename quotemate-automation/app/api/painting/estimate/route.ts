// POST /api/painting/estimate — runs an address + job inputs through the
// painting orchestrator and returns { ok, estimate } for the dashboard's
// two-tab painting tool.
//
// Auth: same bearer-token pattern as /api/roofing/measure — the
// dashboard passes the Supabase access token. No tenant-data write
// happens here (Phase 1: read-only estimate). `source` selects the tab:
//   'rea'  → realestate.com.au provider (inert until a scraper/paste
//            backend is wired; demo toggle returns sample data)
//   'auto' → the "other tools" provider stack (Solar/Geoscape/Domain —
//            mock until their adapters + keys land)

import { createClient } from '@supabase/supabase-js'
import { EstimateRequestSchema } from '@/lib/painting/request-schema'
import { estimatePainting } from '@/lib/painting/measure'
import { effectivePaintingRateCardFromOverlay } from '@/lib/painting/rate-card-overlay'
import type { PaintingRateCard } from '@/lib/painting/types'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function userAndTenantFromBearer(
  req: Request,
): Promise<{ userId: string; tenantId: string | null; primaryTrade: string | null } | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, trade')
    .eq('owner_user_id', data.user.id)
    .maybeSingle()
  return {
    userId: data.user.id,
    tenantId: (tenant?.id as string | undefined) ?? null,
    primaryTrade: (tenant?.trade as string | null | undefined) ?? null,
  }
}

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
  const auth = await userAndTenantFromBearer(req)
  if (!auth) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
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

  const { address, inputs, source, use_mock_provider } = parsed.data

  let rateCard: PaintingRateCard | undefined
  if (auth.tenantId) {
    const overlayJson = await loadPaintingOverlay(auth.tenantId, auth.primaryTrade)
    if (overlayJson != null) rateCard = effectivePaintingRateCardFromOverlay(overlayJson)
  }

  const result = await estimatePainting(address, inputs, {
    source: source ?? 'auto',
    useMock: use_mock_provider,
    rateCard,
  })

  if (!result.ok) {
    return Response.json({ ok: false, code: result.code, detail: result.detail }, { status: 200 })
  }

  return Response.json({ ok: true, estimate: result.estimate }, { status: 200 })
}
