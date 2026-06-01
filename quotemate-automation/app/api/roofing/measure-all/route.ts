// POST /api/roofing/measure-all — measures EVERY structure at the
// address (primary dwelling + detached sheds/garages) and returns an
// aggregated MultiRoofQuote for the dashboard's multi-structure flow.
//
// Same auth + per-tenant rate-card overlay as /api/roofing/measure. No
// data is persisted here — saving a confirmed job goes through
// /api/roofing/save. Read-only measurement, gated to authed tradies.

import { createClient } from '@supabase/supabase-js'
import { MeasureAllRequestSchema } from '@/lib/roofing/request-schema'
import { measureAndPriceRoofs } from '@/lib/roofing/measure'
import { MockRoofingProvider } from '@/lib/roofing/providers/mock'
import { effectiveRateCardFromOverlay } from '@/lib/roofing/rate-card-overlay'

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

async function loadRoofingOverlay(
  tenantId: string,
  primaryTrade: string | null,
): Promise<unknown> {
  try {
    let q = supabase.from('pricing_book').select('overlays').eq('tenant_id', tenantId)
    if (primaryTrade) q = q.eq('trade', primaryTrade)
    const { data } = await q.limit(1).maybeSingle()
    const overlays = (data?.overlays as Record<string, unknown> | null | undefined) ?? null
    return overlays?.roofing_rate_card ?? null
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

  const parsed = MeasureAllRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { address, inputs, perBuilding, use_mock_provider } = parsed.data

  let rateCard
  if (auth.tenantId) {
    const overlayJson = await loadRoofingOverlay(auth.tenantId, auth.primaryTrade)
    if (overlayJson != null) {
      rateCard = effectiveRateCardFromOverlay(overlayJson)
    }
  }

  const result = await measureAndPriceRoofs(address, inputs, {
    provider: use_mock_provider ? new MockRoofingProvider() : undefined,
    rateCard,
    perBuilding,
  })

  if (!result.ok) {
    return Response.json({ ok: false, code: result.code, detail: result.detail }, { status: 200 })
  }

  return Response.json(
    {
      ok: true,
      provider: result.provider,
      quote: result.quote,
      warnings: result.warnings,
    },
    { status: 200 },
  )
}
