// Unified message dispatcher with SMS-first, WhatsApp-fallback strategy.
// Per-call: try SMS via Twilio. If carrier rejects (21612 PH long-code block,
// 21408 geo-permission, etc.), fall back to WhatsApp on the same number.
// WhatsApp delivery requires the recipient to have opted in to the
// Twilio sandbox or to a registered WABA template — production v1 (AU)
// will normally succeed on SMS alone and never trigger the fallback.

import { sendSms, sendWhatsApp } from './twilio'

export type DispatchOk = {
  ok: true
  channel: 'sms' | 'whatsapp'
  sid: string
  status: string
  /** any prior attempt that failed before the eventual success */
  smsAttempt?: { code: string; reason: string }
}

export type DispatchFail = {
  ok: false
  /** SMS attempt result */
  smsAttempt: { code: string; reason: string }
  /** WhatsApp attempt result if we tried (we always try when SMS fails) */
  waAttempt?: { code: string; reason: string }
}

export type DispatchResult = DispatchOk | DispatchFail

export async function dispatchQuoteMessage(opts: {
  to: string
  text: string
}): Promise<DispatchResult> {
  const smsResult = await sendSms({ to: opts.to, text: opts.text })
  if (smsResult.ok) {
    return { ok: true, channel: 'sms', sid: smsResult.sid, status: smsResult.status }
  }

  const smsAttempt = { code: smsResult.code, reason: smsResult.reason }

  const waResult = await sendWhatsApp({ to: opts.to, text: opts.text })
  if (waResult.ok) {
    return { ok: true, channel: 'whatsapp', sid: waResult.sid, status: waResult.status, smsAttempt }
  }

  return {
    ok: false,
    smsAttempt,
    waAttempt: { code: waResult.code, reason: waResult.reason },
  }
}
