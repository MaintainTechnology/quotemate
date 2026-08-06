// ════════════════════════════════════════════════════════════════════
// Painting — tradie notification + customer quote send.
//
// Since spec painting-auto-send (2026-08-07) a priced residential painting
// quote AUTO-SENDS: it is released at save time and the customer is texted
// the full quote immediately. notifyPaintingTradie still fires on every new
// job — the tradie learns about it, they are simply no longer a gate. The
// release endpoint stays for the on-site-edit resend and for RETRYING an
// auto-send that failed.
//
// With no tradie in the loop a dropped send is invisible, so the invariant
// is: released_at means the customer WAS texted. Every send returns { sent },
// and a first send that failed rolls the stamp back (revertPaintingRelease)
// rather than leaving a row that looks delivered.
//
// Mirrors lib/solar/notify.ts + lib/solar/release.ts: defensive (never
// throws), and the tradie SMS send is injectable so the routing is unit-
// testable without Twilio.
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPaintingTradieNotification } from '@/lib/sms/painting-compose'
import { sendSms } from '@/lib/sms/twilio'
import { composePaintingQuoteDelivery, type PaintingQuoteDispatch } from './quote-dispatch'
import type { PaintingEstimate } from './types'
import type { StripeLinks } from '@/lib/stripe/checkout'

type DispatchResultLike = { ok: boolean }
type DispatchFn = (opts: { to: string; text: string; from?: string }) => Promise<DispatchResultLike>

/**
 * Text the tradie that a customer requested a painting quote, with the review
 * link. Never throws — a missing notify number just means no notification.
 * `dispatch` is injected (the route passes a dispatchQuoteMessage wrapper) so
 * the routing/message is unit-testable without Twilio.
 *
 * `customerTexted: false` switches the copy to the auto-send FAILURE alert
 * (spec painting-auto-send R3): the tradie is told in plain words that the
 * customer has NOT received anything and must be sent manually. Never swallow
 * a failed send — with the review gate retired this alert is the only witness.
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
  /** Did the customer actually get the quote? Defaults to true. */
  customerTexted?: boolean
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
      customerTexted: args.customerTexted !== false,
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
 * Record that a carrier ACCEPTED the customer's quote message (migration 189).
 * quote_sent_at is the evidence /p keys "Sent to customer" off — released_at
 * only ever meant "prices may show", and a dashboard save stamps that without
 * texting anyone. Written only after a real acceptance; never optimistically.
 * Never throws, and reports whether the write actually landed.
 */
export async function markPaintingQuoteSent(
  supabase: SupabaseClient,
  publicToken: string,
): Promise<{ marked: boolean }> {
  try {
    const { error } = await supabase
      .from('painting_measurements')
      .update({ quote_sent_at: new Date().toISOString() })
      .eq('public_token', publicToken)
    if (error) {
      // Not fatal — the customer HAS the quote. /p will just offer a resend.
      console.error('[painting/release] could not stamp quote_sent_at', error.message)
      return { marked: false }
    }
    return { marked: true }
  } catch (e) {
    console.error(
      '[painting/release] could not stamp quote_sent_at',
      e instanceof Error ? e.message : e,
    )
    return { marked: false }
  }
}

/**
 * Undo an optimistic release whose customer send did NOT go out (spec
 * painting-auto-send R3). released_at is stamped before the send because the
 * quote page and the $99 mint gate on it — so a failed send has to roll the
 * stamp back, or the customer-facing gate stays open for a quote nobody
 * received. Back at released_at = null the row is held again: prices withheld,
 * and /p offers "Send to customer" so the tradie can retry.
 *
 * supabase-js RESOLVES { data, error } on a PostgREST/DB failure — it does not
 * throw — so the error field is what has to be checked; a bare `await` here
 * would swallow a failed rollback exactly like the bare `await sendSms` that
 * started all this. Callers MUST honour `reverted: false` and not report the
 * row as held.
 */
