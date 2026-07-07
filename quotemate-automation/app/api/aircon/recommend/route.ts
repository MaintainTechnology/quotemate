// POST /api/aircon/recommend — runs property inputs through the AC
// sizing + recommendation engine and returns an indicative result for
// the dashboard tool. Auth: same bearer-token pattern as
// /api/painting/estimate. Read-only (no tenant-data write in Phase 1).

import { createClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { RecommendRequestSchema } from '@/lib/aircon/request-schema'
import { climateZoneForPostcode } from '@/lib/aircon/climate'
import { sizeAircon } from '@/lib/aircon/sizing'
import { recommendAircon, mergeAcRateCard, DEFAULT_AC_RATE_CARD } from '@/lib/aircon/recommend'
import { resolveAcLocationEvidence } from '@/lib/aircon/location'
import type { AcRateCard } from '@/lib/aircon/types'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

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
  // Dual-auth: Clerk session token OR legacy Supabase token. Tenant is
  // optional — no tenant just means the default aircon rate card.
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
  const location = await resolveAcLocationEvidence(address, {
    geocodeApiKey: process.env.GOOGLE_GEOCODE_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY,
    weatherApiKey: process.env.GOOGLE_WEATHER_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY,
    solarApiKey: process.env.GOOGLE_SOLAR_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY,
    storeys: inputs.storeys ?? 1,
  })
  // When the tradie left floor area blank, the Google Solar roof
  // footprint (× storeys × wall correction) stands in for the
  // typical-room-mix guess. An entered area always wins.
  const areaEvidence =
    location.building.ok && inputs.floor_area_m2 == null
      ? {
          solar_floor_area_m2: location.building.estimated_floor_area_m2,
          capture_note: `${location.building.footprint_m2} m2 roof footprint${location.building.imagery_date ? ` (satellite imagery ${location.building.imagery_date})` : ''} × ${location.building.storeys_assumed} storey${location.building.storeys_assumed === 1 ? '' : 's'} × 0.85 wall correction.`,
        }
      : null
  const sizing = sizeAircon(zone, inputs, areaEvidence)
  const recommendation = recommendAircon({ sizing, inputs, rateCard })

  return Response.json(
    { ok: true, climate_zone: zone, climate_note: note, location, recommendation },
    { status: 200 },
  )
}
