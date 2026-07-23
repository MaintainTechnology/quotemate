// ════════════════════════════════════════════════════════════════════
// Painting: estimate → save → customer message → tradie notify.
//
// Extracted from app/api/sms/inbound/route.ts (2026-07-23) alongside the
// roofing twin (roofing-measure-dispatch.ts) so the VOICE path can run the
// identical sequence after a call. Two callers, one implementation:
//   • handlePaintingTurn (SMS)      — the customer's last gathered answer
//   • runVoiceTradeHandover (voice) — the call ended with the brief agreed
//
// Painting is REVIEW-REQUIRED (docs/strategy.md v11): a priced estimate is
// DRAFTED and held — the customer gets a holding message, never the price,
// and the tradie is notified to review/edit/send. An inspection-routed one
// sends the on-site-measure message and parks at await_booking. Both
// behaviours are preserved verbatim from the route.
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPaintingHoldingSms, buildPaintingInspectionSms } from './painting-compose'
import { toPaintingRequest, type PaintingSlots } from './painting-intake'
import type { PaintingConversationState } from './painting-receptionist'
import { dispatchQuoteMessage } from './dispatch'
import { runAndSavePaintingQuote } from '@/lib/painting/quote-dispatch'
import { notifyPaintingTradie } from '@/lib/painting/release'

export type PaintingEstimateDispatchResult =
  | { ok: true; state: PaintingConversationState; token: string; inspection: boolean }
  | { ok: false; reason: string }

export async function estimateAndDispatchPainting(args: {
  supabase: SupabaseClient
  tenantId: string | null
  customerPhone: string
  firstName: string | null
  baseUrl: string
  slots: PaintingSlots
  /** Sends one SMS to the customer and persists it on the thread. */
  sendReply: (text: string) => Promise<unknown>
}): Promise<PaintingEstimateDispatchResult> {
  const request = toPaintingRequest(args.slots)
  if (!request) return { ok: false, reason: 'incomplete brief — nothing to estimate' }

  const disp = await runAndSavePaintingQuote({
    supabase: args.supabase,
    tenantId: args.tenantId,
    customerPhone: args.customerPhone,
    customerName: args.firstName,
    request,
    appUrl: args.baseUrl,
  })
  if (!disp.ok) return { ok: false, reason: 'painting estimate failed' }

  const address = request.address.address

  if (disp.inspection) {
    // No price to audit — send the on-site-measure message, park at
    // await_booking so a "yes" books it.
    await args.sendReply(
      buildPaintingInspectionSms({
        firstName: args.firstName,
        address,
        reason: disp.estimate.price.routing.reason,
        quoteUrl: `${args.baseUrl}/q/paint/${disp.token}`,
      }),
    )
    return {
      ok: true,
      token: disp.token,
      inspection: true,
      state: {
        slots: args.slots,
        last_step: 'await_booking',
        pending_form_token: null,
        pending_quote_token: disp.token,
      },
    }
  }

  // Priced — DRAFT and hold: the customer never gets the price here. Ack
  // the customer, then notify the tradie to review/edit/send.
  const { data: t } = args.tenantId
    ? await args.supabase
        .from('tenants')
        .select('owner_mobile, owner_first_name, twilio_sms_number, business_name')
        .eq('id', args.tenantId)
        .maybeSingle()
    : { data: null }
  const tenantRow =
    (t as {
      owner_mobile?: string | null
      owner_first_name?: string | null
      twilio_sms_number?: string | null
      business_name?: string | null
    } | null) ?? null

  await args.sendReply(
    buildPaintingHoldingSms({ firstName: args.firstName, businessName: tenantRow?.business_name ?? null }),
  )
  await notifyPaintingTradie({
    tenant: {
      owner_mobile: tenantRow?.owner_mobile ?? null,
      owner_first_name: tenantRow?.owner_first_name ?? null,
      twilio_sms_number: tenantRow?.twilio_sms_number ?? null,
    },
    customerName: args.firstName,
    address,
    betterIncGst: disp.estimate.price.tiers.find((tier) => tier.tier === 'better')?.inc_gst ?? null,
    estimateToken: disp.estimateToken,
    appUrl: args.baseUrl,
    dispatch: (o) => dispatchQuoteMessage({ to: o.to, text: o.text, from: o.from, audience: 'tradie' }),
  })

  return {
    ok: true,
    token: disp.token,
    inspection: false,
    state: {
      slots: args.slots,
      last_step: 'quoted',
      pending_form_token: null,
      pending_quote_token: disp.token,
    },
  }
}
