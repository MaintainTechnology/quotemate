// Unified message dispatcher with SMS-first, WhatsApp-fallback strategy.
// Per-call: try SMS via Twilio (with retries on transient errors). If
// carrier permanently rejects (21612 PH long-code block, 21408 geo-
// permission, etc.), fall back to WhatsApp on the same number.
// WhatsApp delivery requires the recipient to have opted in to the
// Twilio sandbox or to a registered WABA template — production v1 (AU)
// will normally succeed on SMS alone and never trigger the fallback.
//
// CONCURRENCY NOTE — at moderate load (e.g. two customers texting at the
// same instant), AU long codes throttle outbound at ~1 SMS/sec. Without
// retries, the second send returns 429 / carrier-rate-limit, dispatch
// falls back to WhatsApp, WhatsApp fails (recipient hasn't opted in),
// and the customer gets silence. With per-customer retries below, the
// throttled send waits a beat and goes through cleanly.

import { sendSms, sendWhatsApp, type TwilioSendResult } from './twilio'
import { isRetryableSendError } from './send-reliability'

export type DispatchOk = {
  ok: true
  channel: 'sms' | 'whatsapp'
  sid: string
  status: string
  /** any prior attempt that failed before the eventual success */
  smsAttempt?: { code: string; reason: string }
  /** number of SMS attempts made (1 = first try succeeded, >1 = retried) */
  smsAttempts?: number
  /** true when media was attached and delivered (MMS). */
  mms?: boolean
  /** true when an MMS attempt failed and we fell back to a plain SMS
   *  (the body still carries the quote-page link). */
  mediaDropped?: boolean
}

export type DispatchFail = {
  ok: false
  /** SMS attempt result (last attempt's code/reason) */
  smsAttempt: { code: string; reason: string }
  /** total SMS attempts before giving up */
  smsAttempts: number
  /** WhatsApp attempt result if we tried (we always try when SMS fails) */
  waAttempt?: { code: string; reason: string }
}

export type DispatchResult = DispatchOk | DispatchFail

// Codes we'll retry on. Anything not on this list is treated as a
// permanent failure (e.g. 21408 invalid recipient, 21610 STOP'd, 21612
// blocked) and we move straight to WhatsApp fallback rather than burning
// retry budget on a request that'll never succeed.
//
//   - NETWORK:  fetch threw before reaching Twilio
//   - 429:      Twilio rate limit — back off and retry
//   - 5xx:      Twilio server error — back off and retry
//   - 14107 / 14101: messaging-service rate limits (Twilio internal)
//
// R46-sends: delegate the classification to the shared `isRetryableSendError`
// in send-reliability.ts so dispatch and the route-level retry agree on
// exactly one policy. A Twilio failed-result is `{ ok:false, code }`, which
// `isRetryableSendError` understands directly; this keeps the historical
// NETWORK/429/5xx/14107/14101 set retryable and everything else terminal.
function isRetryable(result: Extract<TwilioSendResult, { ok: false }>): boolean {
  return isRetryableSendError(result)
}

const RETRY_DELAYS_MS = [500, 1500, 3500] // total max ~5.5s before falling back

// Map a thrown error from sendSms (AbortError / TimeoutError / generic
// network throw that escaped postTwilioMessage's own try) into a synthetic
// failed TwilioSendResult so the retry/fallback loop below has ONE code path.
// Without this, a thrown AbortError would bubble out of sendSmsWithRetry and
// (a) skip the WhatsApp fallback and (b) skip retrying a transient timeout —
// the first-class case send-reliability.ts was built to close.
function thrownToResult(e: unknown): Extract<TwilioSendResult, { ok: false }> {
  const name = e instanceof Error ? e.name : undefined
  const reason = e instanceof Error ? e.message : String(e)
  // Preserve the thrown error's name as the `code` so isRetryableSendError
  // classifies AbortError/TimeoutError as retryable; otherwise tag NETWORK.
  const code = name === 'AbortError' || name === 'TimeoutError' ? name : 'NETWORK'
  return { ok: false, code, reason, raw: null }
}

