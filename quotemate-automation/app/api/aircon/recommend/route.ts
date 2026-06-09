// POST /api/aircon/recommend — runs property inputs through the AC
// sizing + recommendation engine and returns an indicative result for
// the dashboard tool. Auth: same bearer-token pattern as
// /api/painting/estimate. Read-only (no tenant-data write in Phase 1).

import { createClient } from '@supabase/supabase-js'
import { RecommendRequestSchema } from '@/lib/aircon/request-schema'
import { climateZoneForPostcode } from '@/lib/aircon/climate'
import { sizeAircon } from '@/lib/aircon/sizing'
import { recommendAircon, mergeAcRateCard, DEFAULT_AC_RATE_CARD } from '@/lib/aircon/recommend'
import type { AcRateCard } from '@/lib/aircon/types'

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

/** Best-effort — read overlays.aircon_rate_card for this tenant. */
async function loadAcOverlay(
  tenantId: string,
  primaryTrade: string | null,
): Promise<unknown> {
  try {
    let q = supabase.from('pricing_book').select('overlays').eq('tenant_id', tenantId)
    if (primaryTrade) q = q.eq('trade', primaryTrade)
    const { data } = await q.limit(1).maybeSingle()
    const overlays = (data?.overlays as Record<string, unknown> | null | undefined) ?? null
    return overlays?.aircon_rate_card ?? null
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

  const parsed = RecommendRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { address, inputs } = parsed.data

  let rateCard: AcRateCard = DEFAULT_AC_RATE_CARD
  if (auth.tenantId) {
    const overlayJson = await loadAcOverlay(auth.tenantId, auth.primaryTrade)
    if (overlayJson != null) rateCard = mergeAcRateCard(overlayJson)
  }

  const { zone, note } = climateZoneForPostcode(address.postcode, address.state)
  const sizing = sizeAircon(zone, inputs)
  const recommendation = recommendAircon({ sizing, inputs, rateCard })

  return Response.json(
    { ok: true, climate_zone: zone, climate_note: note, recommendation },
    { status: 200 },
  )
}
