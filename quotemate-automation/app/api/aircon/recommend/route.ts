// POST /api/aircon/recommend — runs property inputs through the AC
// sizing + recommendation engine and returns an indicative result for
// the dashboard tool. Auth: same bearer-token pattern as
// /api/painting/estimate. A tenant-linked call also persists the result
// to aircon_recommendations (the migration-144 TODO, spec quotes-tab-sync
// Task 3) so it surfaces on the Quotes tab via /api/tenant/trade-jobs and
// the customer page /q/aircon/[token]. The insert is best-effort — a
// failure is logged and the recommendation still returns.

import { createClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { saveAirconRecommendation, supabaseUserIdFor } from '@/lib/aircon/save-recommendation'
import { RecommendRequestSchema } from '@/lib/aircon/request-schema'
import { climateZoneForPostcode } from '@/lib/aircon/climate'
import { sizeAircon } from '@/lib/aircon/sizing'
import { recommendAircon, recommendAirconUnpriced } from '@/lib/aircon/recommend'
import { loadTenantAcRateCard } from '@/lib/aircon/pricing-context'
import { resolveAcLocationEvidence } from '@/lib/aircon/location'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: Request) {
  // Dual-auth: Clerk session token OR legacy Supabase token. Tenant is
  // optional — without tenant-authorised rates the response remains unpriced.
  const resolved = await resolveTenantRequest(supabase, req, 'id, trade, owner_user_id')
  if (!resolved) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const tenantRow = resolved.tenant as
    | { id?: string; trade?: string | null; owner_user_id?: string | null }
    | null
  const auth = {
    tenantId: (tenantRow?.id as string | undefined) ?? null,
    primaryTrade: (tenantRow?.trade as string | null | undefined) ?? null,
    // created_by is a uuid → auth.users FK; a Clerk `user_…` id would fail
    // the insert, so resolve the Supabase auth id (see save-recommendation).
    createdBy: supabaseUserIdFor(resolved.identity, tenantRow),
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

  const rateCard = auth.tenantId
    ? await loadTenantAcRateCard(supabase, auth.tenantId, auth.primaryTrade)
    : null

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
  const recommendation = rateCard
    ? recommendAircon({ sizing, inputs, rateCard })
    : recommendAirconUnpriced({ sizing, inputs })

  // Persist for the Quotes tab + customer share page (migration 144).
  const saved =
    recommendation.pricing_status === 'priced'
      ? await saveAirconRecommendation(supabase, {
          tenantId: auth.tenantId,
          createdBy: auth.createdBy,
          address,
          recommendation,
        })
      : null

  return Response.json(
    { ok: true, climate_zone: zone, climate_note: note, location, recommendation, saved },
    { status: 200 },
  )
}
