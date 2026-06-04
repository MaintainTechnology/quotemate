// POST /api/painting/3d-location — resolve an address to the lat/lng +
// building bounding box the Cesium 3D viewer flies to and uses as the
// recolour mask region. Geocode → Google Solar buildingInsights (which
// returns the building `center` + `boundingBox`). Keeps GOOGLE_MAPS_API_KEY
// server-side; the client only gets coordinates.
//
// Auth: bearer. Best-effort: if Solar has no building, we still return the
// geocoded point so the viewer can fly there (mask falls back to a radius).

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { parseGeocode } from '@/lib/painting/providers/solar'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BodySchema = z.object({
  address: z.string().min(3).max(300),
  postcode: z.string().max(12).optional(),
  state: z.string().max(8).optional(),
})

async function authed(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return false
  const token = auth.slice(7).trim()
  if (!token) return false
  const { data, error } = await supabase.auth.getUser(token)
  return !error && !!data.user
}

type LatLngBox = { south: number; west: number; north: number; east: number }

/** Pull the building bounding box out of a Solar buildingInsights body. */
function parseBoundingBox(body: unknown): LatLngBox | null {
  const bb = (body as { boundingBox?: { sw?: { latitude?: number; longitude?: number }; ne?: { latitude?: number; longitude?: number } } })?.boundingBox
  const sw = bb?.sw
  const ne = bb?.ne
  if (
    typeof sw?.latitude === 'number' && typeof sw?.longitude === 'number' &&
    typeof ne?.latitude === 'number' && typeof ne?.longitude === 'number'
  ) {
    return { south: sw.latitude, west: sw.longitude, north: ne.latitude, east: ne.longitude }
  }
  return null
}

export async function POST(req: Request) {
  if (!(await authed(req))) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return Response.json({ ok: false, code: 'maps_key_missing' }, { status: 200 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'invalid_request', issues: parsed.error.issues }, { status: 400 })
  }
  const { address, postcode, state } = parsed.data
  const query = [address, postcode, state, 'Australia'].filter(Boolean).join(', ')

  try {
    // 1. Geocode.
    const geoRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=au&key=${encodeURIComponent(apiKey)}`,
    )
    const geo = parseGeocode(await geoRes.json())
    if (!geo.ok) {
      return Response.json({ ok: false, code: 'address_not_resolved', status: geo.status }, { status: 200 })
    }
    const { lat, lng } = geo.location

    // 1b. Ground elevation (Elevation API) for camera framing — best-effort.
    let groundHeight: number | null = null
    try {
      const elRes = await fetch(
        `https://maps.googleapis.com/maps/api/elevation/json?locations=${lat},${lng}&key=${encodeURIComponent(apiKey)}`,
      )
      const el = await elRes.json()
      const m = el?.results?.[0]?.elevation
      if (typeof m === 'number' && Number.isFinite(m)) groundHeight = Math.round(m)
    } catch {
      /* elevation is optional */
    }

    // 2. Solar buildingInsights → center + bounding box (best-effort).
    let boundingBox: LatLngBox | null = null
    let footprint_m2: number | null = null
    let center = { lat, lng }
    try {
      const solarRes = await fetch(
        `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=LOW&key=${encodeURIComponent(apiKey)}`,
      )
      if (solarRes.ok) {
        const solar = await solarRes.json()
        boundingBox = parseBoundingBox(solar)
        const c = (solar as { center?: { latitude?: number; longitude?: number } }).center
        if (typeof c?.latitude === 'number' && typeof c?.longitude === 'number') {
          center = { lat: c.latitude, lng: c.longitude }
        }
        const wr = (solar as { solarPotential?: { wholeRoofStats?: { groundAreaMeters2?: number } } }).solarPotential?.wholeRoofStats
        if (typeof wr?.groundAreaMeters2 === 'number') footprint_m2 = Math.round(wr.groundAreaMeters2)
      }
    } catch {
      // Solar is best-effort; the geocoded point is enough to fly there.
    }

    return Response.json(
      { ok: true, lat: center.lat, lng: center.lng, boundingBox, footprint_m2, groundHeight },
      { status: 200 },
    )
  } catch (e) {
    return Response.json(
      { ok: false, code: 'lookup_failed', detail: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    )
  }
}
