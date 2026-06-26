// ════════════════════════════════════════════════════════════════════
// GET /r/paint/[token]/[tier] — residential painting deposit short-link.
//
// Token = painting_measurements.public_token. Reads the stored per-tier
// Stripe Checkout URL (stripe_links[tier], migration 156) and redirects;
// once the deposit is paid it sends the customer back to the quote page
// instead of re-charging. Mirrors app/r/[token]/[tier] + app/r/solar/….
//
// Next 16: params is a Promise (await it).
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { buildPaintRedirectUrl, VALID_PAINT_TIERS } from '@/lib/painting/pay-redirect'
import { paintingDepositLocked } from '@/lib/painting/publish-gate'

export const dynamic = 'force-dynamic'

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
    .select('paid_at, stripe_links, released_at')
    .eq('public_token', token)
    .maybeSingle()
  if (!row) return new Response('Not found', { status: 404 })

  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? ''

  // Locked until the tradie releases the quote — a customer must never reach
  // Stripe against an unreviewed price. Send them to the (gated) quote page.
  if (paintingDepositLocked((row.released_at as string | null) ?? null)) {
    return Response.redirect(`${appUrl}/q/paint/${token}`, 302)
  }

  const stripeUrl = (row.stripe_links as Record<string, string> | null)?.[tier] ?? null
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
