// POST /api/painting/structures — detect every structure at an address so
// the paint estimate tool can offer a structure picker (main dwelling +
// sheds/garages/granny flats).
//
// Reuses the solar/roofing Geoscape discovery (detectPropertyBuildings —
// primary-first, ≤6 buildings, ~6 Geoscape credits, no Google spend) and
// maps to lightweight picker rows. Returns { ok:true, structures: [] }
// when detection is unavailable (no key / provider error / nothing
// measurable) — the client hides the picker.
//
// Auth: bearer (Clerk session token OR legacy Supabase token), same gate
// as the other painting dashboard routes.

import { createClient } from '@supabase/supabase-js'
import { detectPropertyBuildings } from '@/lib/solar/buildings'
import { toPaintStructureOptions } from '@/lib/painting/structures'
import { PaintAddressSchema } from '@/lib/painting/request-schema'
import { resolveIdentityRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'
// Geoscape's per-building sub-resource fan-out can take a while at 6 buildings.
export const maxDuration = 30

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: Request) {
  const identity = await resolveIdentityRequest(supabase, req)
  if (!identity) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = PaintAddressSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const buildings = await detectPropertyBuildings(parsed.data)
  return Response.json({ ok: true, structures: toPaintStructureOptions(buildings) })
}
