// POST /api/quote/[id]/send
//
// Manual send/resend of a quote to the customer, triggered by the tradie from
// the dashboard quote viewer ("Send to Customer"). Two channels:
//
//   { channel: 'sms',   to? } — the same customer-quote SMS the pipeline/approve
//     path sends: /q share link in the body, PDF as best-effort MMS, /r-gated
//     pay links, price hold restarted from the send moment.
//   { channel: 'email', to? } — the quote email with the rendered PDF attached
//     (degrades to a link-only email when no PDF can be produced).
//
// `to` optionally overrides the on-file recipient; otherwise the shared
// 4-source contact chain (lib/quote/send-customer.ts) resolves it.
//
// Unlike /approve (which only releases 'awaiting_tradie_approval' holds), this
// endpoint sends from ANY pre-payment status — a send from a held quote is the
// tradie's approval, and a resend of a sent quote is a legitimate nudge. Paid
// and accepted quotes are refused (409). On success the quote advances to
// 'sent' via the monotonic lifecycle advancer; a failed dispatch leaves the
// status untouched so the tradie can retry.
//
// Auth: bearer token (Clerk or legacy Supabase), owner-only — mirrors /approve.

import { createClient } from '@supabase/supabase-js'
import { dispatchQuoteWithPdf } from '@/lib/sms/send-quote-pdf'
import {
  downloadQuotePdf,
  ensureQuotePdf,
  quotePdfUrl,
  signQuotePdfUrl,
} from '@/lib/quote/pdf'
import { buildQuoteSms } from '@/lib/sms/templates'
import { advanceQuoteStatus } from '@/lib/quote/lifecycle'
import {
  asQuoteDisplayMode,
  resolveQuoteDisplayMode,
} from '@/lib/quote/display'
import { asQuoteTierMode } from '@/lib/quote/tier-visibility'
import { computePriceHoldUntil } from '@/lib/quote/hold'
import { asQuoteKind, isSiteVisitFirstRow } from '@/lib/quote/mint-tier'
import {
  MIN_STRIPE_CHARGE_CENTS,
  asMoneyNumber,
  clampDepositPct,
  finalDepositBaseCents,
} from '@/lib/quote/money'
import { pipelineLog } from '@/lib/log/pipeline'
import { normaliseAuMobile } from '@/lib/phone/au'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { sendEmail } from '@/lib/email/resend'
import {
  buildQuoteEmail,
  canSendQuote,
  resolveCustomerContact,
} from '@/lib/quote/send-customer'

