// ════════════════════════════════════════════════════════════════════
// Painting: estimate → save → customer message → tradie notify.
//
// Extracted from app/api/sms/inbound/route.ts (2026-07-23) alongside the
// roofing twin (roofing-measure-dispatch.ts) so the VOICE path can run the
// identical sequence after a call. Two callers, one implementation:
//   • handlePaintingTurn (SMS)      — the customer's last gathered answer
//   • runVoiceTradeHandover (voice) — the call ended with the brief agreed
//
// Painting AUTO-SENDS (docs/strategy.md v21, spec painting-auto-send): the
// estimate is released at save time and the customer is texted the full quote
// — tier prices, the /q/paint link, the PDF and the one $99 site-visit link —
// on this turn. The tradie is still notified, they are just no longer a gate.
// This supersedes the review-required behaviour of v11.
//
// An inspection-routed one is unchanged: the on-site-measure message, parked
// at await_booking.
//
// If the quote send fails we do NOT pretend it went: the release stamp is
// rolled back (so /p offers Send again and the customer gate stays shut), the
// customer gets the holding message, and the tradie's alert says in plain
// words that the customer was not texted.
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPaintingHoldingSms, buildPaintingInspectionSms } from './painting-compose'
import { toPaintingRequest, type PaintingSlots } from './painting-intake'
import type { PaintingConversationState } from './painting-receptionist'
import { dispatchQuoteMessage } from './dispatch'
import { runAndSavePaintingQuote } from '@/lib/painting/quote-dispatch'
import { autoSendPaintingQuote, notifyPaintingTradie } from '@/lib/painting/release'

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
  /** Sends one SMS/MMS to the customer and persists it on the thread. The
   *  dispatch result is USED — `ok: false` means the customer got nothing. */
  sendReply: (text: string, mediaUrl?: string) => Promise<{ ok: boolean }>
}): Promise<PaintingEstimateDispatchResult> {
  const request = toPaintingRequest(args.slots)
  if (!request) return { ok: false, reason: 'incomplete brief — nothing to estimate' }

  const disp = await runAndSavePaintingQuote({
    supabase: args.supabase,
    tenantId: args.tenantId,
    customerPhone: args.customerPhone,
    customerName: args.firstName,
    request,
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

  // Priced — AUTO-SEND: the row was released at save time, so the quote page,
  // the PDF and the $99 site-visit link all resolve, and the customer gets the
  // full quote right here. The tradie notification still fires.
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

  // Compose → send → stamp quote_sent_at ∨ revert the release: all of it lives
  // in autoSendPaintingQuote so this path and the self-serve form POST cannot
  // drift on the one rule that matters (never report an undelivered send).
  const { sent } = await autoSendPaintingQuote({
    supabase: args.supabase,
    disp,
    address,
    appUrl: args.baseUrl,
    tenantId: args.tenantId,
    firstName: args.firstName,
    send: async (text, mmsUrl) => (await args.sendReply(text, mmsUrl)).ok === true,
  })

  if (!sent) {
    // The row is held again — set the customer's expectation without a price.
    try {
      await args.sendReply(
        buildPaintingHoldingSms({ firstName: args.firstName, businessName: tenantRow?.business_name ?? null }),
      )
    } catch {
      /* the quote send already failed — the holding SMS is best-effort */
    }
  }

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
    customerTexted: sent,
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