async function sendSmsWithRetry(opts: {
  to: string
  text: string
  from?: string
  mediaUrl?: string | string[]
}): Promise<{ result: TwilioSendResult; attempts: number }> {
  let attempts = 0
  let last: TwilioSendResult | null = null
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    attempts++
    let result: TwilioSendResult
    try {
      result = await sendSms(opts)
    } catch (e) {
      // sendSms normally returns a failed result rather than throwing, but a
      // Vercel function teardown / undici headers-timeout can surface as a
      // thrown AbortError/TimeoutError. Treat it as a (retryable) transient.
      result = thrownToResult(e)
    }
    if (result.ok) {
      if (attempts > 1) {
        console.log(`[dispatch] sendSms succeeded on attempt ${attempts} to ${opts.to}`)
      }
      return { result, attempts }
    }
    last = result
    if (!isRetryable(result)) {
      console.warn(`[dispatch] sendSms failed permanently (code=${result.code}) to ${opts.to} — falling back`)
      break
    }
    if (i === RETRY_DELAYS_MS.length) {
      console.error(`[dispatch] sendSms exhausted ${attempts} retries (last code=${result.code}) to ${opts.to} — falling back`)
      break
    }
    console.warn(`[dispatch] sendSms transient failure (code=${result.code}) to ${opts.to} — retry ${attempts + 1} in ${RETRY_DELAYS_MS[i]}ms`)
    await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[i]))
  }
  return { result: last!, attempts }
}

export async function dispatchQuoteMessage(opts: {
  to: string
  text: string
  /** Optional SMS sender override. Defaults to TWILIO_PHONE_NUMBER (voice
   *  agent's number). The SMS-channel inbound route passes TWILIO_SMS_NUMBER
   *  here so customer-facing SMS replies originate from the same number the
   *  customer texted. WhatsApp always uses TWILIO_WHATSAPP_FROM regardless. */
  from?: string
  /** Optional media URL(s) to attach as an MMS (e.g. the satellite roof
   *  image). If the MMS send fails, we automatically retry as a plain SMS
   *  — the body still carries the quote-page link — before WhatsApp. */
  mediaUrl?: string | string[]
}): Promise<DispatchResult> {
  let mediaDropped = false
  let attempt = await sendSmsWithRetry({
    to: opts.to,
    text: opts.text,
    from: opts.from,
    mediaUrl: opts.mediaUrl,
  })

  // MMS attempt failed — fall back to a plain SMS (the link is in the body)
  // before resorting to WhatsApp.
  if (!attempt.result.ok && opts.mediaUrl) {
    console.warn(`[dispatch] MMS send failed (code=${attempt.result.code}) to ${opts.to} — retrying as plain SMS`)
    mediaDropped = true
    attempt = await sendSmsWithRetry({ to: opts.to, text: opts.text, from: opts.from })
  }

  const { result: smsResult, attempts: smsAttempts } = attempt

  if (smsResult.ok) {
    return {
      ok: true,
      channel: 'sms',
      sid: smsResult.sid,
      status: smsResult.status,
      smsAttempts,
      mms: !!opts.mediaUrl && !mediaDropped,
      mediaDropped,
    }
  }

  const smsAttempt = { code: smsResult.code, reason: smsResult.reason }

  // WhatsApp fallback. Same teardown guard as the SMS path: a thrown
  // AbortError/timeout here must NOT escape dispatchQuoteMessage (callers
  // — the route's after() block included — rely on it returning a
  // DispatchResult, never throwing), so degrade a throw to a failed result.
  let waResult: TwilioSendResult
  try {
    waResult = await sendWhatsApp({ to: opts.to, text: opts.text })
  } catch (e) {
    waResult = thrownToResult(e)
  }
  if (waResult.ok) {
    return {
      ok: true,
      channel: 'whatsapp',
      sid: waResult.sid,
      status: waResult.status,
      smsAttempt,
      smsAttempts,
    }
  }

  return {
    ok: false,
    smsAttempt,
    smsAttempts,
    waAttempt: { code: waResult.code, reason: waResult.reason },
  }
}
