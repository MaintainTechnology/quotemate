// Thin wrapper over the Resend REST API. We call the HTTP endpoint directly
// (rather than the npm SDK) to keep serverless bundles lean and the result
// shape explicit — mirroring the SMS dispatch result-union convention.

export type SendEmailOk = { ok: true; messageId: string }
export type SendEmailFail = { ok: false; code: string; reason: string }
export type SendEmailResult = SendEmailOk | SendEmailFail

export type SendEmailOptions = {
  to: string
  subject: string
  html: string
  text?: string
  from?: string
  replyTo?: string
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/**
 * Send a single email via Resend. Never throws on a delivery/HTTP error —
 * returns a failure union so the campaign loop can record per-recipient status
 * and keep going.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { ok: false, code: 'not_configured', reason: 'RESEND_API_KEY is not set' }

  const from = opts.from || process.env.RESEND_FROM_EMAIL
  if (!from) return { ok: false, code: 'not_configured', reason: 'no from address (RESEND_FROM_EMAIL)' }

  const body: Record<string, unknown> = {
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  }
  if (opts.text) body.text = opts.text
  if (opts.replyTo) body.reply_to = opts.replyTo

  let res: Response
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return { ok: false, code: 'network_error', reason: String((err as Error)?.message ?? err) }
  }

  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    // tolerate an empty/non-JSON body
  }

  if (!res.ok) {
    const reason =
      (json as { message?: string } | null)?.message ?? `resend responded ${res.status}`
    return { ok: false, code: `http_${res.status}`, reason }
  }

  const id = (json as { id?: string } | null)?.id
  if (!id) return { ok: false, code: 'no_id', reason: 'resend response missing message id' }

  return { ok: true, messageId: id }
}
