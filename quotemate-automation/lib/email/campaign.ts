// Per-recipient send loop for a campaign. Throttled in small concurrent batches
// so a large list neither blocks a single request indefinitely nor trips the
// provider's rate limit. The actual email send + the per-recipient rendering
// are injected, which keeps this orchestration pure and unit-testable (no DB,
// no network) and lets the route wire in Resend + the announcement renderer.

import type { Contact } from '@/lib/email/recipients'

export type SendStatus = 'sent' | 'failed'

export type SendOutcome = {
  email: string
  status: SendStatus
  messageId?: string
  error?: string
}

export type RenderedMessage = { subject: string; html: string; text: string }

export type SendCampaignOptions = {
  recipients: Contact[]
  /** Build the (personalised) email for one recipient. */
  buildMessage: (contact: Contact) => RenderedMessage
  /** Deliver one message. Returns a result union; must not throw. */
  send: (
    msg: { to: string } & RenderedMessage,
  ) => Promise<{ ok: true; messageId: string } | { ok: false; reason: string }>
  /** Max emails in flight at once. Default 5. */
  concurrency?: number
}

/**
 * Send to every recipient, returning a status row per recipient (R12). A throw
 * from buildMessage or send is captured as a 'failed' outcome so one bad
 * contact never aborts the whole blast.
 */
export async function sendCampaign(opts: SendCampaignOptions): Promise<SendOutcome[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 5)
  const outcomes: SendOutcome[] = new Array(opts.recipients.length)

  let cursor = 0
  async function worker() {
    while (true) {
      const index = cursor++
      if (index >= opts.recipients.length) return
      const contact = opts.recipients[index]
      try {
        const msg = opts.buildMessage(contact)
        const result = await opts.send({ to: contact.email, ...msg })
        outcomes[index] = result.ok
          ? { email: contact.email, status: 'sent', messageId: result.messageId }
          : { email: contact.email, status: 'failed', error: result.reason }
      } catch (err) {
        outcomes[index] = {
          email: contact.email,
          status: 'failed',
          error: String((err as Error)?.message ?? err),
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, opts.recipients.length) }, () =>
    worker(),
  )
  await Promise.all(workers)
  return outcomes
}

/** Convenience summary for the campaign status response. */
export function summarizeOutcomes(outcomes: SendOutcome[]): { sent: number; failed: number } {
  let sent = 0
  let failed = 0
  for (const o of outcomes) {
    if (o.status === 'sent') sent++
    else failed++
  }
  return { sent, failed }
}
