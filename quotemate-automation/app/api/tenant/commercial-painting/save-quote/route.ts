// POST /api/tenant/commercial-painting/save-quote — tenant-scoped.
//
// Turns a PRICED run into a real quote record: intakes
// (trade='commercial_painting') + quotes (single tender wrapped into the
// established tier shape, share_token) and a tender PDF rendered via the
// existing Gotenberg pattern into the quote-pdfs bucket at
// quotes/<quoteId>.pdf — the path /api/q/[token]/pdf already serves.
// PDF generation is best-effort: the quote stands without it.
//
// Body: { paintRunId: string, extractionId: string }

import { after } from 'next/server'
import { isDeepStrictEqual } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { tenantFromBearer, estimatorSupabase } from '@/lib/estimation/auth'
import { archiveAndIngestQuote } from '@/lib/filestore/ingest-quote'
import { buildQuoteKbText } from '@/lib/filestore/minimize'
import { buildPaintQuotePayloads } from '@/lib/commercial-painting/save-quote-helpers'
import { buildPaintTenderReportHtml } from '@/lib/commercial-painting/report-html'
import { loadTenantBranding } from '@/lib/pdf/branding'
import { normaliseAuMobile } from '@/lib/commercial-painting/notify'
import { gotenbergConfigured, renderPdfFromHtml } from '@/lib/pdf/gotenberg'
import { generateShareToken } from '@/lib/stripe/checkout'
import { pipelineLog } from '@/lib/log/pipeline'
import { provisionSessionStore } from '@/lib/filestore/provision'
import { MAX_LABOUR_RATE_PER_HR, type PaintTakeoffItem, type PricedPaintBom } from '@/lib/commercial-painting/types'
import { applyLabourRateOverride, loadPaintRates, resolvePaintRates } from '@/lib/commercial-painting/rates'
import { assessPaintPricingAuthority, pricePaintTakeoff } from '@/lib/commercial-painting/price'
import { findCommercialPaintPricingBook } from '@/lib/commercial-painting/pricing-context'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

