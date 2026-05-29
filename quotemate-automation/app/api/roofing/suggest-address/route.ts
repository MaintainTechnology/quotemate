// POST /api/roofing/suggest-address — proxies the dashboard's type-ahead
// input to the Geoscape Predictive API. Server-side so the GEOSCAPE_API_KEY
// never reaches the browser.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { PredictiveProvider } from '@/lib/roofing/providers/predictive'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const RequestSchema = z.object({
  query: z.string().min(3).max(200),
  state: z.enum(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']).optional(),
})

async function userIdFromBearer(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

const provider = new PredictiveProvider()

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
