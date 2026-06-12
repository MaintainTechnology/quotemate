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

import { createClient } from '@supabase/supabase-js'
import { tenantFromBearer, estimatorSupabase } from '@/lib/estimation/auth'
import { buildPaintQuotePayloads } from '@/lib/commercial-painting/save-quote-helpers'
import { buildPaintTenderReportHtml } from '@/lib/commercial-painting/report-html'
import { gotenbergConfigured, renderPdfFromHtml } from '@/lib/pdf/gotenberg'
import { generateShareToken } from '@/lib/stripe/checkout'
import type { PricedPaintBom } from '@/lib/commercial-painting/types'

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

  let body: { paintRunId?: string; extractionId?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const paintRunId = body.paintRunId?.trim()
  const extractionId = body.extractionId?.trim()
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
      .select('id, priced_bom')
      .eq('id', extractionId)
      .eq('paint_run_id', paintRunId)
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
  ])
  if (!run) return Response.json({ ok: false, error: 'run_not_found' }, { status: 404 })
  const bom = (ext?.priced_bom ?? null) as PricedPaintBom | null
  if (!bom) {
    return Response.json(
      { ok: false, error: 'not_priced', detail: 'Price the confirmed takeoff before saving a quote.' },
      { status: 422 },
    )
  }

  const { data: tenantRow } = await estimatorSupabase
    .from('tenants')
    .select('business_name')
    .eq('id', tenant.id)
    .maybeSingle()
  const businessName = (tenantRow?.business_name as string | null) ?? 'Your painter'

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

  const appUrl = process.env.APP_URL ?? 'https://quote-mate-rho.vercel.app'
  const quoteViewUrl = `${appUrl}/q/${shareToken}`

  // ── Tender PDF — best-effort, never blocks the quote. ─────────────
  let pdfReady = false
  if (gotenbergConfigured()) {
    try {
      const html = buildPaintTenderReportHtml({
        businessName,
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
      }
    } catch {
      // PDF is a bonus; the quote record is the deliverable.
    }
  }

  return Response.json({
    ok: true,
    quoteId: quoteRow.id,
    shareToken,
    quoteViewUrl,
    pdfUrl: pdfReady ? `${appUrl}/api/q/${shareToken}/pdf` : null,
  })
}