const storage = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ ok: false, error: 'unauthorised' }, { status: 401 })

  let body: {
    paintRunId?: string
    extractionId?: string
    customerPhone?: string
    customerName?: string
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const paintRunId = body.paintRunId?.trim()
  const extractionId = body.extractionId?.trim()
  // Customer details may be attached to the draft for the queue/CRM. Saving
  // never delivers the quote; the reviewed send action owns all SMS/MMS.
  const customerMobile = normaliseAuMobile(body.customerPhone)
  const customerName = body.customerName?.trim() || null
  if (!paintRunId || !extractionId) {
    return Response.json({ ok: false, error: 'missing_ids' }, { status: 400 })
  }

  const [{ data: run }, { data: ext }] = await Promise.all([
    estimatorSupabase
      .from('paint_runs')
      .select('id, job_name, site_address')
      .eq('id', paintRunId)
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
    estimatorSupabase
      .from('plan_extractions')
      .select('id, items, corrected_items, priced_bom, priced_at, sheets_used')
      .eq('id', extractionId)
      .eq('paint_run_id', paintRunId)
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
  ])
  if (!run) return Response.json({ ok: false, error: 'run_not_found' }, { status: 404 })
  const storedBom = (ext?.priced_bom ?? null) as PricedPaintBom | null
  if (!storedBom) {
    return Response.json(
      { ok: false, error: 'not_priced', detail: 'Price the confirmed takeoff before saving a quote.' },
      { status: 422 },
    )
  }
  const currentItems = (Array.isArray(ext?.corrected_items) && ext.corrected_items.length > 0
    ? ext.corrected_items
    : ext?.items) as PaintTakeoffItem[] | null
  if (!Array.isArray(currentItems) || currentItems.length === 0) {
    return Response.json(
      { ok: false, error: 'inspection_required', detail: 'The current confirmed takeoff must be priced before saving.' },
      { status: 422 },
    )
  }

  let rows
  try {
    rows = await loadPaintRates(estimatorSupabase, tenant.id)
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: 'rates_load_failed',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
  const pricingBook = await findCommercialPaintPricingBook(estimatorSupabase, tenant)
  const baseBook = resolvePaintRates(rows)
  const storedLabourRate = storedBom.labour?.ratePerHr
  const validStoredLabourRate =
    typeof storedLabourRate === 'number' &&
    Number.isFinite(storedLabourRate) &&
    storedLabourRate > 0 &&
    storedLabourRate <= MAX_LABOUR_RATE_PER_HR
      ? storedLabourRate
      : null
  const currentBook = applyLabourRateOverride(baseBook, validStoredLabourRate)
  const storedAuthority = assessPaintPricingAuthority(storedBom, currentBook, pricingBook != null)
  if (!storedAuthority.ok) {
    return Response.json(storedAuthority, { status: 422 })
  }
  const currentBom = pricePaintTakeoff(currentItems, currentBook, {
    gstRegistered: pricingBook?.gst_registered === true,
  })
  const authority = assessPaintPricingAuthority(currentBom, currentBook, pricingBook != null)
  if (!authority.ok) {
    return Response.json(authority, { status: 422 })
  }
  if (!validStoredLabourRate || !isDeepStrictEqual(storedBom, currentBom)) {
    return Response.json(
      {
        ok: false,
        error: 'tenant_pricing_required',
        detail: 'The confirmed takeoff or tenant rates changed after pricing. Re-price before saving the customer quote.',
      },
      { status: 422 },
    )
  }
  const bom = currentBom

  const appUrl = process.env.APP_URL ?? 'https://www.quotemax.com.au'

  // ── Idempotency: one quote per pricing pass. Re-saving the same
  // priced_at returns the existing quote instead of minting duplicate
  // rows + share tokens; a re-price (new priced_at) allows a new quote.
  const sheets = (ext?.sheets_used ?? {}) as Record<string, unknown> & {
    saved_quote?: { quote_id: string; share_token: string; priced_at: string; pdf_ready?: boolean }
  }
  if (sheets.saved_quote && sheets.saved_quote.priced_at === ext?.priced_at) {
    const prior = sheets.saved_quote
    return Response.json({
      ok: true,
      quoteId: prior.quote_id,
      shareToken: prior.share_token,
      // Relative — the dashboard opens these on whatever origin it runs on
      // (localhost dev included); an absolute prod URL 404s against a quote
      // that lives in the dev database.
      quoteViewUrl: `/q/${prior.share_token}`,
      pdfUrl: prior.pdf_ready ? `/api/q/${prior.share_token}/pdf` : null,
      alreadySaved: true,
    })
  }

  const branding = await loadTenantBranding(estimatorSupabase, tenant.id, 'commercial-painting')

  const shareToken = generateShareToken()
  const payloads = buildPaintQuotePayloads({
    bom,
    tenantId: tenant.id,
    shareToken,
    jobName: run.job_name as string | null,
    siteAddress: run.site_address as string | null,
  })

  const { data: intakeRow, error: intakeErr } = await estimatorSupabase
    .from('intakes')
    .insert(payloads.intake)
    .select('id')
    .single()
  if (intakeErr || !intakeRow) {
    return Response.json(
      { ok: false, error: 'intake_insert_failed', detail: intakeErr?.message ?? 'no row' },
      { status: 500 },
    )
  }

  const { data: quoteRow, error: quoteErr } = await estimatorSupabase
    .from('quotes')
    .insert({ ...payloads.quote, intake_id: intakeRow.id })
    .select('id, share_token')
    .single()
  if (quoteErr || !quoteRow) {
    return Response.json(
      { ok: false, error: 'quote_insert_failed', detail: quoteErr?.message ?? 'no row' },
      { status: 500 },
    )
  }

  // Mint the paint_run's public_token (best-effort, non-blocking) so the rich
  // commercial-paint takeoff page /q/commercial-paint/[token] and the dashboard
  // "saved jobs" link-out card work. Only sets it when absent (idempotent), and
  // a failure here never affects the quote save outcome.
  try {
    await estimatorSupabase
      .from('paint_runs')
      .update({ public_token: generateShareToken() })
      .eq('id', paintRunId)
      .is('public_token', null)
  } catch {
    /* best-effort — the quote + /q/[token] view stand without the rich page */
  }

  // Absolute URL only for the PRINTED footer of the tender PDF (a PDF
  // can't use a relative link); the dashboard's clickable links below
  // are relative so they work on any origin, dev included.
  const quoteViewUrl = `${appUrl}/q/${shareToken}`
  const log = pipelineLog('estimate', paintRunId)

  // ── Tender PDF — best-effort, never blocks the quote. ─────────────
  let pdfReady = false
  if (gotenbergConfigured()) {
    try {
      const html = buildPaintTenderReportHtml({
        businessName: branding.businessName,
        branding,
        jobName: run.job_name as string | null,
        siteAddress: run.site_address as string | null,
        bom,
        quoteViewUrl,
      })
      const pdf = await renderPdfFromHtml(html)
      const path = `quotes/${quoteRow.id}.pdf`
      const { error: upErr } = await storage.storage
        .from('quote-pdfs')
        .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
      if (!upErr) {
        await estimatorSupabase.from('quotes').update({ pdf_path: path }).eq('id', quoteRow.id)
        pdfReady = true
        // Index the finished tender PDF into the run's persistent store so the
        // estimator chatbot can answer "why this price?" from the result itself.
        provisionSessionStore({
          estimator: 'paint',
          sessionId: paintRunId,
          label: customerName ?? (run.job_name as string | null) ?? null,
          documents: [{ name: 'paint-quote.pdf', bytes: pdf, mime: 'application/pdf' }],
        })
      } else {
        log.err('paint tender pdf upload failed', upErr, { quoteId: quoteRow.id })
      }
    } catch (e) {
      // PDF is a bonus; the quote record is the deliverable — but the
      // failure must be visible in platform logs, not swallowed.
      log.err('paint tender pdf render failed', e, { quoteId: quoteRow.id })
    }
  } else {
    log.err('paint tender pdf skipped — GOTENBERG_URL not configured', undefined, { quoteId: quoteRow.id })
  }

  // Record the saved quote on the extraction (idempotency anchor).
  await estimatorSupabase
    .from('plan_extractions')
    .update({
      sheets_used: {
        ...sheets,
        saved_quote: {
          quote_id: quoteRow.id,
          share_token: shareToken,
          priced_at: ext?.priced_at ?? null,
          pdf_ready: pdfReady,
        },
      },
    })
    .eq('id', extractionId)

  // Attach the customer to the draft intake without sending anything. The
  // quote remains `tradie_review` until the separate reviewed send action.
  if (customerMobile) {
    await estimatorSupabase
      .from('intakes')
      .update({ caller: { name: customerName ?? '', phone: customerMobile, email: '' } })
      .eq('id', intakeRow.id)
  }

  log.ok('paint quote saved', {
    quoteId: quoteRow.id,
    totalIncGst: bom.totalIncGst,
    pdfReady,
    delivered: 'not_attempted',
  })

  // ── Per-tenant file-store archive + KB ingest (spec 2026-06-19). The full
  //    tender PDF was already archived at quotes/<quoteId>.pdf above; here we
  //    push ONLY the PII-minimized summary into the tenant's KB. Best-effort,
  //    never throws, STUBs when TENANT_FILESTORE_ENABLED!=='true', and no-ops
  //    when no PDF was produced (no fullDocPath). Tracking source_id for
  //    painting is the painting public_token (== shareToken), not the quoteId.
  if (pdfReady) {
    after(async () => {
      const { markdown, contentHash } = buildQuoteKbText({
        quote: { estimate: bom },
        trade: 'commercial-painting',
      })
      await archiveAndIngestQuote({
        tenantId: tenant.id,
        sourceKind: 'quote',
        trade: 'commercial-painting',
        sourceId: shareToken,
        fullDocPath: `quotes/${quoteRow.id}.pdf`,
        kbText: markdown,
        contentHash,
      })
    })
  }

  return Response.json({
    ok: true,
    quoteId: quoteRow.id,
    shareToken,
    quoteViewUrl: `/q/${shareToken}`,
    pdfUrl: pdfReady ? `/api/q/${shareToken}/pdf` : null,
    delivery: { attempted: false },
  })
}
