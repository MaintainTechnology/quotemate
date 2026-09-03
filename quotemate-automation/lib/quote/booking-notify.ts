// Booking-confirmation SMS — customer + tradie.
//
// MOVED here from /api/q/[token]/book so it fires on the LAST step of
// the new funnel: the deposit payment (the Stripe webhook), not slot
// selection. A booking is only confirmed once it's paid, so that's when
// "you're locked in for <time>" should go out. Logic is otherwise
// identical to the pre-reorder book route (intake → caller/calls phone
// resolution, tenant-scoped from/to numbers).
//
// Defensive by contract: never throws. The booking + payment are already
// committed by the time this runs; a failed SMS must never undo them or
// break the webhook ack.

import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'
import {
  buildBalanceReceivedSms,
  buildBookingConfirmationSms,
  buildDepositAwaitingSlotSms,
  buildDepositReceivedSms,
  buildTradieBookingNotification,
  buildTradieChildPaymentSms,
} from '@/lib/sms/templates'
import { pipelineLog } from '@/lib/log/pipeline'
import { tzForState } from '@/lib/quote/availability'

export async function notifyBookingConfirmed(
  supabase: SupabaseClient,
  args: {
    quoteId: string
    intakeId: string | null
    tenantId: string | null
    shareToken: string
    /** The confirmed slot, or null when a deposit was paid WITHOUT a slot yet
     *  (inspection deposit / no slots published) → sends the "pick a time"
     *  nudge to the customer instead of the "you're locked in" confirmation. */
    slotIso: string | null
  },
): Promise<void> {
  const sms = pipelineLog('dispatch', args.quoteId)
  try {
    const appUrl = process.env.APP_URL ?? 'https://www.quotemax.com.au'

    // Resolve customer name + phone via intake → calls. caller.phone is
    // set on SMS-sourced quotes; calls.caller_number on voice-sourced.
    type IntakeRow = {
      call_id?: string | null
      job_type?: string | null
      caller?: { name?: string; phone?: string } | null
      scope?: { item_count?: number } | null
    }
    let intake: IntakeRow | null = null
    if (args.intakeId) {
      const { data } = await supabase
        .from('intakes')
        .select('id, call_id, job_type, caller, scope')
        .eq('id', args.intakeId)
        .maybeSingle()
      // supabase-js types a non-literal select row as `never`; go via
      // `unknown` to read our own columns (same pattern as lifecycle.ts).
      intake = (data as unknown as IntakeRow | null) ?? null
    }

    // v8 — realised early-booking discount, surfaced to the tradie so
    // they collect the REDUCED balance on completion, not the original.
    // Best-effort: the column lands via migration 044; absent → 0.
    let earlyBirdDiscountPct = 0
    {
      const { data: q } = await supabase
        .from('quotes')
        .select('applied_discount_pct')
        .eq('id', args.quoteId)
        .maybeSingle()
      if (q) earlyBirdDiscountPct = Number(q.applied_discount_pct ?? 0)
    }

    let callerNumber: string | null = intake?.caller?.phone ?? null
    if (!callerNumber && intake?.call_id) {
      const { data: callRow } = await supabase
        .from('calls')
        .select('caller_number')
        .eq('id', intake.call_id)
        .maybeSingle()
      callerNumber = (callRow?.caller_number as string | null) ?? null
    }

    // v6 multi-tenant: send FROM the tenant's provisioned number so the
    // confirmation lands in the same thread as the quote; notify the
    // tradie's own mobile. Env fallbacks for legacy pre-v6 quotes.
    let tenantSmsNumber: string | null = null
    let tenantOwnerMobile: string | null = null
    let tenantOwnerFirstName: string | null = null
    let tenantState: string | null = null
    if (args.tenantId) {
      const { data: tenantRow } = await supabase
        .from('tenants')
        .select('twilio_sms_number, owner_mobile, owner_first_name, state')
        .eq('id', args.tenantId)
        .maybeSingle()
      tenantSmsNumber = (tenantRow?.twilio_sms_number as string | null) ?? null
      tenantOwnerMobile = (tenantRow?.owner_mobile as string | null) ?? null
      tenantOwnerFirstName =
        (tenantRow?.owner_first_name as string | null) ?? null
      tenantState = (tenantRow?.state as string | null) ?? null
    }
    // Slots are generated in the tenant's state timezone — echo in it too.
    const timeZone = tzForState(tenantState)

    const firstName = intake?.caller?.name
    const bookingUrl = `${appUrl}/q/${args.shareToken}/book`
    const quoteUrl = `${appUrl}/q/${args.shareToken}`

    if (callerNumber) {
      const body = args.slotIso
        ? buildBookingConfirmationSms({ firstName, scheduledAt: args.slotIso, bookingUrl, timeZone })
        : buildDepositAwaitingSlotSms({ firstName, bookingUrl })
      const customerFrom = tenantSmsNumber ?? process.env.TWILIO_SMS_NUMBER
      sms.step('sending booking confirmation to customer', {
        to: callerNumber,
        from: customerFrom ?? '(default TWILIO_PHONE_NUMBER)',
      })
      const r = await dispatchQuoteMessage({
        to: callerNumber,
        text: body,
        from: customerFrom ?? undefined,
      })
      if (r.ok) {
        sms.ok('customer booking confirmation sent', {
          channel: r.channel,
          sid: r.sid,
        })
      } else {
        sms.err('customer booking confirmation failed', null, {
          sms_code: r.smsAttempt.code,
          wa_code: r.waAttempt?.code,
        })
      }
    } else {
      sms.ok('customer SMS skipped — no callerNumber resolvable', {
        quote_id: args.quoteId,
      })
    }

    // Tradie is notified only for a CONFIRMED booking (a slot exists). The
    // deposit-paid-but-unscheduled case nudges the customer only; the tradie
    // gets their booking SMS when the customer picks a time (book route).
    const notifyMobile = tenantOwnerMobile ?? process.env.TRADIE_NOTIFY_NUMBER
    if (args.slotIso && notifyMobile) {
      const tradieBody = buildTradieBookingNotification({
        tradieFirstName: tenantOwnerFirstName,
        customerName: firstName,
        customerPhone: callerNumber ?? undefined,
        jobType: intake?.job_type ?? 'other',
        itemCount: intake?.scope?.item_count,
        scheduledAt: args.slotIso,
        quoteUrl,
        dashboardUrl: `${appUrl}/dashboard`,
        earlyBirdDiscountPct,
        timeZone,
      })
      sms.step('notifying tradie of booking', {
        to: notifyMobile,
        from: tenantSmsNumber ?? '(default TWILIO_PHONE_NUMBER)',
      })
      const r = await dispatchQuoteMessage({
        to: notifyMobile,
        text: tradieBody,
        from: tenantSmsNumber ?? undefined,
        audience: 'tradie',
      })
      if (r.ok) {
        sms.ok('tradie booking notification sent', {
          channel: r.channel,
          sid: r.sid,
        })
      } else {
        sms.err('tradie booking notification failed', null, {
          sms_code: r.smsAttempt.code,
          wa_code: r.waAttempt?.code,
        })
      }
    } else {
      sms.ok('tradie notify skipped — no tenant.owner_mobile and no env fallback')
    }
  } catch (e) {
    sms.err(
      'booking confirmation SMS threw — booking + payment ARE committed, only SMS failed',
      e,
    )
  }
}

