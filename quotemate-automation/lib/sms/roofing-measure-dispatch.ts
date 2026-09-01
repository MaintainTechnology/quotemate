// ════════════════════════════════════════════════════════════════════
// Roofing: measure → save → photo MMS → confirm-roof SMS.
//
// Extracted from app/api/sms/inbound/route.ts (2026-07-23) so the VOICE
// path can run the identical sequence after a call instead of re-asking
// the caller everything by text. Two callers, one implementation — the
// customer gets byte-identical messages whichever channel they came in on:
//   • handleRoofingTurn (SMS)         — the customer's confirm_address YES
//   • runVoiceTradeHandover (voice)   — the call ended with the brief agreed
//
// I/O by injection (sendReply / supabase) so it is testable and so each
// channel keeps its own reply plumbing (SMS persists into the live
// conversation thread; voice seeds one).
//
// Behaviour notes preserved verbatim from the route:
//   • complete per-tenant pricing card only; missing setup stops before save/send
//   • BOTH capability tokens minted as a pair (public_token + measure_token)
//     or the tradie gets no Measurement Results page
//   • roof-photo MMS goes BEFORE the confirm SMS, is fully guarded, and
//     never falls back to a plain SMS (that would spam non-MMS numbers)
//   • an inspection-routed job still saves + links, parked at await_booking
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applySolarToTiers,
  buildRoofingReplyMessage,
  buildRoofPhotoMedia,
  composeConfirmMessage,
} from './roofing-compose'
import { toRoofingRequest, type RoofingSlots } from './roofing-intake'
import type { RoofingConversationState } from './roofing-receptionist'
import { sendSms } from './twilio'
import { measureAndPriceRoofs } from '@/lib/roofing/measure'
import { loadTenantRoofingPricingContext } from '@/lib/roofing/pricing-authority'
import { newMeasurementTokens } from '@/lib/roofing/tokens'
import type { MultiRoofQuote } from '@/lib/roofing/types'

/** Base URL every /q/roof link is built from. Shared by the SMS route and
 *  the voice handover so a voice-origin link is identical to an SMS one. */
export const ROOFING_APP_BASE_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.quotemax.com.au'
).replace(/\/$/, '')

/** Best-effort roof-photo MMS. One image for a single building, one per
 *  building (capped) for several. Uses sendSms directly (NOT
 *  dispatchQuoteMessage) so a failure or a non-MMS number just means no
 *  photo — never a plain-SMS fallback. Never throws. */
export async function sendRoofPhotoMms(args: {
  supabase: SupabaseClient
  conversationId: string
  to: string
  from?: string
  baseUrl: string
  token: string
  quote: MultiRoofQuote
  max?: number
}): Promise<void> {
  const { supabase, conversationId, to, from, baseUrl, token, quote } = args
  try {
    const media = buildRoofPhotoMedia({ baseUrl, token, quote, max: args.max ?? 3 })
    for (const { mediaUrl, caption } of media) {
      try {
        const res = await sendSms({ to, from, text: caption, mediaUrl })
        if (!res.ok) {
          console.warn('[roofing-measure-dispatch] roof photo MMS not sent (non-fatal)', { code: res.code })
        }
        await supabase.from('sms_messages').insert({
          conversation_id: conversationId,
          direction: 'outbound',
          body: `[roof photo] ${caption}`,
        })
      } catch (e) {
        console.warn('[roofing-measure-dispatch] roof photo MMS threw (non-fatal)', e)
      }
    }
  } catch (e) {
    console.warn('[roofing-measure-dispatch] sendRoofPhotoMms failed (non-fatal)', e)
  }
}

export type RoofingMeasureDispatchResult =
  /** Measured + saved + messaged. Persist `state` against the conversation. */
  | { ok: true; state: RoofingConversationState; token: string; quote: MultiRoofQuote }
  /** Nothing sent — the caller falls back to its own unavailable path. */
  | { ok: false; reason: string }

