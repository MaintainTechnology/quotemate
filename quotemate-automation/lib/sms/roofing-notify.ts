// US-002 — text the tradie when the roofing receptionist delivers a quote
// or a customer confirms an on-site inspection. Before this module the
// roofing SMS path created the measurement, sent the customer their
// estimate… and told nobody: leads sat in the DB until someone opened the
// dashboard (2026-07-23 audit). Mirrors lib/painting/release.ts's
// notifyPaintingTradie: dispatch is injected so routing is unit-testable
// without Twilio, and nothing here may throw — a failed notification must
// never break the customer send that precedes it.

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
}): string {
  const hi = args.tradieFirstName ? `Hi ${args.tradieFirstName} - ` : ''
  const who = args.customerName ? `${args.customerName} (${args.customerPhone})` : args.customerPhone
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
      `${hi}new roofing INSPECTION booked via SMS.\n` +
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
  dispatch: DispatchFn
}): Promise<{ notified: boolean }> {
  try {
    const notifyMobile = args.tenant.owner_mobile ?? process.env.TRADIE_NOTIFY_NUMBER ?? null
    if (!notifyMobile) return { notified: false }
    // Self-test guard: when the "customer" is the tradie's own handset,
    // an alert about the message they just received is pure noise.
    if (notifyMobile === args.customerPhone) return { notified: false }
    const text = buildRoofingTradieNotification({
      kind: args.kind,
      tradieFirstName: args.tenant.owner_first_name,
      customerName: args.customerName,
      customerPhone: args.customerPhone,
      address: args.address,
      betterIncGst: args.betterIncGst,
      quoteUrl: args.quoteUrl,
      question: args.question,
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
