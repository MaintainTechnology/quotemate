// POST /api/quote-request/[token]/suggest-address — Geoscape Predictive
// type-ahead proxy for the PUBLIC generic form. No auth: the unguessable
// token IS the capability (same as the parent route) — the
// trade_lead_requests row must exist and still be pending.
// Server-side so GEOSCAPE_API_KEY never reaches the browser.
//
// spec: specs/generic-quote-request-form.md §3.
//
// Gate vocabulary matches the parent POST exactly (both key off
// status === 'pending'). painting's pair drifted — its mint writes
// 'pending', suggest-address 410s on anything else, its POST rejects only
// 'submitted', and a test seeds 'new'. Migration 190 constrains the enum in
// the DB so that cannot recur here.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { PredictiveProvider } from '@/lib/roofing/providers/predictive'
import { AU_STATES } from '@/lib/quote-request/fields'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const RequestSchema = z.object({
  query: z.string().min(3).max(200),
  state: z.enum(AU_STATES).optional(),
})

const provider = new PredictiveProvider()

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  const { data: lead, error } = await supabase
    .from('trade_lead_requests')
    .select('token, status')
    .eq('token', token)
    .maybeSingle()
  if (error) {
    console.error('[quote-request/suggest-address] lead lookup failed', error.message)
    return Response.json({ ok: false, error: 'lookup_failed' }, { status: 503 })
  }
  if (!lead) return Response.json({ ok: false, error: 'invalid_link' }, { status: 404 })
  if ((lead.status as string) !== 'pending') {
    return Response.json({ ok: false, error: 'link_expired' }, { status: 410 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'invalid_request', issues: parsed.error.issues }, { status: 400 })
  }

  // The provider's own result shape is passed through verbatim, always 200 —
  // including { ok:false, code:'provider_unavailable' }, which
  // AddressAutocomplete treats as an empty list. A Geoscape outage must
  // never stop the customer typing an address by hand.
  const result = await provider.suggest(parsed.data.query, parsed.data.state)
  return Response.json(result, { status: 200 })
}