export async function measureAndDispatchRoofing(args: {
  supabase: SupabaseClient
  tenantId: string | null
  /** tenants.trade — picks the pricing_book row the rate card sits on. */
  tenantTrade?: string | null
  conversationId: string
  /** Customer's mobile — the measurement row's customer_phone and MMS target. */
  customerPhone: string
  /** Sender for the photo MMS (the tenant's own number). */
  replyFrom?: string
  firstName: string | null
  baseUrl: string
  slots: RoofingSlots
  /** The brief itself forces a site visit (steep/unknown pitch, etc.) — the
   *  saved quote's routing is overridden and the message uses that path. */
  isInspection: boolean
  inspectionReason?: string
  /** Sends one SMS to the customer and persists it on the thread. */
  sendReply: (text: string) => Promise<unknown>
}): Promise<RoofingMeasureDispatchResult> {
  const reqInput = toRoofingRequest(args.slots)
  if (!reqInput) return { ok: false, reason: 'incomplete brief — nothing to measure' }
  if (!args.tenantId) return { ok: false, reason: 'tenant pricing setup required' }

  try {
    const pricing = await loadTenantRoofingPricingContext(
      args.supabase,
      args.tenantId,
      args.tenantTrade ?? null,
    )
    if (!pricing) return { ok: false, reason: 'tenant roofing pricing setup required' }
    const result = await measureAndPriceRoofs(reqInput.address, reqInput.inputs, {
      rateCard: pricing.rateCard,
    })
    if (!result.ok) {
      console.error('[roofing-measure-dispatch] measure failed', {
        code: result.code,
        detail: result.detail,
        address: reqInput.address.address,
        postcode: reqInput.address.postcode,
        state: reqInput.address.state,
        tenantId: args.tenantId,
      })
      return { ok: false, reason: `measure failed: ${result.code}` }
    }

    const tokens = newMeasurementTokens()
    const token = tokens.public_token
    // The SMS caller always supplies the gate's own reason; the fallback
    // only guards a caller that flags an inspection without one (the field
    // is rendered on the page + message, so it can't be blank).
    const authorisedQuote = {
      ...result.quote,
      pricing_authority: pricing.authority,
    }
    const quote: MultiRoofQuote = args.isInspection
      ? {
          ...authorisedQuote,
          routing: {
            decision: 'inspection_required',
            reason: args.inspectionReason ?? 'this one needs a closer look on site',
          },
        }
      : authorisedQuote

    await args.supabase.from('roofing_measurements').insert({
      tenant_id: args.tenantId,
      address: reqInput.address.address,
      postcode: reqInput.address.postcode || null,
      state: reqInput.address.state,
      provider: result.provider,
      customer_phone: args.customerPhone,
      structure_count: quote.structures.length,
      combined_area_m2: quote.combined.area_m2,
      combined_better_inc_gst:
        applySolarToTiers(quote.combined.tiers, quote.solar ?? null)[1]?.inc_gst ?? null,
      routing: quote.routing.decision,
      structures: quote.structures,
      quote,
      ...tokens,
    })

    const quoteUrl = `${args.baseUrl}/q/roof/${token}`
    await sendRoofPhotoMms({
      supabase: args.supabase,
      conversationId: args.conversationId,
      to: args.customerPhone,
      from: args.replyFrom,
      baseUrl: args.baseUrl,
      token,
      quote,
    })

    if (args.isInspection) {
      await args.sendReply(
        buildRoofingReplyMessage({ quote, address: reqInput.address.address, quoteUrl, firstName: args.firstName }),
      )
      return {
        ok: true,
        token,
        quote,
        state: {
          slots: args.slots,
          last_step: 'await_booking',
          pending_quote_token: token,
          pending_structure_count: null,
        },
      }
    }

    await args.sendReply(
      composeConfirmMessage({ quote, address: reqInput.address.address, quoteUrl, firstName: args.firstName }),
    )
    return {
      ok: true,
      token,
      quote,
      state: {
        slots: args.slots,
        last_step: 'confirm_roof',
        pending_quote_token: token,
        pending_structure_count: quote.structures.length,
      },
    }
  } catch (e) {
    console.error('[roofing-measure-dispatch] measure/save failed', e)
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
