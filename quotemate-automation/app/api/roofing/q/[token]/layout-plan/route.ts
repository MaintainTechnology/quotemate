// /api/roofing/q/[token]/layout-plan — the AI work-strategy layout plan
// (spec specs/quote-visual-parity.md R6e).
//
//   GET  — return the stored plan + status. Never generates (customer pages
//          and the PDF read through this; they must never bill Gemini).
//   POST — generate (or return the cached) plan via generateRoofLayoutPlan.
//          Tradie-initiated from /m/[token] only; CAS-guarded, best-effort.
//
// Token-gated like the sibling static-map/after-image routes: the unguessable
// public_token is the capability.

import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateRoofLayoutPlan } from '@/lib/roofing/layout-plan'
import { ensureRoofQuotePdf } from '@/lib/quote/pdf'

export const dynamic = 'force-dynamic'
// Vision call over the aerial takes seconds; Hobby's 10s would time out.
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'bad_token' }, { status: 400 })
  }
  const { data: row, error } = await supabase
    .from('roofing_measurements')
    .select('layout_plan, layout_status')
    .eq('public_token', token)
    .maybeSingle()
  if (error || !row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  return Response.json({
    ok: true,
    status: (row.layout_status as string | null) ?? null,
    plan: row.layout_status === 'ready' ? (row.layout_plan ?? null) : null,
  })
}

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'bad_token' }, { status: 400 })
  }
  const result = await generateRoofLayoutPlan(token)
  if (result.ok) {
    // Refresh the cached quote PDF so the next download carries the layout
    // figure — in after() so the tradie's response isn't held for a second
    // slow render (repo fast-ack convention; ensureRoofQuotePdf never throws).
    after(() => ensureRoofQuotePdf(token, { regenerate: true }))
    return Response.json({ ok: true, plan: result.plan })
  }
  const status = result.status === 'busy' ? 409 : result.status === 'skipped' ? 422 : 502
  // A rate-limit failure (429/RESOURCE_EXHAUSTED) is transient and the button
  // is safe to re-click — surface that instead of the raw Gemini error string.
  const rateLimited = /\b429\b|RESOURCE_EXHAUSTED/.test(result.error ?? '')
  const error = rateLimited
    ? 'The map service is rate-limited right now — give it a minute and try again.'
    : (result.error ?? null)
  return Response.json({ ok: false, status: result.status, error, rateLimited }, { status })
}
