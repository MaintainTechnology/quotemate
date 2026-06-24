// The SMS estimator's async analysis pipeline (migration 104).
//
// Fired from after() in the customer plan-upload route once the PDF is
// stored and the plan_upload_requests row is 'analysing'. Reuses the exact
// dashboard estimator pieces — runExtraction (lib/estimation/extract),
// priceTakeoff + loadElectricalPricingContext (the same grounded pricer the
// /api/tenant/estimator/price route uses) — no forked extraction path.
//
//   download plan.pdf → runExtraction → plan_extractions (+share_token)
//   → auto-price → priced_bom → Gotenberg report.pdf (best-effort)
//   → request complete → results SMS (+ best-effort MMS attachment)
//
// Failure marks the request 'failed' (token stays live for a retry on the
// same link) and SMSes the customer the same upload URL.

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { runExtraction, type ExtractionItem } from './extract'
import { priceTakeoff, type PricedBom } from './price'
import { loadElectricalPricingContext } from './pricing-context'
import { buildPlanReportHtml } from './report-html'
import { loadTenantBranding } from '@/lib/pdf/branding'
import {
  buildPlanResultsSms,
  buildPlanFailureSms,
} from './plan-request'
import { planUploadUrl, planResultsUrl, planReportPdfUrl } from '@/lib/sms/plan-estimation'
import { downloadPlanPdf, uploadPlanPdf, signPlanPdfUrl } from '@/lib/storage/plan-pdf'
import { renderPdfFromHtml, gotenbergConfigured } from '@/lib/pdf/gotenberg'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

type RequestRow = {
  id: string
  token: string
  tenant_id: string
  sms_conversation_id: string | null
  customer_phone: string
  twilio_number: string | null
  status: string
  plan_upload_id: string | null
}

async function updateRequest(id: string, patch: Record<string, unknown>) {
  await supabase
    .from('plan_upload_requests')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
}

/** Best-effort first name for the SMS greeting. */
async function customerFirstName(phone: string, tenantId: string): Promise<string | null> {
  const { data } = await supabase
    .from('customers')
    .select('first_name')
    .eq('phone_number', phone)
    .eq('tenant_id', tenantId)
    .limit(1)
    .maybeSingle()
  return (data?.first_name as string | null) ?? null
}

/** Send an SMS to the request's customer (best-effort MMS when mediaUrl
 *  given — dispatch auto-falls back to plain SMS, then WhatsApp) and log it
 *  on the conversation thread. */
async function smsCustomer(req: RequestRow, body: string, mediaUrl?: string) {
  const result = await dispatchQuoteMessage({
    to: req.customer_phone,
    text: body,
    from: req.twilio_number ?? process.env.TWILIO_SMS_NUMBER,
    ...(mediaUrl ? { mediaUrl } : {}),
  })
  if (result.ok) {
    console.log('[sms-run] customer message sent', {
      requestId: req.id,
      channel: result.channel,
      mms: 'mms' in result ? result.mms : false,
      mediaDropped: 'mediaDropped' in result ? result.mediaDropped : false,
    })
    if (req.sms_conversation_id) {
      await supabase.from('sms_messages').insert({
        conversation_id: req.sms_conversation_id,
        direction: 'outbound',
        body,
        twilio_message_sid: result.sid,
      })
      await supabase
        .from('sms_conversations')
        .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', req.sms_conversation_id)
    }
  } else {
    console.error('[sms-run] customer message failed', { requestId: req.id, ...result.smsAttempt })
  }
  return result
}

