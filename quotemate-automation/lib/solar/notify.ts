// Solar estimate → tradie notification.
//
// As of docs/strategy.md v12 (2026-06-16) a CLEAN estimate auto-releases
// to the customer at creation (Path B); the tradie notification then
// reads "sent to your customer — review it here" (released:true). A
// FLAGGED estimate still lands as "awaiting your confirmation" and the
// notification keeps the "review and confirm before it goes live" wording.
//
// Modelled on lib/quote/booking-notify.ts: defensive (never throws), and
// the SMS send is injectable so the message-building + routing logic is
// unit-testable without Twilio. The route passes a dispatch impl that
// wraps dispatchQuoteMessage from @/lib/sms/dispatch.

type DispatchOk = { ok: true; channel: string; sid?: string }
type DispatchFail = { ok: false }
type DispatchResultLike = DispatchOk | DispatchFail

type DispatchFn = (opts: {
  to: string
  text: string
  from?: string
}) => Promise<DispatchResultLike>

/** PURE — build the tradie SMS body. `released:true` means the quote has
 *  already auto-sent to the customer (Path B clean estimate) and the
 *  tradie is reviewing after the fact; otherwise it still needs the
 *  tradie's confirm before it goes live (flagged estimate). */
export function buildSolarTradieNotification(args: {
  tradieFirstName: string | null | undefined
  customerName: string | null | undefined
  systemKw: number
  netIncGst: number
  reviewUrl: string
  dashboardUrl: string
  released?: boolean
}): string {
  const greeting = args.tradieFirstName ? `Hi ${args.tradieFirstName}, ` : ''
  const who = args.customerName ? args.customerName : 'A customer'
  const dollars = `$${Math.round(args.netIncGst).toLocaleString('en-AU')}`
  const callToAction = args.released
    ? `It's been sent to your customer — review it here: ${args.reviewUrl}`
    : `Review and confirm before it goes live: ${args.reviewUrl}`
  return (
    `${greeting}${who} just got an instant solar estimate: ` +
    `${args.systemKw} kW, ${dollars} net (after STC). ` +
    `${callToAction} ` +
    `· Dashboard: ${args.dashboardUrl}`
  )
}

/** PURE — build the CUSTOMER quote SMS body (sent on tradie-confirm when a
 *  customer mobile was captured). Carries the durable quote link and, when a
 *  PDF was rendered, its download link; the PDF also rides along as a
 *  best-effort MMS via dispatchQuoteWithPdf. */
export function buildSolarCustomerSms(args: {
  businessName: string
  customerName?: string | null
  systemKw: number
  netIncGst: number
  quoteUrl: string
  pdfUrl?: string | null
}): string {
  const hi = args.customerName ? `Hi ${args.customerName}, ` : 'Hi, '
  const dollars = `$${Math.round(args.netIncGst).toLocaleString('en-AU')}`
  const pdf = args.pdfUrl ? ` · PDF copy: ${args.pdfUrl}` : ''
  return (
    `${hi}your solar quote from ${args.businessName} is ready: ` +
    `${args.systemKw} kW for ${dollars} net (after STC rebate, inc GST). ` +
    `View it: ${args.quoteUrl}${pdf}`
  )
}

export async function notifySolarEstimate(args: {
  tenant: {
    owner_mobile: string | null
    owner_first_name: string | null
    twilio_sms_number: string | null
  }
  customerName: string | null | undefined
  systemKw: number
  netIncGst: number
  shareToken: string
  appUrl: string
  dispatch: DispatchFn
  /** True when the quote auto-released to the customer (Path B clean
   *  estimate) — switches the SMS to "sent to your customer" wording. */
  released?: boolean
}): Promise<{ notified: boolean }> {
  try {
    const notifyMobile =
      args.tenant.owner_mobile ?? process.env.TRADIE_NOTIFY_NUMBER ?? null
    if (!notifyMobile) return { notified: false }

    const reviewUrl = `${args.appUrl}/q/solar/${args.shareToken}`
    const dashboardUrl = `${args.appUrl}/dashboard`
    const text = buildSolarTradieNotification({
      tradieFirstName: args.tenant.owner_first_name,
      customerName: args.customerName,
      systemKw: args.systemKw,
      netIncGst: args.netIncGst,
      reviewUrl,
      dashboardUrl,
      released: args.released,
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
