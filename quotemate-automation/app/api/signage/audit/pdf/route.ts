// POST /api/signage/audit/pdf — render the current signage compliance
// pre-check report to a PDF and stream it back. The instant audit (POST
// /api/signage/audit) returns the ComplianceReport inline and persists
// nothing, so — like the aircon recommender — the PDF is rendered on
// demand from the report the dashboard already holds.
//
// Auth: same org bearer as the audit route.

import { createClient } from '@supabase/supabase-js'
import { orgFromBearer } from '@/lib/signage/org'
import { renderPdfFromHtml, gotenbergConfigured } from '@/lib/pdf/gotenberg'
import { buildSignageReportHtml } from '@/lib/signage/report-html'
import type { ComplianceReport } from '@/lib/signage/compose-report'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/** Light structural guard for the report payload. */
function looksLikeReport(v: unknown): v is ComplianceReport {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return !!r.counts && typeof r.counts === 'object' && Array.isArray(r.groups)
}

export async function POST(req: Request) {
  const auth = await orgFromBearer(supabase, req)
  if (!auth) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  if (!gotenbergConfigured()) {
    return Response.json({ ok: false, error: 'PDF service not configured' }, { status: 503 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const b = (body ?? {}) as { brandName?: unknown; report?: unknown }
  if (!looksLikeReport(b.report)) {
    return Response.json({ ok: false, error: 'invalid_report' }, { status: 400 })
  }

  let pdf: Buffer
  try {
    const html = buildSignageReportHtml({
      brandName: typeof b.brandName === 'string' && b.brandName.trim() ? b.brandName : 'Brand',
      report: b.report,
    })
    pdf = await renderPdfFromHtml(html)
  } catch (e) {
    console.error('[signage/audit/pdf] render failed', e instanceof Error ? e.message : e)
    return Response.json({ ok: false, error: 'PDF unavailable right now — try again shortly' }, { status: 503 })
  }

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="signage-compliance.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