export async function runSmsPlanAnalysis(requestId: string): Promise<void> {
  const { data: req } = await supabase
    .from('plan_upload_requests')
    .select('id, token, tenant_id, sms_conversation_id, customer_phone, twilio_number, status, plan_upload_id')
    .eq('id', requestId)
    .maybeSingle<RequestRow>()
  if (!req) {
    console.error('[sms-run] request not found', { requestId })
    return
  }
  if (req.status === 'complete') return // idempotent re-fire
  if (!req.plan_upload_id) {
    console.error('[sms-run] request has no plan_upload_id', { requestId })
    return
  }

  const [{ data: upload }, { data: tenant }, firstName] = await Promise.all([
    supabase
      .from('plan_uploads')
      .select('id, filename, sheet_hint, pdf_path')
      .eq('id', req.plan_upload_id)
      .maybeSingle(),
    supabase.from('tenants').select('business_name').eq('id', req.tenant_id).maybeSingle(),
    customerFirstName(req.customer_phone, req.tenant_id),
  ])
  const businessName = (tenant?.business_name as string | undefined) ?? 'Your tradie'
  const branding = await loadTenantBranding(supabase, req.tenant_id, 'electrical')

  const fail = async (error: string) => {
    console.error('[sms-run] analysis failed', { requestId, error })
    await updateRequest(req.id, { status: 'failed', error })
    await smsCustomer(req, buildPlanFailureSms({ firstName, uploadUrl: planUploadUrl(req.token) }))
  }

  if (!upload?.pdf_path) {
    await fail('stored PDF missing')
    return
  }

  // 1. Pull the stored plan back and run the SAME take-off the dashboard uses.
  let pdf: Buffer
  try {
    pdf = await downloadPlanPdf(upload.pdf_path as string)
  } catch (e) {
    await fail(`pdf download: ${e instanceof Error ? e.message : String(e)}`)
    return
  }

  let extraction
  try {
    extraction = await runExtraction({ pdf, sheetHint: (upload.sheet_hint as string | null) ?? '' })
  } catch (e) {
    await fail(`extraction: ${e instanceof Error ? e.message : String(e)}`)
    return
  }
  if (!extraction.parsed) {
    await fail('model returned no readable take-off')
    return
  }

  // 2. Persist the extraction with a public share token (the customer's
  //    read-only results page key).
  const shareToken = randomBytes(16).toString('hex')
  const { data: saved, error: exErr } = await supabase
    .from('plan_extractions')
    .insert({
      plan_upload_id: req.plan_upload_id,
      tenant_id: req.tenant_id,
      items: extraction.parsed.items,
      sheets_used: extraction.parsed.sheets_used,
      overall_note: extraction.parsed.overall_note || null,
      model: extraction.model,
      runtime_seconds: extraction.runtimeSeconds,
      share_token: shareToken,
    })
    .select('id')
    .single()
  if (exErr || !saved) {
    await fail(`save extraction: ${exErr?.message ?? 'no row'}`)
    return
  }
  const extractionId = saved.id as string

  // 3. Auto-price through the shared grounded pricer (identical math + data
  //    path to the dashboard's price route).
  let bom: PricedBom | null = null
  try {
    const { assemblies, book } = await loadElectricalPricingContext(supabase, req.tenant_id)
    bom = priceTakeoff(extraction.parsed.items, assemblies, book)
    await supabase
      .from('plan_extractions')
      .update({ priced_bom: bom, priced_at: new Date().toISOString() })
      .eq('id', extractionId)
      .eq('tenant_id', req.tenant_id)
  } catch (e) {
    // Pricing is additive — a counts-only result is still a valid outcome.
    console.error('[sms-run] auto-price failed (continuing counts-only)', {
      requestId,
      message: e instanceof Error ? e.message : String(e),
    })
  }

  // 4. Gotenberg report PDF (best-effort — the web results page is the
  //    primary surface; the PDF is the traditional-document bonus).
  let reportPath: string | null = null
  if (gotenbergConfigured()) {
    try {
      const html = buildPlanReportHtml({
        businessName: branding.businessName,
        branding,
        filename: (upload.filename as string) ?? 'plan.pdf',
        items: extraction.parsed.items as ExtractionItem[],
        sheetsUsed: extraction.parsed.sheets_used,
        overallNote: extraction.parsed.overall_note,
        bom,
      })
      const reportPdf = await renderPdfFromHtml(html)
      reportPath = await uploadPlanPdf({ requestId: req.id, kind: 'report', data: reportPdf })
      await supabase
        .from('plan_extractions')
        .update({ report_pdf_path: reportPath })
        .eq('id', extractionId)
        .eq('tenant_id', req.tenant_id)
    } catch (e) {
      console.error('[sms-run] report PDF failed (continuing without)', {
        requestId,
        message: e instanceof Error ? e.message : String(e),
      })
      reportPath = null
    }
  } else {
    console.warn('[sms-run] GOTENBERG_URL not set — skipping report PDF')
  }

  // 5. Mark the run complete BEFORE messaging — if the SMS fails the
  //    customer can still be sent the links manually from the dashboard.
  await updateRequest(req.id, { status: 'complete', error: null, plan_extraction_id: extractionId })

  // 6. Results SMS (+ best-effort MMS attachment of the report PDF).
  //    AU long codes generally reject MMS media; dispatchQuoteMessage
  //    detects the failure and re-sends as plain SMS automatically, and the
  //    body always carries both links.
  const lineCount = extraction.parsed.items.length
  const deviceCount = extraction.parsed.items.reduce((sum, it) => sum + it.count, 0)
  const body = buildPlanResultsSms({
    firstName,
    businessName,
    resultsUrl: planResultsUrl(shareToken),
    // Only advertise the PDF link when a report was actually stored —
    // otherwise /api/q/plan/[token]/pdf 404s on a dead-on-arrival link.
    pdfUrl: reportPath ? planReportPdfUrl(shareToken) : null,
    lineCount,
    deviceCount,
    totalIncGst: bom?.totalIncGst ?? null,
  })
  let mediaUrl: string | undefined
  if (reportPath) {
    try {
      mediaUrl = await signPlanPdfUrl(reportPath, 60 * 60) // 1h — Twilio fetches immediately
    } catch {
      mediaUrl = undefined
    }
  }
  await smsCustomer(req, body, mediaUrl)
  console.log('[sms-run] complete', { requestId, extractionId, lineCount, deviceCount, priced: !!bom, report: !!reportPath })
}
