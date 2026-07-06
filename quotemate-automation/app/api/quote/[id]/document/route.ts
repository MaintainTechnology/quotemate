// POST /api/quote/[id]/document — persist the quote DOCUMENT (report_doc) and
// per-quote branding (report_style). Spec 2026-07-06 §6.3.
//
// This is a deliberately SEPARATE, focused write from the money route
// (/api/quote/[id]/edit): it touches NO money field — no good/better/best, no
// Stripe re-issue, no grounding gate, no status bump, no customer notify. A
// document/branding edit therefore CANNOT affect pricing by construction. It
// reuses /edit's owner-gate + paid/inspection guards, and nulls the PDF cache so
// the next render reflects the new content (when FULL_QUOTE_DOC is on).
//
// Owner-gate = Bearer → auth.getUser → load quote → quote.tenant → require
// tenant.owner_user_id === userId. Identity comes from the token, never the body
// or path (no IDOR).

import { createClient } from '@supabase/supabase-js'
import { sanitizeReportDoc } from '@/lib/quote/report-doc/sanitize'
import { validateReportStyle } from '@/lib/quote/report-doc/style'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: quoteId } = await params

  // ─── Auth (identity from Bearer only) ───────────────────────
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const token = auth.slice(7).trim()
  if (!token) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData.user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  // ─── Body ───────────────────────────────────────────────────
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const body = (raw ?? {}) as { report_doc?: unknown; report_style?: unknown }
  const hasDoc = body.report_doc !== undefined
  const hasStyle = body.report_style !== undefined
  if (!hasDoc && !hasStyle) {
    return Response.json({ ok: false, error: 'no_changes' }, { status: 400 })
  }

  // ─── Load + authorise (mirrors /edit) ───────────────────────
  const { data: quote } = await supabase
    .from('quotes')
    .select('id, tenant_id, paid_at, needs_inspection')
    .eq('id', quoteId)
    .maybeSingle()
  if (!quote) return Response.json({ ok: false, error: 'no_quote' }, { status: 404 })
  if (!quote.tenant_id) {
    return Response.json({ ok: false, error: 'unscoped_quote' }, { status: 403 })
  }
  if (quote.paid_at) {
    return Response.json({ ok: false, error: 'quote_already_paid' }, { status: 409 })
  }
  if (quote.needs_inspection) {
    return Response.json({ ok: false, error: 'cannot_edit_inspection_quote' }, { status: 409 })
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, owner_user_id')
    .eq('id', quote.tenant_id)
    .maybeSingle()
  if (!tenant || tenant.owner_user_id !== userId) {
    return Response.json({ ok: false, error: 'not_owner' }, { status: 403 })
  }

  // ─── Validate + persist (quiet, PDF-cache invalidated) ──────
  const update: Record<string, unknown> = { pdf_path: null, pdf_signature: null }
  if (hasDoc) update.report_doc = sanitizeReportDoc(body.report_doc)
  if (hasStyle) {
    // `null` explicitly clears the override; any other invalid value is rejected.
    const style = validateReportStyle(body.report_style)
    if (body.report_style !== null && style === null) {
      return Response.json({ ok: false, error: 'invalid_style' }, { status: 400 })
    }
    update.report_style = style
  }

  const { error } = await supabase.from('quotes').update(update).eq('id', quoteId)
  if (error) {
    return Response.json({ ok: false, error: 'save_failed' }, { status: 500 })
  }
  return Response.json({ ok: true })
}
