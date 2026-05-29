// POST /api/roofing/measure — runs the address through the orchestrator
// and returns { ok, metrics, price, provider, warnings } for the
// dashboard's measurement page.
//
// Auth: same bearer-token pattern as /api/tenant/me — the dashboard
// passes the Supabase access token. No tenant-data write happens here
// (Phase 1: read-only measurement). The route is gated to authed users
// so the Geoscape calls only fire for tradies with a session.

import { createClient } from '@supabase/supabase-js'
import { MeasureRequestSchema } from '@/lib/roofing/request-schema'
import { measureAndPriceRoof } from '@/lib/roofing/measure'
import { MockRoofingProvider } from '@/lib/roofing/providers/mock'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function userIdFromBearer(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

export async function POST(req: Request) {
  const userId = await userIdFromBearer(req)
  if (!userId) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = MeasureRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { address, inputs, use_mock_provider } = parsed.data

  const result = await measureAndPriceRoof(address, inputs, {
    provider: use_mock_provider ? new MockRoofingProvider() : undefined,
  })

  if (!result.ok) {
    return Response.json({ ok: false, code: result.code, detail: result.detail }, { status: 200 })
  }

  return Response.json(
    {
      ok: true,
      provider: result.provider,
      metrics: result.metrics,
      price: result.price,
      warnings: result.warnings,
    },
    { status: 200 },
  )
}
