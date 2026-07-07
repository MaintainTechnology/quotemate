// POST /api/roofing/measure — runs the address through the orchestrator
// and returns { ok, metrics, price, provider, warnings } for the
// dashboard's measurement page.
//
// Auth: same bearer-token pattern as /api/tenant/me — the dashboard
// passes the Supabase access token. No tenant-data write happens here
// (Phase 1: read-only measurement). The route is gated to authed users
// so the Geoscape calls only fire for tradies with a session.

import { createClient } from '@supabase/supabase-js'
import { MeasureRequestSchema } from '@/lib/roofing/request-schema'
import { measureAndPriceRoof } from '@/lib/roofing/measure'
import { MockRoofingProvider } from '@/lib/roofing/providers/mock'
import { effectiveRateCardFromOverlay } from '@/lib/roofing/rate-card-overlay'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Dual-auth: Clerk session token (→ clerk_user_id) OR legacy Supabase token
// (→ owner_user_id). The tenant is used to fetch the per-tenant roofing
// rate-card overlay before pricing. Missing tenant just means no overrides,
// not an auth failure — so we never 404.
async function userAndTenantFromBearer(
  req: Request,
): Promise<{ userId: string; tenantId: string | null; primaryTrade: string | null } | null> {
  const resolved = await resolveTenantRequest(supabase, req, 'id, trade')
  if (!resolved) return null
  const tenant = resolved.tenant as { id?: string; trade?: string | null } | null
  return {
    userId: resolved.identity.userId,
    tenantId: tenant?.id ?? null,
    primaryTrade: tenant?.trade ?? null,
  }
}

/** Best-effort — fetch the per-tenant roofing rate-card overlay from
 *  pricing_book.overlays.roofing_rate_card. Returns null on any miss so
 *  the caller falls back to DEFAULT_ROOFING_RATE_CARD. */
async function loadRoofingOverlay(
  tenantId: string,
  primaryTrade: string | null,
): Promise<unknown> {
  try {
    let q = supabase
      .from('pricing_book')
      .select('overlays')
      .eq('tenant_id', tenantId)
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

  const parsed = MeasureRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { address, inputs, use_mock_provider } = parsed.data

  // Phase 1 rate-card override — load the per-tenant overlay from
  // pricing_book.overlays.roofing_rate_card and merge it onto the
  // DEFAULT_ROOFING_RATE_CARD. Forward-only: this rate is used for the
  // current measurement only; existing quotes are not re-priced.
  let rateCard
  if (auth.tenantId) {
    const overlayJson = await loadRoofingOverlay(auth.tenantId, auth.primaryTrade)
    if (overlayJson != null) {
      rateCard = effectiveRateCardFromOverlay(overlayJson)
    }
  }

  const result = await measureAndPriceRoof(address, inputs, {
    provider: use_mock_provider ? new MockRoofingProvider() : undefined,
    rateCard,
  })

  if (!result.ok) {
    return Response.json({ ok: false, code: result.code, detail: result.detail }, { status: 200 })
  }

  return Response.json(
    {
      ok: true,
      provider: result.provider,
      metrics: result.metrics,
      price: result.price,
      warnings: result.warnings,
    },
    { status: 200 },
  )
}
