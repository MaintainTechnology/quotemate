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
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import {
  createRoofPricingRun,
  loadTenantRoofingPricingContext,
  roofRunRequestDigest,
} from '@/lib/roofing/pricing-authority'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Dual-auth: Clerk session token (→ clerk_user_id) OR legacy Supabase token
// (→ owner_user_id). Tenant is optional — a missing tenant just means no
// rate-card overrides, not an auth failure, so we never 404.
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

  const { address, inputs, perBuilding, perBuildingEdges, use_mock_provider } = parsed.data

  if (!auth.tenantId) {
    return Response.json(
      { ok: false, code: 'tenant_pricing_required', detail: 'Complete roofing pricing setup.' },
      { status: 200 },
    )
  }
  const pricing = await loadTenantRoofingPricingContext(
    supabase,
    auth.tenantId,
    auth.primaryTrade,
  )
  if (!pricing) {
    return Response.json(
      {
        ok: false,
        code: 'tenant_pricing_required',
        detail: 'Complete every roofing rate and GST setting before measuring a customer price.',
      },
      { status: 200 },
    )
  }
  const runSecret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!runSecret) {
    return Response.json(
      { ok: false, code: 'pricing_authority_unavailable', detail: 'Pricing proof is not configured.' },
      { status: 200 },
    )
  }

  const result = await measureAndPriceRoofs(address, inputs, {
    provider: use_mock_provider ? new MockRoofingProvider() : undefined,
    rateCard: pricing.rateCard,
    perBuilding,
    perBuildingEdges,
  })

  if (!result.ok) {
    return Response.json({ ok: false, code: result.code, detail: result.detail }, { status: 200 })
  }

  const digest = roofRunRequestDigest({
    address,
    provider: result.provider,
    quote: result.quote,
  })
  const run = createRoofPricingRun({
    context: pricing,
    requestDigest: digest,
    secret: runSecret,
  })

  return Response.json(
    {
      ok: true,
      pricing_status: 'priced',
      pricing_authority: pricing.authority,
      run_token: run.token,
      run_id: run.proof.run_id,
      run_expires_at: new Date(run.proof.expires_at).toISOString(),
      provider: result.provider,
      quote: result.quote,
      warnings: result.warnings,
    },
    { status: 200 },
  )
}
