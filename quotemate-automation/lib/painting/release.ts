// ════════════════════════════════════════════════════════════════════
// Painting — tradie notification + customer release send.
//
// On completion the customer's request is DRAFTED and held; we text the
// tradie a review link (notifyPaintingTradie) instead of auto-sending. When
// the tradie clicks "Send to customer", the release endpoint stamps
// released_at and calls sendPaintingQuoteToCustomer, which delivers the full
// quote (the same composePaintingQuoteDelivery the auto-send used).
//
// Mirrors lib/solar/notify.ts + lib/solar/release.ts: defensive (never
// throws), and the tradie SMS send is injectable so the routing is unit-
// testable without Twilio.
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPaintingTradieNotification } from '@/lib/sms/painting-compose'
import { sendSms } from '@/lib/sms/twilio'
import { composePaintingQuoteDelivery } from './quote-dispatch'
import type { PaintingEstimate } from './types'
import type { StripeLinks } from '@/lib/stripe/checkout'

type DispatchResultLike = { ok: boolean }
type DispatchFn = (opts: { to: string; text: string; from?: string }) => Promise<DispatchResultLike>

/**
 * Text the tradie that a customer requested a painting quote, with the review
 * link. Never throws — a missing notify number just means no notification.
 * `dispatch` is injected (the route passes a dispatchQuoteMessage wrapper) so
 * the routing/message is unit-testable without Twilio.
 */
export async function notifyPaintingTradie(args: {
  tenant: {
    owner_mobile: string | null
    owner_first_name: string | null
    twilio_sms_number: string | null
  }
  customerName?: string | null
  address: string
  betterIncGst?: number | null
  estimateToken: string
  appUrl: string
  dispatch: DispatchFn
}): Promise<{ notified: boolean }> {
  try {
    const notifyMobile = args.tenant.owner_mobile ?? process.env.TRADIE_NOTIFY_NUMBER ?? null
    if (!notifyMobile) return { notified: false }
    const reviewUrl = `${args.appUrl}/p/${args.estimateToken}`
    const text = buildPaintingTradieNotification({
      tradieFirstName: args.tenant.owner_first_name,
      customerName: args.customerName,
      address: args.address,
      betterIncGst: args.betterIncGst,
      reviewUrl,
    })
    const r = await args.dispatch({
      to: notifyMobile,
      text,
      from: args.tenant.twilio_sms_number ?? undefined,
    })
    return { notified: r.ok }
  } catch {
    return { notified: false }
  }
}

/**
 * Deliver the full painting quote to the customer — used by the release
 * endpoint after the tradie sends. Reconstructs the dispatch shape from the
 * saved row and reuses composePaintingQuoteDelivery (G/B/B + per-tier Stripe
 * deposit links + quote-page + PDF links + MMS). Never throws.
 */
export async function sendPaintingQuoteToCustomer(
  supabase: SupabaseClient,
  args: { estimateToken?: string; publicToken?: string; appUrl: string },
): Promise<{ sent: boolean }> {
  try {
    const tokenCol = args.estimateToken ? 'estimate_token' : 'public_token'
    const tokenVal = args.estimateToken ?? args.publicToken
    if (!tokenVal) return { sent: false }

    const { data: row } = await supabase
      .from('painting_measurements')
      .select('public_token, estimate_token, estimate, customer_phone, tenant_id, stripe_links, routing, address')
      .eq(tokenCol, tokenVal)
      .maybeSingle()
    if (!row || !row.customer_phone || !row.estimate) return { sent: false }

    const tenantId = (row.tenant_id as string | null) ?? null
    let fromNumber: string | null = process.env.TWILIO_SMS_NUMBER ?? null
    if (tenantId) {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('twilio_sms_number')
        .eq('id', tenantId)
        .maybeSingle()
      fromNumber = (tenant?.twilio_sms_number as string | null) ?? fromNumber
    }
    if (!fromNumber) return { sent: false }

    const disp = {
      ok: true as const,
      token: row.public_token as string,
      estimateToken: (row.estimate_token as string | null) ?? '',
      estimate: row.estimate as PaintingEstimate,
      inspection: (row.routing as string | null) === 'inspection_required',
      stripeLinks: (row.stripe_links as StripeLinks | null) ?? {},
    }
    const { text, mmsUrl } = await composePaintingQuoteDelivery({
      supabase,
      disp,
      address: (row.address as string | null) ?? 'your property',
      appUrl: args.appUrl,
      tenantId,
    })
    await sendSms({ to: row.customer_phone as string, from: fromNumber, text, mediaUrl: mmsUrl })
    return { sent: true }
  } catch (e) {
    console.error('[painting/release] customer quote send failed (non-fatal)', e instanceof Error ? e.message : e)
    return { sent: false }
  }
}
