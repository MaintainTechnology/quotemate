// POST /api/paint-request/[token]/suggest-address — Geoscape Predictive
// type-ahead proxy for the PUBLIC painting form. No auth: the unguessable
// token IS the capability (same as the parent /api/paint-request/[token]
// route) — the painting_lead_requests row must exist and still be pending.
// Server-side so the GEOSCAPE_API_KEY never reaches the browser.

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

const provider = new PredictiveProvider()

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const { data: lead } = await supabase
    .from('painting_lead_requests')
    .select('token, status')
    .eq('token', token)
    .maybeSingle()
  if (!lead) {
    return Response.json({ ok: false, error: 'Invalid or expired link' }, { status: 404 })
  }
  if ((lead.status as string) !== 'pending') {
    return Response.json({ ok: false, error: 'Invalid or expired link' }, { status: 410 })
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
