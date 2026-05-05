import twilio from 'twilio'

// Twilio signs every webhook with the auth token. We re-compute the
// signature on our side and compare. If it doesn't match, the request
// didn't come from Twilio — drop it with 403.
//
// Reference: https://www.twilio.com/docs/usage/webhooks/webhooks-security
export function validateTwilioSignature(
  signatureHeader: string | null,
  webhookUrl: string,
  params: Record<string, string>,
): boolean {
  if (!signatureHeader) return false
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    console.error('[twilio-validator] TWILIO_AUTH_TOKEN is not set')
    return false
  }
  return twilio.validateRequest(authToken, signatureHeader, webhookUrl, params)
}

// Convenience: parse the URL-encoded form body Twilio POSTs into a
// flat string→string map, the shape validateRequest expects.
export function parseTwilioForm(rawBody: string): Record<string, string> {
  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(rawBody)) params[k] = v
  return params
}