export async function revertPaintingRelease(
  supabase: SupabaseClient,
  publicToken: string,
): Promise<{ reverted: boolean }> {
  try {
    const { error } = await supabase
      .from('painting_measurements')
      .update({ released_at: null })
      .eq('public_token', publicToken)
    if (error) {
      console.error(
        '[painting/release] could not revert released_at after a failed send',
        error.message,
      )
      return { reverted: false }
    }
    return { reverted: true }
  } catch (e) {
    console.error(
      '[painting/release] could not revert released_at after a failed send',
      e instanceof Error ? e.message : e,
    )
    return { reverted: false }
  }
}

/**
 * The auto-send both draft-time origins share (spec painting-auto-send R2/R3):
 * the SMS/voice receptionist and the public self-serve form. Compose the full
 * quote once, hand it to the caller's own transport (each resolves a different
 * from-number and persists the thread differently), then record the outcome:
 *   sent    → stamp quote_sent_at (evidence /p trusts)
 *   NOT sent → revert the release so the row is held and retryable
 * Never throws. The caller still owns the customer fallback message and the
 * tradie notification, because those differ per origin.
 */
export async function autoSendPaintingQuote(args: {
  supabase: SupabaseClient
  disp: Extract<PaintingQuoteDispatch, { ok: true }>
  address: string
  appUrl: string
  tenantId: string | null
  firstName?: string | null
  /** Deliver one SMS/MMS. True ONLY when the carrier accepted it. */
  send: (text: string, mmsUrl?: string) => Promise<boolean>
}): Promise<{ sent: boolean }> {
  let sent = false
  try {
    const { text, mmsUrl } = await composePaintingQuoteDelivery({
      supabase: args.supabase,
      disp: args.disp,
      address: args.address,
      appUrl: args.appUrl,
      tenantId: args.tenantId,
      firstName: args.firstName,
    })
    sent = (await args.send(text, mmsUrl)) === true
  } catch (e) {
    console.error(
      '[painting] auto-send compose/send failed',
      e instanceof Error ? e.message : e,
    )
  }

  if (sent) await markPaintingQuoteSent(args.supabase, args.disp.token)
  else await revertPaintingRelease(args.supabase, args.disp.token)

  return { sent }
}

/**
 * Deliver the full painting quote to the customer — the ONE send used by the
 * release endpoint (first send, retry and resend). Reconstructs the dispatch
 * shape from the saved row and reuses composePaintingQuoteDelivery (G/B/B
 * prices + quote-page + PDF links + the ONE $99 site-visit pay link + MMS).
 * Never throws; `sent` is false — never silently true — when the row has no
 * customer_phone, no from-number, or Twilio rejects the message.
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
      .select('public_token, estimate_token, estimate, customer_phone, tenant_id, routing, address')
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
    }
    const { text, mmsUrl } = await composePaintingQuoteDelivery({
      supabase,
      disp,
      address: (row.address as string | null) ?? 'your property',
      appUrl: args.appUrl,
      tenantId,
    })
    // sendSms RESOLVES on a Twilio rejection ({ ok: false }) — it does not
    // throw. Returning `sent: true` off the bare await was the silent failure
    // this spec exists to close.
    const res = await sendSms({ to: row.customer_phone as string, from: fromNumber, text, mediaUrl: mmsUrl })
    if (!res.ok) {
      console.error('[painting/release] Twilio rejected the customer quote send', res.code, res.reason)
      return { sent: false }
    }
    // Accepted — record the evidence /p reads (migration 189). Best-effort:
    // the customer already has the quote, so a failed stamp must not turn a
    // real delivery into a reported failure.
    await markPaintingQuoteSent(supabase, row.public_token as string)
    return { sent: true }
  } catch (e) {
    console.error('[painting/release] customer quote send failed (non-fatal)', e instanceof Error ? e.message : e)
    return { sent: false }
  }
}
