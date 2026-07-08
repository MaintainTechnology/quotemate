// Shared policy + lookups for manually sending a quote to its customer
// (dashboard "Send to Customer" → /api/quote/[id]/send, and the approve
// route's release-and-send).
//
// canSendQuote / buildQuoteEmail are PURE (unit-tested directly, per the
// notify-policy convention). resolveCustomerContact takes an injected
// Supabase client and implements the 4-source phone chain the edit route
// proved necessary in prod (2026-05-28: "no phone resolvable" while the
// number sat on sms_conversations.from_number) — extracted here so every
// send path shares one chain instead of each route growing its own subset.

import type { SupabaseClient } from '@supabase/supabase-js'

export type SendGate = { ok: true } | { ok: false; reason: string }

/** May this quote still be (re)sent to the customer? Paid/accepted quotes are
 *  committed — resending would confuse the money path — everything else
 *  (draft, sent, viewed, awaiting_tradie_approval, legacy statuses) is fair
 *  game: a manual send from a held quote IS the tradie's approval, and a
 *  resend of a sent quote is a legitimate nudge. */
export function canSendQuote(status: string | null | undefined): SendGate {
  if (status === 'paid' || status === 'accepted') {
    return {
      ok: false,
      reason: `This quote is already ${status} — the customer has committed. Edit or re-quote instead of resending.`,
    }
  }
  return { ok: true }
}

export type ConfirmSendCta = { show: boolean; label: string }

/** Dashboard Quotes-tab CTA for the send panel. Sending IS the tradie's
 *  confirmation of a held quote, so every pre-send state reads
 *  "Confirm & Send"; already-delivered quotes offer a resend. Hidden once
 *  the customer has committed: paid/accepted statuses (which the send
 *  endpoint also 409s via canSendQuote) plus deposit-paid quotes whose
 *  status hasn't caught up yet. */
export function confirmSendCta(
  status: string | null | undefined,
  depositPaid: boolean,
): ConfirmSendCta {
  if (depositPaid || !canSendQuote(status).ok) {
    return { show: false, label: '' }
  }
  if (status === 'sent' || status === 'viewed') {
    return { show: true, label: 'Send to Customer' }
  }
  return { show: true, label: 'Confirm & Send' }
}

const trimOrNull = (v: string | null | undefined): string | null => (v ?? '').trim() || null

export type CustomerContact = { phone: string | null; email: string | null }

/**
 * Resolve the customer's phone + email for a quote's intake.
 *
 * Phone sources in priority order (empty strings are missing):
 *   1. intake.caller.phone            (authoritative when populated)
 *   2. sms_conversations.from_number  (the number the customer texted from)
 *   3. calls.caller_number            (voice-sourced via Vapi)
 *   4. customers.phone                (linked customer row)
 *
 * Email: intake.caller.email, else customers.email.
 *
 * Never throws — a failed lookup just leaves that source unresolved, so the
 * caller degrades to "nothing on file" instead of 500ing a send.
 */
export async function resolveCustomerContact(
  supabase: SupabaseClient,
  args: {
    caller: { phone?: string; email?: string } | null
    intakeId: string | null
    callId: string | null
    customerId: string | null
  },
): Promise<CustomerContact> {
  let phone = trimOrNull(args.caller?.phone)
  let email = trimOrNull(args.caller?.email)

  // Each source is individually best-effort: a throw in one lookup must not
  // abort the later fallbacks (a transient blip on sms_conversations would
  // otherwise hide a perfectly resolvable calls/customers number).
  if (!phone && args.intakeId) {
    try {
      // Newest conversation wins — an intake can accrue more than one row
      // (reopened threads), and a bare maybeSingle() errors on duplicates.
      const { data } = await supabase
        .from('sms_conversations')
        .select('from_number')
        .eq('intake_id', args.intakeId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      phone = trimOrNull((data as { from_number?: string | null } | null)?.from_number)
    } catch {
      /* source unresolved */
    }
  }

  if (!phone && args.callId) {
    try {
      const { data } = await supabase
        .from('calls')
        .select('caller_number')
        .eq('id', args.callId)
        .maybeSingle()
      phone = trimOrNull((data as { caller_number?: string | null } | null)?.caller_number)
    } catch {
      /* source unresolved */
    }
  }

  if ((!phone || !email) && args.customerId) {
    try {
      const { data } = await supabase
        .from('customers')
        .select('phone, email')
        .eq('id', args.customerId)
        .maybeSingle()
      const row = data as { phone?: string | null; email?: string | null } | null
      phone = phone ?? trimOrNull(row?.phone)
      email = email ?? trimOrNull(row?.email)
    } catch {
      /* source unresolved */
    }
  }

  return { phone, email }
}

export type QuoteEmail = { subject: string; html: string; text: string }

/** Build the customer-facing quote email. Plain HTML, AU English, no emoji.
 *  The PDF line only appears when a PDF actually made it onto the email. */
export function buildQuoteEmail(args: {
  businessName: string | null
  customerName: string | null
  jobType: string | null
  quoteUrl: string
  pdfAttached: boolean
}): QuoteEmail {
  const business = trimOrNull(args.businessName) ?? 'QuoteMax'
  const firstName = (args.customerName ?? '').trim().split(/\s+/)[0] || 'there'
  const job = (args.jobType ?? '').replace(/_/g, ' ').trim()

  const subject = `Your quote from ${business}${job ? ` — ${job}` : ''}`

  const lines = [
    `Hi ${firstName},`,
    `${business} has prepared your quote${job ? ` for your ${job}` : ''}.`,
    `View your quote: ${args.quoteUrl}`,
    ...(args.pdfAttached ? ['A PDF copy of the quote is included with this email.'] : []),
    `Reply to this email if you have any questions.`,
    `— ${business}`,
  ]

  const text = lines.join('\n\n')

  const html = [
    `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.6; color: #1a1a1a; max-width: 560px;">`,
    `<p>Hi ${escapeHtml(firstName)},</p>`,
    `<p>${escapeHtml(business)} has prepared your quote${job ? ` for your ${escapeHtml(job)}` : ''}.</p>`,
    `<p><a href="${escapeHtml(args.quoteUrl)}" style="display: inline-block; background: #FFC400; color: #16120F; font-weight: bold; padding: 10px 18px; text-decoration: none;">View your quote</a></p>`,
    `<p><a href="${escapeHtml(args.quoteUrl)}">${escapeHtml(args.quoteUrl)}</a></p>`,
    ...(args.pdfAttached ? [`<p>A PDF copy of the quote is included with this email.</p>`] : []),
    `<p>Reply to this email if you have any questions.</p>`,
    `<p>— ${escapeHtml(business)}</p>`,
    `</div>`,
  ].join('\n')

  return { subject, html, text }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