export const dynamic = 'force-dynamic'
// Gotenberg PDF render + Twilio/Resend dispatch inside the request — needs
// more than Vercel's 10s default (same knob as the other heavy routes).
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quoteId } = await params
  if (!quoteId) {
    return Response.json({ error: 'missing_quote_id' }, { status: 400 })
  }

  let body: { channel?: string; to?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    /* empty/malformed body → validated below */
  }
  const channel = body?.channel
  if (channel !== 'sms' && channel !== 'email') {
    return Response.json(
      { error: 'invalid_channel', message: "channel must be 'sms' or 'email'." },
      { status: 400 },
    )
  }
  let toOverride =
    typeof body?.to === 'string' ? body.to.trim() || null : null
  if (channel === 'email' && toOverride && !/.+@.+\..+/.test(toOverride)) {
    return Response.json(
      { error: 'invalid_recipient', message: 'That email address does not look valid.' },
      { status: 400 },
    )
  }
  if (channel === 'sms' && toOverride) {
    // A typed number must be a real AU mobile — reject up front rather than
    // burning a Twilio 21211 and returning a generic dispatch failure.
    const normalised = normaliseAuMobile(toOverride)
    if (!normalised) {
      return Response.json(
        {
          error: 'invalid_recipient',
          message: 'Enter a valid Australian mobile, e.g. 04xx xxx xxx.',
        },
        { status: 400 },
      )
    }
    toOverride = normalised
  }

  // ─── Auth (dual-auth: Clerk OR legacy Supabase token) ──
  const resolved = await resolveTenantRequest(
    supabase,
    req,
    'id, twilio_sms_number, business_name',
  )
  if (!resolved) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const tenant = resolved.tenant as {
    id: string
    twilio_sms_number: string | null
    business_name: string | null
  } | null

  // ─── Load quote + verify ownership + sendability ──
  const { data: quote, error: qErr } = await supabase
    .from('quotes')
    .select(
      'id, tenant_id, intake_id, status, share_token, good, better, best, selected_tier, total_inc_gst, scope_of_works, assumptions, estimated_timeframe, needs_inspection, inspection_reason, stripe_links, deposit_pct, display_mode, price_hold_until, applied_discount_pct, quote_kind, paid_at',
    )
    .eq('id', quoteId)
    .maybeSingle()
  if (qErr) return Response.json({ error: qErr.message }, { status: 500 })
  if (!quote) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!quote.tenant_id) {
    return Response.json({ error: 'unscoped_quote' }, { status: 403 })
  }
  if (!tenant || quote.tenant_id !== tenant.id) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const gate = canSendQuote(quote.status as string | null)
  if (!gate.ok) {
    return Response.json(
      { error: 'not_sendable', reason: gate.reason, message: gate.reason },
      { status: 409 },
    )
  }

  // ─── Load intake + pricing book + customer contact ──
  const { data: intake } = await supabase
    .from('intakes')
    .select('id, caller, suburb, job_type, scope, call_id, customer_id, trade')
    .eq('id', quote.intake_id as string)
    .maybeSingle()
  // Trade-scoped (CLAUDE.md: multi-trade scoping is by the trade column
  // everywhere) so a cross-trade tenant's SMS display/tier mode matches the
  // trade-scoped PDF render rather than an arbitrary pricing_book row.
  const trade = ((intake?.trade as string | null | undefined) ?? 'electrical').trim() || 'electrical'
  // The site-visit-first gate must read the RAW trade, never the display
  // fallback above: a trade-less row defaulted to 'electrical' would be sent
  // the $99-only SMS while its /r mint still fails open to a deposit — the
  // message and the money would disagree. approve/ and edit/ already do this.
  const rawTrade = (intake?.trade as string | null | undefined) ?? null
  const { data: pricingBook } = await supabase
    .from('pricing_book')
    .select('quote_display, quote_tier_mode, gst_registered')
    .eq('tenant_id', quote.tenant_id)
    .eq('trade', trade)
    .limit(1)
    .maybeSingle()

  const caller =
    (intake?.caller as { name?: string; phone?: string; email?: string } | null) ?? null
  const contact = await resolveCustomerContact(supabase, {
    caller,
    intakeId: (quote.intake_id as string | null) ?? null,
    callId: (intake?.call_id as string | null) ?? null,
    customerId: (intake?.customer_id as string | null) ?? null,
  })

  const recipient = toOverride ?? (channel === 'sms' ? contact.phone : contact.email)
  if (!recipient) {
    return Response.json(
      channel === 'sms'
        ? {
            error: 'no_customer_phone',
            message: 'No phone number on file for this customer — enter one to send the SMS.',
          }
        : {
            error: 'no_customer_email',
            message: 'No email address on file for this customer — enter one to send the quote.',
          },
      { status: 400 },
    )
  }

  const appUrl = process.env.APP_URL ?? 'https://www.quotemax.com.au'
  const shareToken = quote.share_token as string
  const quoteViewUrl = `${appUrl}/q/${shareToken}`

  // Mig 146 — fresh render on a human send so the PDF reflects the tenant's
  // current tier mode / template at send time. Inspection-routed quotes carry
  // no committable prices, so no PDF. Best-effort: null never blocks the send.
  const quotePdfPath = quote.needs_inspection
    ? null
    : await ensureQuotePdf(quote.id as string, { regenerate: true })

  // Restart the 7-day price hold from the moment the customer actually
  // receives the quote (same rationale as /approve — a stale hold would let
  // the /r + booking gates block the customer before they had a window to
  // act). Computed here because the SMS body embeds it, but only WRITTEN
  // after a successful dispatch: a failed send must not silently re-arm an
  // expired hold for a quote the customer never received.
  const quoteKind = asQuoteKind(quote.quote_kind as string | null)

  if (quoteKind !== 'initial') {
    // R9 — the email channel is for initial quotes only. buildQuoteEmail's
    // copy is generic: it carries no deposit link, no $99 credit and no fee
    // line, so an emailed final quote tells the customer nothing about what
    // they owe or how to pay it. This is the server-side half of hiding the
    // email row in the dashboard — the API must not be the weaker gate.
    if (channel === 'email') {
      return Response.json(
        {
          error: 'email_not_supported_for_child',
          message: 'Final quotes and balance requests are sent by SMS.',
        },
        { status: 409 },
      )
    }
    // A balance row is an invoice minted by "Request final payment", which
    // texts its own link. Pushing it through the quote sender would compose a
    // degenerate tier message ("YOUR OPTION (inc 10% GST)") for a row that
    // has no tiers at all.
    if (quoteKind === 'balance') {
      return Response.json(
        {
          error: 'balance_not_sendable',
          message: 'Use Request final payment to re-send the balance link.',
        },
        { status: 409 },
      )
    }
    // Never text a customer an unpriced quote. The child is seeded with a $0
    // whole-of-job line for the tradie to fill in on site; sending before
    // that is always a mis-tap, and it used to stamp the row paid-by-credit
    // and freeze it permanently.
    const totalCents = Math.round(
      asMoneyNumber(quote.total_inc_gst as number | string | null) * 100,
    )
    if (totalCents < MIN_STRIPE_CHARGE_CENTS) {
      return Response.json(
        {
          error: 'not_priced',
          message: 'Add the confirmed price before sending this final quote.',
        },
        { status: 409 },
      )
    }
  }

  // A final/balance row carries no price hold (spec R9): the hold is a
  // freshness window on an unaccepted estimate, and the mint skips its gate
  // for children. Re-arming it here would write a `price_hold_until` that
  // makes the quote page render a countdown the customer can't act on.
  const refreshedHoldUntil =
    quoteKind === 'initial' ? computePriceHoldUntil(new Date().toISOString()) : null

  if (channel === 'sms') {
    const displayMode = resolveQuoteDisplayMode({
      perQuoteOverride: quote.display_mode as string | null,
      tenantPreference:
        (pricingBook as { quote_display?: string | null } | null)?.quote_display ?? null,
    })

    // Pay links are the GATED /r short-links, never raw stored Stripe URLs
    // (they expire after 24h and bypass the book-first funnel) — see /approve.
    const storedLinks =
      quote.stripe_links && typeof quote.stripe_links === 'object'
        ? (quote.stripe_links as Record<string, string>)
        : {}
    const payLinks: Record<string, string> = {}
    for (const k of Object.keys(storedLinks)) {
      payLinks[k] = `${appUrl}/r/${shareToken}/${k}`
    }
    // Spec elec-plumb-site-visit-first R5 — electrical/plumbing sell only the
    // $99 site visit, so the message needs that link even on a quote drafted
    // before the model changed (whose stripe_links hold G/B/B only).
    // /r/<token>/inspection mints a fresh Session per click, so it is always live.
    if (isSiteVisitFirstRow({ trade: rawTrade, quoteKind })) {
      payLinks.inspection = `${appUrl}/r/${shareToken}/inspection`
    }
    // A FINAL quote sells its deposit and nothing else (spec R9). The link is
    // set unconditionally because the loop above only mirrors keys already in
    // stripe_links, and a freshly-issued child has none — /r mints per click,
    // so the short-link is live regardless. Any `inspection` key inherited
    // from the parent is dropped: offering it here would sell a second site
    // visit and, once paid, claim the row's only paid_at slot.
    if (quoteKind === 'final') {
      delete payLinks.inspection
      payLinks.deposit = `${appUrl}/r/${shareToken}/deposit`
    }
    const depositPct =
      typeof quote.deposit_pct === 'number'
        ? quote.deposit_pct
        : typeof quote.deposit_pct === 'string'
          ? parseFloat(quote.deposit_pct)
          : 30

    const quoteForSms = {
      ...quote,
      price_hold_until: refreshedHoldUntil,
      pay_links: payLinks,
      deposit_pct: depositPct,
      needs_inspection: !!quote.needs_inspection,
      inspection_reason: quote.inspection_reason as string | null,
      quote_view_url: quoteViewUrl,
      pdf_url: quotePdfPath ? quotePdfUrl(shareToken) : null,
      // P6 — SMS prices match the /r-minted Session: discounted when the
      // customer booked in time, GST-conditional (lib/quote/money.ts).
      applied_discount_pct: (quote.applied_discount_pct as number | null) ?? 0,
      gst_registered:
        ((pricingBook as { gst_registered?: boolean | null } | null)?.gst_registered ?? true),
    }
    const intakeForSms = {
      job_type: (intake?.job_type as string) ?? 'other',
      caller: (caller as { name?: string } | null) ?? null,
      scope: (intake?.scope as { item_count?: number; description?: string } | null) ?? null,
    }
    const tierMode = asQuoteTierMode(
      (pricingBook as { quote_tier_mode?: string | null } | null)?.quote_tier_mode ?? null,
    )
    const smsBody = buildQuoteSms(intakeForSms, quoteForSms, {
      displayMode: asQuoteDisplayMode(displayMode),
      tierMode,
      trade: rawTrade,
      quoteKind,
      businessName: (tenant as { business_name?: string | null }).business_name ?? null,
    })
    const fromNumber = tenant.twilio_sms_number ?? process.env.TWILIO_SMS_NUMBER ?? undefined

    const dispatch = await dispatchQuoteWithPdf({
      // On-file numbers can carry AU-local formatting (LLM-structured
      // intake.caller.phone) — normalise to E.164 when possible, pass through
      // otherwise (from_number is already E.164).
      to: normaliseAuMobile(recipient) ?? recipient,
      text: smsBody,
      from: fromNumber,
      pdfPath: quotePdfPath,
      signMediaUrl: signQuotePdfUrl,
    })

    if (!dispatch.ok) {
      return Response.json(
        {
          error: 'dispatch_failed',
          sms_code: dispatch.smsAttempt?.code,
          wa_code: dispatch.waAttempt?.code,
          message: 'Could not deliver the SMS. Try again or call the customer directly.',
        },
        { status: 502 },
      )
    }

    await markSent(quote.id as string, quote.tenant_id as string, refreshedHoldUntil, 'sms')

    // ── R8: the $99 already covers the deposit ──────────────────────
    // A job small enough that pct% of it is under the site-visit fee has
    // nothing left to charge as a deposit. Stamping the row paid with a
    // 'credit' tier is what lets the chain continue: "Request final payment"
    // accepts it, the row leaves the follow-up queues, and it freezes like
    // any other paid row. paid_amount_cents 0 with a NULL Connect destination
    // keeps it out of Payouts — there is no money to release.
    //
    // Stamped HERE, after a delivered dispatch, and never before: the house
    // rule is that nothing may report a state the customer was not actually
    // told about.
    const creditStamped = await stampDepositCoveredByCredit(quote, quoteKind)

    return Response.json({
      ok: true,
      quote_id: quote.id,
      channel: dispatch.channel,
      sid: dispatch.sid,
      status: 'sent',
      ...(creditStamped ? { deposit_covered_by_credit: true } : {}),
    })
  }

  // ─── Email channel ──
  let attachments: Array<{ filename: string; content: string }> | undefined
  if (quotePdfPath) {
    try {
      const pdf = await downloadQuotePdf(quotePdfPath)
      attachments = [
        { filename: `quote-${shareToken.slice(0, 8)}.pdf`, content: pdf.toString('base64') },
      ]
    } catch (e) {
      console.warn(
        '[quote/send] PDF download failed — sending link-only email',
        e instanceof Error ? e.message : e,
      )
    }
  }

  const email = buildQuoteEmail({
    businessName: tenant.business_name,
    customerName: caller?.name ?? null,
    jobType: (intake?.job_type as string | null) ?? null,
    quoteUrl: quoteViewUrl,
    pdfAttached: !!attachments,
  })

  const result = await sendEmail({
    to: recipient,
    subject: email.subject,
    html: email.html,
    text: email.text,
    replyTo: resolved.identity.email ?? undefined,
    attachments,
  })

  if (!result.ok) {
    return Response.json(
      {
        error: 'email_failed',
        code: result.code,
        message: `Could not send the email (${result.reason}). Try again or use SMS.`,
      },
      { status: 502 },
    )
  }

  await markSent(quote.id as string, quote.tenant_id as string, refreshedHoldUntil, 'email')

  return Response.json({
    ok: true,
    quote_id: quote.id,
    channel: 'email',
    messageId: result.messageId,
    status: 'sent',
  })
}

