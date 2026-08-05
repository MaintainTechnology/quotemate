// ════════════════════════════════════════════════════════════════════
// GET /r/paint/[token]/[tier] — residential painting pay short-link.
//
// Token = painting_measurements.public_token. Since spec
// painting-site-visit-first (owner decision 2026-08-05) the ONLY customer
// payment for painting is the flat $99 refundable site visit — exactly
// roofing's model (/r/roof/[token]/[tier]). The literal tier 'inspection'
// mints it for a row the pricer routed to an on-site measure OR a row the
// tradie has released; a HELD row gets a friendly 302 back to the quote
// page (which shows the holding message) instead of a bare 400.
//
// Legacy G/B/B tier requests — the per-tier 30% deposit links texted before
// the model changed — 302 onto the inspection mint, so every previously-sent
// link still lands on a payable page. The 30% Session-creation path
// (createPaintingCheckoutSessionForTier) stays in the codebase but is no
// longer reachable from this route. Any other tier keeps the 400.
//
// Next 16: params is a Promise (await it).
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import {
  PAINT_INSPECTION_TIER,
  resolvePaintMintTier,
  VALID_PAINT_TIERS,
} from '@/lib/painting/pay-redirect'
import { createPaintingSiteVisitSession } from '@/lib/stripe/painting-checkout'
import { connectDestinationForTenantId } from '@/lib/stripe/connect'
import { expireCheckoutSession } from '@/lib/stripe/checkout'
import { canTakePayment } from '@/lib/quote/booking'
import { loadTenantBookingOptions } from '@/lib/quote/trade-booking'
import { pipelineLog } from '@/lib/log/pipeline'

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

  if (tier === PAINT_INSPECTION_TIER) {
    return mintPaintSiteVisit(token)
  }

  // Legacy G/B/B deposit links → the $99 site-visit mint (spec
  // painting-site-visit-first R2). Pure string check, no row read needed.
  if (VALID_PAINT_TIERS.has(tier)) {
    const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? ''
    return Response.redirect(`${appUrl}/r/paint/${token}/${PAINT_INSPECTION_TIER}`, 302)
  }

  return new Response('Invalid tier', { status: 400 })
}

/**
 * The flat $99 refundable site-visit mint — painting's only customer payment.
 * Mirrors /r/roof/[token]/[tier] (already-paid → booking page;
 * canTakePayment() refusal; Connect routing) with painting's one-payable-
 * session pattern on top: the fresh Session is stored under
 * stripe_links.inspection and the one it replaces is expired, so a second
 * tab can't complete an orphaned older Session.
 */
async function mintPaintSiteVisit(token: string): Promise<Response> {
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? ''

  const { data: row } = await getSupabase()
    .from('painting_measurements')
    .select('public_token, tenant_id, address, routing, released_at, paid_at, stripe_links')
    .eq('public_token', token)
    .maybeSingle()
  if (!row) return new Response('Not found', { status: 404 })

  // Inspection-routed OR released rows only (spec painting-site-visit-first
  // R2). A HELD row paying $99 would bypass the review-required design — but
  // an old link deserves a human landing, so it 302s to the quote page's
  // holding message rather than a bare 400.
  const gate = resolvePaintMintTier(
    PAINT_INSPECTION_TIER,
    (row.routing as string | null) ?? null,
    (row.released_at as string | null) != null,
  )
  if (gate.kind !== 'inspection') {
    return Response.redirect(`${appUrl}/q/paint/${token}`, 302)
  }

  // Already paid → don't re-charge; the booking page forwards to /thanks
  // if a time is already picked.
  if (row.paid_at) {
    return Response.redirect(`${appUrl}/q/paint/${token}/book`, 302)
  }

  // Pay-first means the customer commits before seeing any times — so refuse
  // the charge when the painter has published none, rather than selling a visit
  // nobody can schedule. Best-effort: a lookup failure lets payment through.
  if (row.tenant_id) {
    try {
      const options = await loadTenantBookingOptions(getSupabase(), {
        tenantId: row.tenant_id as string,
        table: 'painting_measurements',
      })
      if (!canTakePayment({ bookableCount: options.length })) {
        return Response.redirect(`${appUrl}/q/paint/${token}?slots=0`, 302)
      }
    } catch (e: unknown) {
      pipelineLog('dispatch').err(
        'painting slot count lookup failed — allowing payment through',
        e instanceof Error ? e.message : String(e),
        { token: token.slice(0, 8) + '…' },
      )
    }
  }

  try {
    // Connect routing (platform fee, destination = the tenant's connected
    // account) — the same decision the roofing site visit uses; a tenant
    // with no connected account mints platform-direct.
    const connect = await connectDestinationForTenantId(
      getSupabase(),
      (row.tenant_id as string | null) ?? null,
    )
    const fresh = await createPaintingSiteVisitSession({
      token,
      address: (row.address as string | null) ?? null,
      appUrl,
      connect,
    })
    if (fresh) {
      // At most ONE payable Session: store this one, expire the one replaced
      // (best-effort, tolerant of already-expired/paid).
      const links = { ...((row.stripe_links as Record<string, string> | null) ?? {}) }
      const replaced = links[PAINT_INSPECTION_TIER]
      links[PAINT_INSPECTION_TIER] = fresh
      await getSupabase()
        .from('painting_measurements')
        .update({ stripe_links: links })
        .eq('public_token', token)
      if (replaced && replaced !== fresh) await expireCheckoutSession(replaced)
      return Response.redirect(fresh, 302)
    }
  } catch (e: unknown) {
    pipelineLog('dispatch').err(
      'painting site-visit Session mint failed',
      e instanceof Error ? e.message : String(e),
      { token: token.slice(0, 8) + '…' },
    )
  }

  return new Response('Could not start checkout', { status: 500 })
}
