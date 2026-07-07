// GET /api/roofing/solar-insight?lat=&lng= — informational Google Solar
// roof breakdown for the measure page (segment count, per-segment area +
// pitch, whole-roof area, imagery quality/date). Gives the tradie an
// aerial-derived view of the roof for estimation.
//
// NOTE: this is a VIEW, not the money path — it runs regardless of the
// ROOFING_SOLAR_ENRICHMENT flag (that flag only gates the priced pitch
// override). Reuses lib/roofing/solar-api so the key stays server-side and
// it never throws. Bearer-authed like the other roofing routes.

import { createClient } from '@supabase/supabase-js'
import { fetchBuildingInsights, resolveSolarOpts } from '@/lib/roofing/solar-api'
import { resolveIdentityRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  // Dual-auth gate: Clerk session token OR legacy Supabase token. This route
  // only needs a valid signed-in tradie (no tenant query).
  const identity = await resolveIdentityRequest(supabase, req)
  if (!identity) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const u = new URL(req.url)
  const lat = Number(u.searchParams.get('lat'))
  const lng = Number(u.searchParams.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ ok: false, code: 'no_coords' }, { status: 400 })
  }

  // Force-enable for the informational view (apiKey resolves from
  // GOOGLE_SOLAR_API_KEY ?? GOOGLE_MAPS_API_KEY).
  const opts = resolveSolarOpts({ enabled: true })
  if (!opts.apiKey) return Response.json({ ok: false, code: 'no_key' }, { status: 200 })

  const res = await fetchBuildingInsights({ lat, lng }, opts)
  if (!res.ok) return Response.json({ ok: false, code: res.code, detail: res.detail }, { status: 200 })

  const i = res.insight
  return Response.json({
    ok: true,
    insight: {
      segmentCount: i.segmentCount,
      totalSegmentAreaM2: Math.round(i.totalSegmentAreaM2),
      weightedMeanPitchDegrees: Math.round(i.weightedMeanPitchDegrees * 10) / 10,
      imageryQuality: i.imageryQuality,
      imageryDate: i.imageryDate,
      segments: i.segments
        .map((s) => ({
          area: Math.round(s.areaMeters2),
          pitch: Math.round(s.pitchDegrees * 10) / 10,
          azimuth: s.azimuthDegrees === null ? null : Math.round(s.azimuthDegrees),
        }))
        .sort((a, b) => b.area - a.area),
    },
  })
}
