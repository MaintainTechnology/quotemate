// Solar estimate → tradie notification. Forced review, no auto-send
// (spec §6): every solar estimate lands as "awaiting your confirmation".
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

/** PURE — build the tradie SMS body. */
export function buildSolarTradieNotification(args: {
  tradieFirstName: string | null | undefined
  customerName: string | null | undefined
  systemKw: number
  netIncGst: number
  reviewUrl: string
  dashboardUrl: string
}): string {
  const greeting = args.tradieFirstName ? `Hi ${args.tradieFirstName}, ` : ''
  const who = args.customerName ? args.customerName : 'A customer'
  const dollars = `$${Math.round(args.netIncGst).toLocaleString('en-AU')}`
  return (
    `${greeting}${who} just got an instant solar estimate: ` +
    `${args.systemKw} kW, ${dollars} net (after STC). ` +
    `Review and confirm before it goes live: ${args.reviewUrl} ` +
    `· Dashboard: ${args.dashboardUrl}`
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
