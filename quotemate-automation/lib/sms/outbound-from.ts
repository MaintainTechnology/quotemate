// ONE policy for which number an outbound customer message originates from.
//
// Live incident 2026-07-23: a caller rang Sparky's provisioned number, the
// call errored, and the fallback SMS arrived from the platform's env-default
// number — a number the customer had never seen. Voice-sourced sends carried
// `from: undefined` ("preserves prior voice-path behaviour") from before
// tenants owned numbers; every tenant now has their own provisioned line,
// so the tenant's number wins on EVERY channel. Env fallbacks only apply to
// legacy tenant-less traffic:
//   sms   → TWILIO_SMS_NUMBER (pre-v6 pilot pipeline)
//   voice → undefined, so dispatchQuoteMessage uses its TWILIO_PHONE_NUMBER
//           default (legacy shared voice line)
//
// Used by app/api/vapi/webhook, app/api/intake/structure and
// app/api/estimate/draft — keep them on this helper so the policy can't
// fork again.

export function resolveOutboundFromNumber(opts: {
  tenantSmsNumber: string | null | undefined
  sourceChannel: 'voice' | 'sms'
}): string | undefined {
  if (opts.tenantSmsNumber) return opts.tenantSmsNumber
  return opts.sourceChannel === 'sms' ? process.env.TWILIO_SMS_NUMBER : undefined
}
