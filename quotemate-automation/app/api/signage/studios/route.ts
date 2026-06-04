// /api/signage/studios
//   GET  → list this org's studios (for the manage-studios UI)
//   POST → add one real studio { name, address?, region?, state?, postcode?,
//          contact_phone?, contact_email? } (e.g. from address autocomplete)
//
// Auth: bearer → org. Service-role client; org-scoped in the app layer.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { orgFromBearer } from '@/lib/signage/org'
import { buildGeocodeUrl, parseGeocode } from '@/lib/signage/maps'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  const ctx = await orgFromBearer(supabase, req)
  if (!ctx) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { data, error } = await supabase
    .from('studios')
    .select('id, name, region, status, address, state, postcode, lat, lng, place_id')
    .eq('org_id', ctx.orgId)
    .order('region')
    .order('name')
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  return Response.json({ ok: true, studios: data ?? [] })
}

const CreateStudioSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(240).optional(),
  region: z.string().trim().max(60).optional(),
  state: z.string().trim().max(20).optional(),
  postcode: z.string().trim().max(12).optional(),
  contact_phone: z.string().trim().max(40).optional(),
  contact_email: z.string().trim().max(120).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  place_id: z.string().trim().max(300).optional(),
})

export async function POST(req: Request) {
  const ctx = await orgFromBearer(supabase, req)
  if (!ctx) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = CreateStudioSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'invalid_request', issues: parsed.error.issues }, { status: 400 })
  }
  const d = parsed.data

  // Coordinates: use provided ones (e.g. from Places search), else geocode
  // the address so the location shows on the static map. Best-effort.
  let lat = d.lat ?? null
  let lng = d.lng ?? null
  let placeId = d.place_id ?? null
  if ((lat === null || lng === null) && d.address) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY
    if (apiKey) {
      try {
        const g = parseGeocode(await (await fetch(buildGeocodeUrl(d.address, apiKey))).json())
        if (g) {
          lat = g.lat
          lng = g.lng
          placeId = placeId ?? g.place_id
        }
      } catch {
        /* geocode is best-effort — the studio still saves without coords */
      }
    }
  }

  const { data, error } = await supabase
    .from('studios')
    .insert({
      org_id: ctx.orgId,
      name: d.name,
      address: d.address ?? null,
      region: d.region ?? null,
      state: d.state ?? null,
      postcode: d.postcode ?? null,
      contact_phone: d.contact_phone ?? null,
      contact_email: d.contact_email ?? null,
      lat,
      lng,
      place_id: placeId,
      status: 'open',
    })
    .select('id, name, region, status, address, state, postcode, lat, lng, place_id')
    .single()
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  return Response.json({ ok: true, studio: data })
}
