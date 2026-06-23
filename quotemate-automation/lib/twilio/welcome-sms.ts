// Welcome SMS dispatched from the tenant's brand-new QuoteMax number to
// their personal mobile. Closes the activation loop visibly — the tradie
// physically receives a text seconds after hitting "Activate".
//
// Same env-flag gating as provision.ts so flipping
// `TWILIO_PROVISIONING_ENABLED=true` turns this on alongside the real
// number purchase.

import { sendSms } from '@/lib/sms/twilio'

export type WelcomeSmsResult =
  | { ok: true; stubbed: false; sid: string }
  | { ok: true; stubbed: true; loggedMessage: string }
  | { ok: false; reason: string }

export async function sendWelcomeSms(opts: {
  fromNumber: string       // the tenant's freshly-provisioned QuoteMax number
  toMobile: string         // owner's personal mobile (E.164)
  firstName: string
  businessName: string
}): Promise<WelcomeSmsResult> {
  const body = buildWelcomeBody(opts)

  // Gate the live SMS dispatch. Stub mode keeps the cost at zero.
  if (process.env.TWILIO_PROVISIONING_ENABLED !== 'true') {
    console.log('[stub] welcome SMS', {
      from: opts.fromNumber,
      to: opts.toMobile,
      body,
    })
    return { ok: true, stubbed: true, loggedMessage: body }
  }

  const res = await sendSms({
    to: opts.toMobile,
    from: opts.fromNumber,
    text: body,
  })
  if (!res.ok) {
    return { ok: false, reason: `${res.code}: ${res.reason}` }
  }
  return { ok: true, stubbed: false, sid: res.sid }
}

function buildWelcomeBody(opts: { firstName: string; businessName: string; fromNumber: string }): string {
  // GSM-7-safe ASCII so it lands in a single segment whenever possible.
  return (
    `G'day ${opts.firstName}, your QuoteMax line is live. ` +
    `Send any text to this number to try your AI receptionist. ` +
    `Quotes drafted for ${opts.businessName} customers will land in your inbox in under a minute. ` +
    `- QuoteMax`
  )
}