/**
 * R8 — mark a FINAL row's deposit as already covered by the $99 site visit.
 *
 * Returns true when the stamp was applied. No-op for anything that is not an
 * unpaid final row whose deposit lands under Stripe's minimum charge, so a
 * normal final quote is untouched. The `.is('paid_at', null)` guard makes it
 * a conditional claim, matching the payment path: a re-send can never
 * overwrite a real deposit payment that landed in between.
 */
async function stampDepositCoveredByCredit(
  quote: { id: unknown; total_inc_gst: unknown; deposit_pct: unknown; paid_at: unknown },
  quoteKind: string,
): Promise<boolean> {
  if (quoteKind !== 'final' || quote.paid_at) return false
  const totalCents = Math.round(asMoneyNumber(quote.total_inc_gst as number | string | null) * 100)
  // An UNPRICED row is not a small job — it is a draft. R3 seeds every final
  // quote off an inspection-routed parent with a $0 whole-of-job line, so
  // without this guard the very first Send (before the tradie types the price
  // they confirmed on site) computes max(0, 0 − $99) = 0, stamps the row paid
  // by "credit", and freezes it forever: edit 409s on paid_at, and Request
  // final payment 409s nothing_to_charge because the balance is −$99.
  if (totalCents < MIN_STRIPE_CHARGE_CENTS) return false
  const depositBase = finalDepositBaseCents(
    totalCents,
    clampDepositPct(quote.deposit_pct as number | null),
  )
  if (depositBase >= MIN_STRIPE_CHARGE_CENTS) return false

  const { data, error } = await supabase
    .from('quotes')
    .update({
      paid_at: new Date().toISOString(),
      paid_tier: 'credit',
      paid_amount_cents: 0,
      paid_stripe_session_id: null,
      stripe_connect_destination: null,
    })
    .eq('id', quote.id as string)
    .is('paid_at', null)
    .select('id')
  if (error) {
    pipelineLog('dispatch').err('deposit-credit stamp failed', error.message, {
      quote_id: String(quote.id),
    })
    return false
  }
  return !!data && data.length > 0
}

