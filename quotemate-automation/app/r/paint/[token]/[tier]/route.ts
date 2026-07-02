// ════════════════════════════════════════════════════════════════════
// GET /r/paint/[token]/[tier] — residential painting deposit short-link.
//
// Token = painting_measurements.public_token. Once the deposit is paid the
// customer is sent back to the quote page instead of re-charged; while
// unpaid + released, a FRESH Stripe Checkout Session is minted per click
// (mirrors app/r/[token]/[tier], 2026-07-02): Sessions die after Stripe's
// 24h max, so the URL stored at save time (migration 156) is usually dead
// by the time the tradie has released the quote and the customer taps the
// SMS link — redirecting to it showed Stripe's "checkout session has timed
// out" page. The stored URL remains only as a mint-failure fallback.
//
// Next 16: params is a Promise (await it).
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { buildPaintRedirectUrl, VALID_PAINT_TIERS } from '@/lib/painting/pay-redirect'
import { paintingDepositLocked } from '@/lib/painting/publish-gate'
import { createPaintingCheckoutSessionForTier } from '@/lib/stripe/painting-checkout'
import { expireCheckoutSession } from '@/lib/stripe/checkout'
import { pipelineLog } from '@/lib/log/pipeline'
import type { PaintingEstimate } from '@/lib/painting/types'

export const dynamic = 'force-dynamic'
// One Stripe Session create runs on the unpaid path — headroom over the
// fast-redirect default so a cold start can't time out mid-mint.
export const maxDuration = 30

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string; tier: string }> }) {
  const { token, tier } = await ctx.params
  if (!VALID_PAINT_TIERS.has(tier)) {
    return new Response('Invalid tier', { status: 400 })
  }

  const { data: row } = await getSupabase()
    .from('painting_measurements')
    .select('paid_at, stripe_links, released_at, estimate')
    .eq('public_token', token)
    .maybeSingle()
  if (!row) return new Response('Not found', { status: 404 })

  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? ''

  // Locked until the tradie releases the quote — a customer must never reach
  // Stripe against an unreviewed price. Send them to the (gated) quote page.
  if (paintingDepositLocked((row.released_at as string | null) ?? null)) {
    return Response.redirect(`${appUrl}/q/paint/${token}`, 302)
  }

  const stored = (row.stripe_links as Record<string, string> | null)?.[tier] ?? null
  let stripeUrl = stored

  // Unpaid → mint a live Session for this click; best-effort with the
  // stored (likely dead) URL as the fallback so the flow never hard-breaks.
  if (!row.paid_at) {
    try {
      const estimate = (row.estimate as PaintingEstimate | null) ?? null
      const fresh = estimate
        ? await createPaintingCheckoutSessionForTier({
            estimate,
            tierKey: tier as 'good' | 'better' | 'best',
            token,
            appUrl,
          })
        : null
      if (fresh) {
        const links = { ...((row.stripe_links as Record<string, string> | null) ?? {}) }
        const replaced = links[tier]
        links[tier] = fresh
        await getSupabase()
          .from('painting_measurements')
          .update({ stripe_links: links })
          .eq('public_token', token)
        // At most ONE payable Session per tier: expire the one replaced
        // (best-effort, tolerant of already-expired/paid) so a second tab
        // can't complete an orphaned older Session.
        if (replaced && replaced !== fresh) await expireCheckoutSession(replaced)
        stripeUrl = fresh
      }
    } catch (e: unknown) {
      pipelineLog('dispatch').err(
        'paint fresh Session mint failed — falling back to stored link',
        e instanceof Error ? e.message : String(e),
        { token: token.slice(0, 8) + '…', tier },
      )
    }
  }

  const dest = buildPaintRedirectUrl({
    paid: !!(row.paid_at as string | null),
    token,
    tier,
    stripeUrl,
    appUrl,
  })

  if (!dest) return new Response('No payment link for this tier', { status: 404 })
  return Response.redirect(dest, 302)
}
