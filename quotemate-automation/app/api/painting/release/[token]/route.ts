// ════════════════════════════════════════════════════════════════════
// POST /api/painting/release/[token] — the tradie "Send to customer" step.
//
// Token = painting_measurements.estimate_token (the tradie review link's
// capability, same trust model as the /p/[token] page — possession of the
// unguessable estimate_token authorises the release). Stamps released_at,
// which canShowPaintingPrices() + the /r/paint deposit short-link unlock
// against, then texts the customer their full quote (idempotent: a second
// Send is a no-op and never re-texts).
//
// Mirrors app/api/solar/confirm/[token]. Next 16: params is a Promise.
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { paintingReleaseEligibility } from '@/lib/painting/publish-gate'
import { sendPaintingQuoteToCustomer } from '@/lib/painting/release'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60 // the customer send renders/sends a PDF

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const APP_BASE_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.quotemax.com.au'
).replace(/\/$/, '')

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'invalid_token' }, { status: 400 })
  }

  // Optional body: { resend: true } asks to re-text an already-released quote
  // (the on-site edit → "Resend updated quote" flow). Absent/invalid body keeps
  // the original no-body contract.
  let resend = false
  try {
    const body = (await req.json()) as { resend?: unknown } | null
    resend = body?.resend === true
  } catch {
    /* no body — first-release / idempotent path */
  }

  const { data: row } = await supabase
    .from('painting_measurements')
    .select('id, estimate_token, public_token, released_at, routing')
    .eq('estimate_token', token)
    .maybeSingle()
  if (!row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const eligibility = paintingReleaseEligibility({
    alreadyReleasedAt: (row.released_at as string | null) ?? null,
    resend,
  })
  if (!eligibility.ok) {
    return Response.json({ ok: false, error: eligibility.error }, { status: eligibility.status })
  }

  let releasedAt = (row.released_at as string | null) ?? null
  if (eligibility.stamp) {
    releasedAt = new Date().toISOString()
    const { error: updErr } = await supabase
      .from('painting_measurements')
      .update({ released_at: releasedAt })
      .eq('id', row.id)
    if (updErr) {
      return Response.json({ ok: false, error: 'release_failed' }, { status: 500 })
    }
  }

  if (eligibility.send) {
    // Text the customer their full quote AFTER the response so Send never
    // blocks on the SMS. No-op unless a customer mobile was captured at
    // request time. Fires on first release and on an explicit resend.
    after(() => sendPaintingQuoteToCustomer(supabase, { estimateToken: token, appUrl: APP_BASE_URL }))
  }

  return Response.json({ ok: true, released_at: releasedAt, public_token: row.public_token })
}
