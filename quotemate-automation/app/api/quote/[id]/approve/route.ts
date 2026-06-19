// POST /api/quote/[id]/approve
//
// Mig 078 — tradie review-before-send approval endpoint.
//
// When a tenant's review_policy is 'always_review' or
// 'review_over_threshold' AND the quote's total clears the threshold,
// the estimator marks the quote `status = 'awaiting_tradie_approval'`
// and DOES NOT send the customer SMS. The tradie gets a notification
// SMS with a one-tap approve link that hits this endpoint.
//
// On approve:
//   1. Verify the caller's tenant owns the quote.
//   2. Verify the quote is actually in 'awaiting_tradie_approval'
//      (idempotent — re-approving a 'sent' quote is a no-op, not an
//      error, so a double-tap on the approve link doesn't double-fire
//      the customer SMS).
//   3. Send the customer SMS using the same template + dispatch path
//      the estimator would have used auto.
//   4. Advance status to 'sent' so the follow-up + dashboard views
//      pick it up.
//
// Auth: bearer Supabase token (signed-in tradie owner). Mirrors the
// auth pattern in /api/quote/[id]/edit + /api/quote/[id]/check-owner.

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { dispatchQuoteWithPdf } from '@/lib/sms/send-quote-pdf'
import { ensureQuotePdf, quotePdfUrl, signQuotePdfUrl } from '@/lib/quote/pdf'
import { archiveAndIngestQuote } from '@/lib/filestore/ingest-quote'
import { buildQuoteKbText } from '@/lib/filestore/minimize'
import {
  buildQuoteSms,
  buildQuoteUpdatedSms,
} from '@/lib/sms/templates'
import { advanceQuoteStatus } from '@/lib/quote/lifecycle'
import {
  asQuoteDisplayMode,
  resolveQuoteDisplayMode,
} from '@/lib/quote/display'

