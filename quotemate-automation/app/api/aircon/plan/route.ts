// POST /api/aircon/plan — floor-plan-driven AC sizing + indicative
// ducted/split layout design.
//
// multipart/form-data: `plan` (PDF or PNG/JPEG/WebP, ≤32 MB), `address`
// (JSON, AcAddressSchema), `inputs` (JSON, AcInputsSchema). Pipeline:
// vision extraction (rooms + polygons) → scale resolution (real areas)
// → volumetric sizing (real rooms) → deterministic layout design →
// rate-card recommendation. Money stays in the rate card; the model
// never prices anything. Auth: bearer pattern as /api/aircon/recommend.

import { createClient } from '@supabase/supabase-js'
import { AcAddressSchema, AcInputsSchema } from '@/lib/aircon/request-schema'
import { climateZoneForPostcode } from '@/lib/aircon/climate'
import { sizeAircon } from '@/lib/aircon/sizing'
import { recommendAircon, mergeAcRateCard, DEFAULT_AC_RATE_CARD } from '@/lib/aircon/recommend'
import { resolveAcLocationEvidence } from '@/lib/aircon/location'
import { runPlanExtraction, PLAN_MEDIA_TYPES, type PlanMediaType } from '@/lib/aircon/plan-extract'
import { resolveRoomAreas } from '@/lib/aircon/plan-scale'
import { designAcLayout } from '@/lib/aircon/design'
import type { AcPlanAreaEvidence, AcRateCard, RoomType } from '@/lib/aircon/types'

export const dynamic = 'force-dynamic'
// The vision read of a full plan can take minutes (Vercel Pro / Railway).
export const maxDuration = 300

const MAX_PLAN_BYTES = 32 * 1024 * 1024

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
async function loadAcOverlay(tenantId: string, primaryTrade: string | null): Promise<unknown> {
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

function bad(error: string, status: number, extra?: Record<string, unknown>) {
  return Response.json({ ok: false, error, ...(extra ?? {}) }, { status })
}

export async function POST(req: Request) {
  const auth = await userAndTenantFromBearer(req)
  if (!auth) return bad('unauthorized', 401)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return bad('invalid_form_data', 400)
  }

  const file = form.get('plan')
  if (!(file instanceof File)) return bad('missing_plan_file', 400)
  const mediaType = (file.type || '').toLowerCase()
  if (!(PLAN_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    return bad('unsupported_plan_type', 400, { detail: `got "${mediaType || 'unknown'}"` })
  }
  if (file.size > MAX_PLAN_BYTES) return bad('plan_too_large', 400)

  const parseJsonField = (name: string): unknown => {
    const raw = form.get(name)
    if (typeof raw !== 'string') return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  const addressParsed = AcAddressSchema.safeParse(parseJsonField('address'))
  if (!addressParsed.success) {
    return bad('invalid_address', 400, { issues: addressParsed.error.issues })
  }
  const inputsParsed = AcInputsSchema.safeParse(parseJsonField('inputs'))
  if (!inputsParsed.success) {
    return bad('invalid_inputs', 400, { issues: inputsParsed.error.issues })
  }
  const address = addressParsed.data
  const inputs = inputsParsed.data

  let rateCard: AcRateCard = DEFAULT_AC_RATE_CARD
  if (auth.tenantId) {
    const overlayJson = await loadAcOverlay(auth.tenantId, auth.primaryTrade)
    if (overlayJson != null) rateCard = mergeAcRateCard(overlayJson)
  }

  const { zone, note } = climateZoneForPostcode(address.postcode, address.state)

  // Vision read of the plan and Google location evidence are independent.
  const planBytes = new Uint8Array(await file.arrayBuffer())
  const [extractionSettled, location] = await Promise.all([
    runPlanExtraction({ data: planBytes, mediaType: mediaType as PlanMediaType }).then(
      (r) => ({ ok: true as const, r }),
      (e: unknown) => ({ ok: false as const, detail: e instanceof Error ? e.message : String(e) }),
    ),
    resolveAcLocationEvidence(address, {
      geocodeApiKey: process.env.GOOGLE_GEOCODE_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY,
      weatherApiKey: process.env.GOOGLE_WEATHER_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY,
      solarApiKey: process.env.GOOGLE_SOLAR_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY,
      storeys: inputs.storeys ?? 1,
    }),
  ])

  if (!extractionSettled.ok) {
    return bad('plan_extraction_failed', 502, { detail: extractionSettled.detail })
  }
  const extraction = extractionSettled.r
  if (!extraction.parsed || extraction.parsed.rooms.length === 0) {
    return bad('plan_unreadable', 422, {
      detail:
        extraction.parsed?.overall_note ||
        'No rooms could be read off this file - try a clearer floor-plan page or photo.',
    })
  }

  const resolved = resolveRoomAreas({
    rooms: extraction.parsed.rooms,
    statedTotalM2: extraction.parsed.stated_total_area_m2,
    enteredTotalM2: inputs.floor_area_m2 ?? null,
    solarFloorAreaM2: location.building.ok ? location.building.estimated_floor_area_m2 : null,
  })

  const conditioned = resolved.rooms.filter(
    (r): r is typeof r & { load_type: RoomType } => r.load_type !== null,
  )
  if (conditioned.length === 0) {
    return bad('plan_no_conditioned_rooms', 422, {
      detail:
        'The plan was read but no bedrooms/living spaces were identified - check the file shows the room layout.',
    })
  }

  const planEvidence: AcPlanAreaEvidence = {
    rooms: conditioned.map((r) => ({
      name: r.name,
      room_type: r.load_type,
      area_m2: r.area_m2,
    })),
    dimensioned: resolved.dimensioned,
    capture_note: `${conditioned.length} conditioned of ${resolved.rooms.length} rooms read from "${file.name}" (page ${extraction.parsed.page}).`,
  }

  const sizing = sizeAircon(zone, inputs, null, planEvidence)
  const design = designAcLayout({
    page: extraction.parsed.page,
    rooms: resolved.rooms,
    loads: sizing.rooms,
    ducted_kw: sizing.ducted_kw,
    ceiling_height: inputs.ceiling_height,
    storeys: sizing.storeys,
  })
  const recommendation = recommendAircon({ sizing, inputs, rateCard })

  return Response.json(
    {
      ok: true,
      climate_zone: zone,
      climate_note: note,
      location,
      plan: {
        filename: file.name,
        page: extraction.parsed.page,
        model: extraction.model,
        runtime_seconds: extraction.runtimeSeconds,
        rooms: resolved.rooms,
        dimensioned: resolved.dimensioned,
        total_area_m2: resolved.total_area_m2,
        stated_total_area_m2: extraction.parsed.stated_total_area_m2,
        overall_note: extraction.parsed.overall_note,
        notes: resolved.notes,
        warnings: resolved.warnings,
      },
      design,
      recommendation,
    },
    { status: 200 },
  )
}
