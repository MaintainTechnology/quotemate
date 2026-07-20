// ════════════════════════════════════════════════════════════════════
// GET /r/roof/[token]/[tier] — roofing site-visit short-link.
//
// Token = roofing_measurements.public_token. The dedicated roofing surface
// (/q/roof/[token]) has no per-tier deposit — a roof price is always
// confirmed on site — so the only payable action is the refundable $99
// site-visit deposit (tier='inspection'). Mints a fresh Stripe Session per
// click (Sessions die after Stripe's 24h max); already-paid → back to the
// quote page instead of re-charging.
//
// Next 16: params is a Promise (await it).
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { createRoofingSiteVisitSession } from '@/lib/stripe/checkout'
import { connectDestinationForTenantId } from '@/lib/stripe/connect'
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
  // Only the $99 site visit is payable on the roofing surface.
  if (tier !== 'inspection') {
    return new Response('Invalid tier', { status: 400 })
  }

  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? ''

  const { data: row } = await getSupabase()
    .from('roofing_measurements')
    .select('public_token, tenant_id, address, paid_at, customer_phone')
    .eq('public_token', token)
    .maybeSingle()
  if (!row) return new Response('Not found', { status: 404 })

  // Already paid → don't re-charge; send them to the booking page (thank-you
  // video + calendar, or their booked confirmation).
  if (row.paid_at) {
    return Response.redirect(`${appUrl}/q/roof/${token}/book`, 302)
  }

  try {
    // Connect routing (2% platform fee, destination = the tenant's connected
    // account) — same decision the quotes deposits use.
    const connect = await connectDestinationForTenantId(getSupabase(), (row.tenant_id as string | null) ?? null)
    const url = await createRoofingSiteVisitSession({
      token,
      address: (row.address as string | null) ?? null,
      appUrl,
      connect,
    })
    if (url) return Response.redirect(url, 302)
  } catch (e: unknown) {
    pipelineLog('dispatch').err(
      'roofing site-visit Session mint failed',
      e instanceof Error ? e.message : String(e),
      { token: token.slice(0, 8) + '…' },
    )
  }

  return new Response('Could not start checkout', { status: 500 })
}
