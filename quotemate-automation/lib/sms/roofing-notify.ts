// US-002 — text the tradie when the roofing receptionist delivers a quote
// or a customer confirms an on-site inspection. Before this module the
// roofing SMS path created the measurement, sent the customer their
// estimate… and told nobody: leads sat in the DB until someone opened the
// dashboard (2026-07-23 audit). Mirrors lib/painting/release.ts's
// notifyPaintingTradie: dispatch is injected so routing is unit-testable
// without Twilio, and nothing here may throw — a failed notification must
// never break the customer send that precedes it.

import { fmtSlotShort } from './templates'

type DispatchResultLike = { ok: boolean }
type DispatchFn = (opts: { to: string; text: string; from?: string }) => Promise<DispatchResultLike>

export type RoofingNotifyKind =
  | 'quote_sent'
  | 'inspection_booked'
  // The LLM receptionist was asked something the grounded tenant facts do
  // not cover ("how long have you been going?", "do you work Saturdays?").
  // It deflects honestly rather than inventing an answer, which only works
  // if a human actually follows up — so the deflect and this alert are a
  // pair. See lib/sms/llm-receptionist.ts composeDeflect.
  | 'question_asked'
  // The customer paid and picked a slot. The quotes funnel has notified the
  // tradie on this since lib/quote/booking-notify.ts; roofing/painting were
  // built as a parallel funnel and only ever texted the customer, so a paid,
  // booked job reached nobody (live 2026-07-27, token ff6f67ce…).
  | 'booking_confirmed'

const fmtAud = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`

/** PURE — the SMS body for the tradie alert. */
export function buildRoofingTradieNotification(args: {
  kind: RoofingNotifyKind
  tradieFirstName: string | null
  customerName: string | null
  customerPhone: string
  address: string
  betterIncGst: number | null
  quoteUrl: string
  /** The customer's words, on a 'question_asked' alert. */
  question?: string | null
  /** The confirmed slot, on a 'booking_confirmed' alert. */
  scheduledAt?: string | null
  /** Tenant timezone (tzForState) — must match the customer confirmation's
   *  zone or the two SMSes name different days for the same slot. */
  timeZone?: string
  /** The trade word in the body. This module is roofing-named but painting
   *  reuses it, and both book through the one /api/q/book/[trade] handler. */
  tradeLabel?: string
}): string {
  const hi = args.tradieFirstName ? `Hi ${args.tradieFirstName} - ` : ''
  const who = args.customerName ? `${args.customerName} (${args.customerPhone})` : args.customerPhone
  if (args.kind === 'booking_confirmed') {
    const trade = args.tradeLabel ?? 'roofing'
    const when = args.scheduledAt ? fmtSlotShort(args.scheduledAt, args.timeZone) : 'a time they picked'
    // No price rather than "$0": an inspection-routed job has no better tier,
    // and the same $0 leak already bit the quote_sent alert (see route.ts).
    const quoted =
      args.betterIncGst != null
        ? `\nQuoted: ${fmtAud(args.betterIncGst)} inc GST (deposit paid)`
        : ''
    return (
      `${hi}${trade} job BOOKED via SMS for ${when}.\n` +
      `Customer: ${who}\n` +
      `Property: ${args.address}${quoted}\n` +
      `Details: ${args.quoteUrl}`
    )
  }
  if (args.kind === 'question_asked') {
    return (
      `${hi}a customer asked something the SMS receptionist could not answer.\n` +
      `Customer: ${who}\n` +
      `They asked: ${args.question?.trim() || '(see the thread)'}\n` +
      `We told them you would come back to them.`
    )
  }
  if (args.kind === 'inspection_booked') {
    return (
      `${hi}new ${args.tradeLabel ?? 'roofing'} INSPECTION booked via SMS.\n` +
      `Customer: ${who}\n` +
      `Property: ${args.address}\n` +
      `Details: ${args.quoteUrl}\n` +
      `Reply to the customer to lock in a time.`
    )
  }
  const price = args.betterIncGst != null ? ` at ${fmtAud(args.betterIncGst)} inc GST` : ''
  return (
    `${hi}roofing quote sent via SMS${price}.\n` +
    `Customer: ${who}\n` +
    `Property: ${args.address}\n` +
    `Review: ${args.quoteUrl}`
  )
}

/**
 * Text the tradie's owner_mobile FROM their own provisioned number.
 * Never throws; missing notify number (or the customer IS the tradie —
 * dev self-testing) just means no notification.
 */
export async function notifyRoofingTradie(args: {
  kind: RoofingNotifyKind
  tenant: {
    owner_mobile: string | null
    owner_first_name: string | null
    twilio_sms_number: string | null
  }
  customerName: string | null
  customerPhone: string
  address: string
  betterIncGst: number | null
  quoteUrl: string
  question?: string | null
  scheduledAt?: string | null
  timeZone?: string
  tradeLabel?: string
  dispatch: DispatchFn
}): Promise<{ notified: boolean }> {
  try {
    const notifyMobile = args.tenant.owner_mobile ?? process.env.TRADIE_NOTIFY_NUMBER ?? null
    if (!notifyMobile) {
      console.warn(
        `[sms/roofing-notify] ${args.kind} NOT sent - tenant has no owner_mobile and TRADIE_NOTIFY_NUMBER is unset`,
      )
      return { notified: false }
    }
    // Self-test guard: when the "customer" is the tradie's own handset,
    // an alert about the message they just received is pure noise.
    //
    // It also makes the whole feature unverifiable from that handset, which
    // is exactly how this tenant is tested — Sparky's owner_mobile IS the
    // number used to test, so every alert vanished with no trace and cost an
    // hour of diagnosis (2026-07-27). Hence both the escape and the log.
    if (notifyMobile === args.customerPhone && process.env.TRADIE_NOTIFY_SELF_TEST !== '1') {
      console.warn(
        `[sms/roofing-notify] ${args.kind} NOT sent - self-test guard: owner_mobile is the same number as the customer (${notifyMobile}). Set TRADIE_NOTIFY_SELF_TEST=1 to send anyway.`,
      )
      return { notified: false }
    }
    const text = buildRoofingTradieNotification({
      kind: args.kind,
      tradieFirstName: args.tenant.owner_first_name,
      customerName: args.customerName,
      customerPhone: args.customerPhone,
      address: args.address,
      betterIncGst: args.betterIncGst,
      quoteUrl: args.quoteUrl,
      question: args.question,
      scheduledAt: args.scheduledAt,
      timeZone: args.timeZone,
      tradeLabel: args.tradeLabel,
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