export const dynamic = 'force-dynamic'

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

  // ─── Auth ──
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const token = auth.slice(7).trim()
  if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData.user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  // ─── Load quote + verify ownership + state ──
  const { data: quote, error: qErr } = await supabase
    .from('quotes')
    .select(
      'id, tenant_id, intake_id, status, share_token, good, better, best, selected_tier, total_inc_gst, scope_of_works, assumptions, estimated_timeframe, needs_inspection, inspection_reason, stripe_links, deposit_pct, display_mode, price_hold_until',
    )
    .eq('id', quoteId)
    .maybeSingle()
  if (qErr) return Response.json({ error: qErr.message }, { status: 500 })
  if (!quote) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!quote.tenant_id) {
    return Response.json({ error: 'unscoped_quote' }, { status: 403 })
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, owner_user_id, twilio_sms_number, business_name')
    .eq('id', quote.tenant_id)
    .maybeSingle()
  if (!tenant) return Response.json({ error: 'tenant_missing' }, { status: 404 })
  if (tenant.owner_user_id !== userId) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  // Idempotency: if the quote isn't awaiting approval, return success
  // with a status code in the body so the page can render "already
  // sent" instead of an error.
  if (quote.status !== 'awaiting_tradie_approval') {
    return Response.json({
      ok: true,
      already_actioned: true,
      status: quote.status,
      message:
        quote.status === 'sent' || quote.status === 'accepted' || quote.status === 'paid'
          ? 'Quote already sent to the customer.'
          : `Quote is in state '${quote.status}' — nothing to approve.`,
    })
  }

  // ─── Load intake (caller name + suburb + job_type) + pricing book
  //      (display mode for the SMS template) ──
  const { data: intake } = await supabase
    .from('intakes')
    .select('id, caller, suburb, job_type, scope, call_id, trade')
    .eq('id', quote.intake_id as string)
    .maybeSingle()
  const { data: pricingBook } = await supabase
    .from('pricing_book')
    .select('quote_display, gst_registered')
    .eq('tenant_id', quote.tenant_id)
    .limit(1)
    .maybeSingle()

  // Caller phone number — pull from sms_conversations (SMS path) or
  // calls (voice path) since quotes table itself doesn't carry it.
  let callerNumber: string | null = null
  const { data: convo } = await supabase
    .from('sms_conversations')
    .select('from_number')
    .eq('intake_id', quote.intake_id as string)
    .maybeSingle()
  if (convo?.from_number) {
    callerNumber = convo.from_number as string
  } else if (intake?.call_id) {
    const { data: call } = await supabase
      .from('calls')
      .select('caller_number')
      .eq('id', intake.call_id as string)
      .maybeSingle()
    callerNumber = call?.caller_number ?? null
  }

  if (!callerNumber) {
    return Response.json(
      { error: 'no_caller_number', message: 'No phone number on file for this customer.' },
      { status: 400 },
    )
  }

  // ─── Build + dispatch the customer SMS ──
  const appUrl = process.env.APP_URL ?? 'https://quote-mate-rho.vercel.app'
  const displayMode = resolveQuoteDisplayMode({
    perQuoteOverride: quote.display_mode as string | null,
    tenantPreference:
      (pricingBook as { quote_display?: string | null } | null)?.quote_display ?? null,
  })

  // Reconstruct the Quote shape the SMS template expects. The actual
  // tier jsonb already lives on the quote row; we just need to attach
  // the share-link + deposit pct + pay links so the body renders the
  // pay-now CTAs.
  const payLinks =
    quote.stripe_links && typeof quote.stripe_links === 'object'
      ? (quote.stripe_links as Record<string, string>)
      : {}
  const depositPct =
    typeof quote.deposit_pct === 'number'
      ? quote.deposit_pct
      : typeof quote.deposit_pct === 'string'
        ? parseFloat(quote.deposit_pct)
        : 30

  // Migration 105 — Gotenberg quote PDF. Held quotes skipped PDF
  // generation at draft time (the customer SMS was held), so this is
  // usually the first render. Best-effort: a failure never blocks the
  // approve-and-send.
  const quotePdfPath = quote.needs_inspection ? null : await ensureQuotePdf(quote.id as string)

  const quoteForSms = {
    ...quote,
    pay_links: payLinks,
    deposit_pct: depositPct,
    needs_inspection: !!quote.needs_inspection,
    inspection_reason: quote.inspection_reason as string | null,
    quote_view_url: `${appUrl}/q/${quote.share_token as string}`,
    pdf_url: quotePdfPath ? quotePdfUrl(quote.share_token as string) : null,
  }
  const intakeForSms = {
    job_type: (intake?.job_type as string) ?? 'other',
    caller: (intake?.caller as { name?: string } | null) ?? null,
    scope: (intake?.scope as { item_count?: number; description?: string } | null) ?? null,
  }

  const body = buildQuoteSms(intakeForSms, quoteForSms, { displayMode: asQuoteDisplayMode(displayMode) })
  const fromNumber = tenant.twilio_sms_number ?? process.env.TWILIO_SMS_NUMBER ?? undefined
  // Best-effort MMS attach of the PDF — the shared helper signs the media
  // URL (best-effort) and dispatch auto-falls back to a plain SMS when the
  // carrier rejects media; the body always carries the download link.
  const dispatch = await dispatchQuoteWithPdf({
    to: callerNumber,
    text: body,
    from: fromNumber,
    pdfPath: quotePdfPath,
    signMediaUrl: signQuotePdfUrl,
  })

  if (!dispatch.ok) {
    // Keep the quote in awaiting_tradie_approval so the tradie can
    // retry; surface the failure so they know to call the customer.
    return Response.json(
      {
        error: 'dispatch_failed',
        sms_code: dispatch.smsAttempt?.code,
        wa_code: dispatch.waAttempt?.code,
        message: 'Could not deliver the customer SMS. Try again or call the customer directly.',
      },
      { status: 502 },
    )
  }

  // Mark as sent (uses the same monotonic lifecycle advancer the
  // estimator uses) so the follow-up queue + dashboard pick it up.
  await advanceQuoteStatus(supabase, quote.id as string, 'sent')

  // Per-tenant file-store ingest — best-effort, post-send (after the
  // customer SMS has gone out and the quote is 'sent'). Archives the
  // rendered quote PDF + a minimized KB text doc for retrieval. STUBs
  // when TENANT_FILESTORE_ENABLED !== 'true' and no-ops on missing
  // inputs, so it never blocks or alters the approve-and-send response.
  const ingestTrade = (intake?.trade as string | null | undefined) ?? 'electrical'
  after(async () => {
    try {
      const fullDocPath = await ensureQuotePdf(quote.id as string)
      if (!fullDocPath) return
      const { markdown, contentHash } = buildQuoteKbText({
        quote: quote as Record<string, unknown>,
        trade: ingestTrade,
      })
      await archiveAndIngestQuote({
        tenantId: (quote.tenant_id as string | null) ?? null,
        sourceKind: 'quote',
        sourceId: quote.id as string,
        trade: ingestTrade,
        fullDocPath,
        kbText: markdown,
        contentHash,
      })
    } catch {
      /* best-effort */
    }
  })

  // Drop a row into quote_followup_events so the touch-log on the
  // dashboard shows "Tradie approved + sent" alongside the other
  // post-send actions. Best-effort; never blocks success.
  try {
    await supabase.from('quote_followup_events').insert({
      quote_id: quote.id,
      outcome: 'approved_and_sent',
      note: 'Tradie approved the quote; customer SMS dispatched.',
    })
  } catch {
    /* swallow — touch-log is not on the critical path */
  }
  // Reference buildQuoteUpdatedSms so the import isn't tree-shaken in
  // tests that load the route module to read its export.
  void buildQuoteUpdatedSms

  return Response.json({
    ok: true,
    quote_id: quote.id,
    channel: dispatch.channel,
    sid: dispatch.sid,
    status: 'sent',
  })
}