/**
 * Payment notifications for a post-site-visit CHILD row — the deposit on a
 * 'final' row or the balance on a 'balance' row (spec
 * post-visit-money-sequence R11).
 *
 * Deliberately NOT notifyBookingConfirmed: that function's whole shape is
 * booking-centric. It would text the customer "pick a time" with a /book link
 * for a visit that already happened, and it texts the tradie only when a slot
 * exists — so on a child (which never has one) the tradie would learn about a
 * multi-thousand-dollar deposit from a push notification alone.
 *
 * Same defensive contract as its sibling: never throws. The payment is
 * committed before this runs.
 */
export async function notifyChildPaymentReceived(
  supabase: SupabaseClient,
  args: {
    quoteId: string
    intakeId: string | null
    tenantId: string | null
    shareToken: string
    kind: 'final' | 'balance'
    /** What the customer was charged, in cents (base + platform fee). */
    chargedCents: number | null
  },
): Promise<void> {
  const sms = pipelineLog('dispatch', args.quoteId)
  try {
    const appUrl = process.env.APP_URL ?? 'https://www.quotemax.com.au'
    const purpose = args.kind === 'final' ? 'deposit' : 'balance'

    type IntakeRow = {
      call_id?: string | null
      job_type?: string | null
      caller?: { name?: string; phone?: string } | null
    }
    let intake: IntakeRow | null = null
    if (args.intakeId) {
      const { data } = await supabase
        .from('intakes')
        .select('id, call_id, job_type, caller')
        .eq('id', args.intakeId)
        .maybeSingle()
      intake = (data as unknown as IntakeRow | null) ?? null
    }

    let callerNumber: string | null = intake?.caller?.phone ?? null
    if (!callerNumber && intake?.call_id) {
      const { data: callRow } = await supabase
        .from('calls')
        .select('caller_number')
        .eq('id', intake.call_id)
        .maybeSingle()
      callerNumber = (callRow?.caller_number as string | null) ?? null
    }

    let tenantSmsNumber: string | null = null
    let tenantOwnerMobile: string | null = null
    let tenantOwnerFirstName: string | null = null
    let businessName: string | null = null
    if (args.tenantId) {
      const { data: tenantRow } = await supabase
        .from('tenants')
        .select('twilio_sms_number, owner_mobile, owner_first_name, business_name')
        .eq('id', args.tenantId)
        .maybeSingle()
      tenantSmsNumber = (tenantRow?.twilio_sms_number as string | null) ?? null
      tenantOwnerMobile = (tenantRow?.owner_mobile as string | null) ?? null
      tenantOwnerFirstName = (tenantRow?.owner_first_name as string | null) ?? null
      businessName = (tenantRow?.business_name as string | null) ?? null
    }

    const firstName = intake?.caller?.name
    // The FINAL row's page is the job's customer surface. A balance row 302s
    // to it, so linking the child's own token is correct for both kinds.
    const quoteUrl = `${appUrl}/q/${args.shareToken}`

    if (callerNumber) {
      const body =
        args.kind === 'final'
          ? buildDepositReceivedSms({ firstName, businessName })
          : buildBalanceReceivedSms({ firstName, businessName })
      const customerFrom = tenantSmsNumber ?? process.env.TWILIO_SMS_NUMBER
      const r = await dispatchQuoteMessage({
        to: callerNumber,
        text: body,
        from: customerFrom ?? undefined,
      })
      if (r.ok) sms.ok(`customer ${purpose} receipt sent`, { channel: r.channel, sid: r.sid })
      else sms.err(`customer ${purpose} receipt failed`, null, { sms_code: r.smsAttempt.code })
    } else {
      sms.ok(`customer ${purpose} receipt skipped — no callerNumber resolvable`)
    }

    // Unlike the booking path, the tradie is ALWAYS texted here: this is money
    // landing on a live job, and there is no slot to gate it on.
    const notifyMobile = tenantOwnerMobile ?? process.env.TRADIE_NOTIFY_NUMBER
    if (notifyMobile) {
      const tradieBody = buildTradieChildPaymentSms({
        tradieFirstName: tenantOwnerFirstName,
        customerName: firstName,
        jobType: intake?.job_type ?? 'job',
        amountAud: Math.round((args.chargedCents ?? 0) / 100),
        kind: purpose,
        quoteUrl,
      })
      const r = await dispatchQuoteMessage({
        to: notifyMobile,
        text: tradieBody,
        from: tenantSmsNumber ?? undefined,
        audience: 'tradie',
      })
      if (r.ok) sms.ok(`tradie ${purpose} notification sent`, { channel: r.channel, sid: r.sid })
      else sms.err(`tradie ${purpose} notification failed`, null, { sms_code: r.smsAttempt.code })
    } else {
      sms.ok('tradie notify skipped — no tenant.owner_mobile and no env fallback')
    }
  } catch (e) {
    sms.err('child payment SMS threw — the payment IS committed, only SMS failed', e)
  }
}