/** Post-success bookkeeping: restart the price hold, advance the lifecycle,
 *  and drop a touch-log row. Only called after a delivered send. */
async function markSent(
  quoteId: string,
  tenantId: string,
  holdUntilIso: string | null,
  channel: 'sms' | 'email',
) {
  if (holdUntilIso) {
    await supabase
      .from('quotes')
      .update({ price_hold_until: holdUntilIso })
      .eq('id', quoteId)
  }
  await advanceQuoteStatus(supabase, quoteId, 'sent')
  // Touch-log entry for the dashboard timeline. Best-effort — never blocks
  // the send response. Columns per migration 039: tenant_id + kind are NOT
  // NULL and outcome is CHECK-constrained ('text_sent' for SMS; email has no
  // dedicated kind, so it logs as a 'note' with outcome 'other').
  const { error } = await supabase.from('quote_followup_events').insert({
    tenant_id: tenantId,
    quote_id: quoteId,
    kind: channel === 'sms' ? 'sms' : 'note',
    outcome: channel === 'sms' ? 'text_sent' : 'other',
    note: `Tradie sent the quote to the customer via ${channel === 'sms' ? 'SMS' : 'email'}.`,
  })
  if (error) {
    console.warn('[quote/send] touch-log insert failed (send unaffected)', error.message)
  }
}
