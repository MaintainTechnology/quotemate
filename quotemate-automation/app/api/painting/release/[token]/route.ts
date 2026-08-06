// ════════════════════════════════════════════════════════════════════
// POST /api/painting/release/[token] — the tradie "Send to customer" step.
//
// Painting AUTO-SENDS now (spec painting-auto-send), so this is no longer the
// gate: it is the RESEND after an on-site edit, and the RETRY for an
// auto-send that failed. Token = painting_measurements.estimate_token (the
// tradie review link's capability, same trust model as the /p/[token] page).
// Stamps released_at, which canShowPaintingPrices() + the /r/paint short-link
// unlock against, then texts the customer their full quote (idempotent: a
// second Send is a no-op and never re-texts).
//
// The send is AWAITED, not deferred to after(), because the response reports
// { sent } and /p shows "Sent" only on `sent === true`. Deferring it is what
// let 3 of 8 live releases stamp released_at, return ok:true and text nobody.
// A first send that fails rolls the stamp back so the row is held again and
// the button offers a retry — which is also why the AI repaint pre-warm went
// BACK into after(): 10–20 s of image generation inline could push the request
// past maxDuration and skip the rollback entirely.
//
// Mirrors app/api/solar/confirm/[token]. Next 16: params is a Promise.
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { paintingReleaseEligibility } from '@/lib/painting/publish-gate'
import { generatePaintAfterImage } from '@/lib/painting/paint-after'
import { revertPaintingRelease, sendPaintingQuoteToCustomer } from '@/lib/painting/release'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// The PDF render + Twilio run INSIDE the request (the response reports whether
// the SMS went out); the AI repaint pre-warm runs in after() to keep headroom.
export const maxDuration = 60

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
    .select('id, estimate_token, public_token, released_at, quote_sent_at, routing')
    .eq('estimate_token', token)
    .maybeSingle()
  if (!row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  // Both columns matter: released_at alone would make Send a no-op on every
  // dashboard save (released at save time, texted to nobody) — the button
  // would report "not texted" and only work on a second press.
  const eligibility = paintingReleaseEligibility({
    alreadyReleasedAt: (row.released_at as string | null) ?? null,
    alreadySentAt: (row.quote_sent_at as string | null) ?? null,
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

  let sent = false
  if (eligibility.send) {
    // Text the customer their full quote and WAIT for the outcome — the
    // tradie is told what actually happened. No-op (sent: false) unless a
    // customer mobile was captured at request time. Fires on first release
    // and on an explicit resend.
    sent = (await sendPaintingQuoteToCustomer(supabase, { estimateToken: token, appUrl: APP_BASE_URL })).sent
    if (!sent && eligibility.stamp) {
      // The stamp we just wrote promised a delivery that did not happen.
      // Undo it — but only report it undone if the write actually landed:
      // supabase-js resolves { error } instead of throwing, so a swallowed
      // failure here would leave a released row we told the tradie was held.
      const { reverted } = await revertPaintingRelease(supabase, row.public_token as string)
      if (reverted) releasedAt = null
    }
    // The AI repaint is warmed AFTER the response. Inline it would add 10–20 s
    // to a request that must finish inside maxDuration for the revert above to
    // run at all — and the PDF self-heals, because its cache path embeds the
    // repaint timestamp (ensurePaintingPdf) and regenerates on the next
    // download once the image lands.
    after(() => generatePaintAfterImage(row.public_token as string).catch(() => {}))
  }

  return Response.json({ ok: true, sent, released_at: releasedAt, public_token: row.public_token })
}
