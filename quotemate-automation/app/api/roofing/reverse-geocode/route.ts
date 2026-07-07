// POST /api/roofing/reverse-geocode — turns a {lng, lat} click on the
// dashboard map into an AU street address via Nominatim. The dashboard
// uses this to re-run the measurement when the tradie clicks an
// adjacent building (granny flat instead of the main house, etc.).
//
// Server-side only — Nominatim's terms request a User-Agent header
// which browsers cannot set. Routing it through here also lets us
// rate-limit + cache later without changing the client.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { reverseGeocode } from '@/lib/roofing/geocode'
import { resolveIdentityRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const RequestSchema = z.object({
  lng: z.number(),
  lat: z.number(),
})

export async function POST(req: Request) {
  // Dual-auth gate: Clerk session token OR legacy Supabase token. This proxy
  // only needs a valid signed-in tradie (no tenant query).
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
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const result = await reverseGeocode(parsed.data)
  return Response.json(result, { status: 200 })
}
