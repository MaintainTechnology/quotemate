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
import { asQuoteTierMode } from '@/lib/quote/tier-visibility'
import { computePriceHoldUntil } from '@/lib/quote/hold'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { resolveCustomerContact } from '@/lib/quote/send-customer'

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

  if (!tenant || quote.tenant_id !== tenant.id) {
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
    .select('id, caller, suburb, job_type, scope, call_id, customer_id, trade')
    .eq('id', quote.intake_id as string)
    .maybeSingle()
  const { data: pricingBook } = await supabase
    .from('pricing_book')
    .select('quote_display, gst_registered, quote_tier_mode')
    .eq('tenant_id', quote.tenant_id)
    .limit(1)
    .maybeSingle()

  // Caller phone number — shared 4-source chain (intake.caller.phone →
  // sms_conversations → calls → customers), the same lookup the edit route
  // proved necessary in prod; the old 2-source version here missed numbers
  // that sat on the intake or customer row.
  const { phone: callerNumber } = await resolveCustomerContact(supabase, {
    caller: (intake?.caller as { phone?: string; email?: string } | null) ?? null,
    intakeId: (quote.intake_id as string | null) ?? null,
    callId: (intake?.call_id as string | null) ?? null,
    customerId: (intake?.customer_id as string | null) ?? null,
  })

  if (!callerNumber) {
    return Response.json(
      { error: 'no_caller_number', message: 'No phone number on file for this customer.' },
      { status: 400 },
    )
  }

  // ─── Build + dispatch the customer SMS ──
  const appUrl = process.env.APP_URL ?? 'https://www.quotemax.com.au'
  const displayMode = resolveQuoteDisplayMode({
    perQuoteOverride: quote.display_mode as string | null,
    tenantPreference:
      (pricingBook as { quote_display?: string | null } | null)?.quote_display ?? null,
  })

  // Reconstruct the Quote shape the SMS template expects. The actual
  // tier jsonb already lives on the quote row; we just need to attach
  // the share-link + deposit pct + pay links so the body renders the
  // pay-now CTAs.
  //
  // Pay links are the GATED /r short-links, never the raw stored Stripe
  // URLs (mirrors the draft route). Raw Session URLs die after Stripe's
  // 24h expiry — usually before a review-held quote is even approved —
  // and bypass /r's book-first funnel + price-hold gate + fresh-Session
  // mint entirely.
  const storedLinks =
    quote.stripe_links && typeof quote.stripe_links === 'object'
      ? (quote.stripe_links as Record<string, string>)
      : {}
  const payLinks: Record<string, string> = {}
  for (const k of Object.keys(storedLinks)) {
    payLinks[k] = `${appUrl}/r/${quote.share_token as string}/${k}`
  }
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
  // Mig 146 — force a fresh render on the human send action so the PDF always
  // reflects the tenant's current Pricing-settings tier mode at send time.
  const quotePdfPath = quote.needs_inspection
    ? null
    : await ensureQuotePdf(quote.id as string, { regenerate: true })

  // Restart the 7-day price hold from the moment the customer actually
  // receives the quote. A review-held quote approved days after drafting
  // would otherwise arrive with its hold partly (or fully) burnt and be
  // blocked as 'expired' by the /r + booking gates before the customer
  // ever had a window to act. Stamped before the SMS body is built so any
  // "price held until" copy shows the refreshed date; harmless if the
  // dispatch below fails (a retry simply restamps).
  const refreshedHoldUntil = computePriceHoldUntil(new Date().toISOString())
  await supabase
    .from('quotes')
    .update({ price_hold_until: refreshedHoldUntil })
    .eq('id', quote.id)

  const quoteForSms = {
    ...quote,
    price_hold_until: refreshedHoldUntil,
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

  // Mig 142 — per-feature tier mode (single-price tradies get one option).
  const tierMode = asQuoteTierMode(
    (pricingBook as { quote_tier_mode?: string | null } | null)?.quote_tier_mode ?? null,
  )
  const body = buildQuoteSms(intakeForSms, quoteForSms, {
    displayMode: asQuoteDisplayMode(displayMode),
    tierMode,
  })
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
  // Columns per migration 039: tenant_id + kind are NOT NULL and outcome is
  // CHECK-constrained — the previous {quote_id, outcome:'approved_and_sent'}
  // shape violated all three, so this insert had silently never written a row.
  {
    const { error: touchErr } = await supabase.from('quote_followup_events').insert({
      tenant_id: quote.tenant_id,
      quote_id: quote.id,
      kind: 'sms',
      outcome: 'text_sent',
      note: 'Tradie approved the quote; customer SMS dispatched.',
    })
    if (touchErr) {
      console.warn('[quote/approve] touch-log insert failed (send unaffected)', touchErr.message)
    }
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
