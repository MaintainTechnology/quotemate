// POST /api/roofing/suggest-address — proxies the dashboard's type-ahead
// input to the Geoscape Predictive API. Server-side so the GEOSCAPE_API_KEY
// never reaches the browser.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { PredictiveProvider } from '@/lib/roofing/providers/predictive'
import { resolveIdentityRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const RequestSchema = z.object({
  query: z.string().min(3).max(200),
  state: z.enum(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']).optional(),
})

const provider = new PredictiveProvider()

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
  const result = await provider.suggest(parsed.data.query, parsed.data.state)
  return Response.json(result, { status: 200 })
}
