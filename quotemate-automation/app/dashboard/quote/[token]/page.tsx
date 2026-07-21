// Dashboard PDF quote viewer — /dashboard/quote/[token].
//
// Reached from the "View PDF" action on each dashboard quote card. Loads the
// quote by share_token (service-role; same token trust model as /q/[token]),
// resolves the per-trade report adapter, and hands plain data to the
// trade-agnostic viewer shell. Owner-gating of the edit/AI actions happens
// client-side inside TradieEditor (via /api/quote/[id]/check-owner), exactly
// like the customer page — viewing is by unguessable token, editing is
// owner-only.

import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import { getReportAdapter, tradeRendersOwnQuotePdf } from '@/lib/quote/report-adapters/registry'
import { resolveCustomerContact } from '@/lib/quote/send-customer'
import { buildDefaultReportDoc } from '@/lib/quote/report-doc/seed'
import type { ReportDoc } from '@/lib/quote/report-doc/types'
import type { ReportStyle } from '@/lib/quote/report-doc/style'
import QuoteReportViewerClient from './QuoteReportViewerClient'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export default async function DashboardQuoteViewerPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const { data: quote } = await supabase
    .from('quotes')
    .select(
      'id, intake_id, tenant_id, good, better, best, needs_inspection, paid_at, selected_tier, scope_of_works, assumptions, report_doc, report_style',
    )
    .eq('share_token', token)
    .maybeSingle()
  if (!quote) notFound()

  // Trade lives on the intake (legacy rows without it default to electrical,
  // matching /q/[token]).
  const { data: intake } = quote.intake_id
    ? await supabase
        .from('intakes')
        .select('trade, job_type, caller, call_id, customer_id')
        .eq('id', quote.intake_id)
        .maybeSingle()
    : { data: null }
  const trade = ((intake?.trade as string | null | undefined) ?? 'electrical').trim() || 'electrical'

  // Customer contact on file for the "Send to Customer" panel.
  const contact = await resolveCustomerContact(supabase, {
    caller: (intake?.caller as { phone?: string; email?: string } | null) ?? null,
    intakeId: (quote.intake_id as string | null) ?? null,
    callId: (intake?.call_id as string | null) ?? null,
    customerId: (intake?.customer_id as string | null) ?? null,
  })

  // GST flag for the line-item editor's inc-GST display.
  let gstRegistered = true
  if (quote.tenant_id) {
    const { data: pb } = await supabase
      .from('pricing_book')
      .select('gst_registered')
      .eq('tenant_id', quote.tenant_id)
      .eq('trade', trade)
      .limit(1)
      .maybeSingle()
    gstRegistered = !!(pb?.gst_registered ?? true)
  }

  const adapter = getReportAdapter(trade)
  type ViewerTier = Parameters<typeof QuoteReportViewerClient>[0]['tiers']['good']

  // Phase 1 living-document editor, flag-gated (default off ⇒ prod unchanged).
  // Seed a default document from the quote's fields when none is stored yet, so
  // the editor opens with today's title/scope/pricing/assumptions.
  const docEditorEnabled = process.env.FULL_QUOTE_DOC === 'true'
  const reportDoc =
    (quote.report_doc as ReportDoc | null) ??
    buildDefaultReportDoc({
      title: ((intake?.job_type as string | null | undefined) ?? '').replace(/_/g, ' ').trim(),
      scopeOfWorks: quote.scope_of_works as string | null,
      assumptions: quote.assumptions as string[] | null,
    })

  return (
    <QuoteReportViewerClient
      quoteId={quote.id as string}
      shareToken={token}
      trade={trade}
      gstRegistered={gstRegistered}
      needsInspection={!!quote.needs_inspection}
      paid={!!quote.paid_at}
      customerPhone={contact.phone}
      customerEmail={contact.email}
      docEditorEnabled={docEditorEnabled}
      reportDoc={reportDoc}
      reportStyle={(quote.report_style as ReportStyle | null) ?? {}}
      selectedTier={(quote.selected_tier as 'good' | 'better' | 'best' | null) ?? null}
      bodyMode={adapter.bodyMode}
      editorKind={adapter.editorKind}
      pdfUrl={adapter.pdfPath(token)}
      // Live, edit-reactive HTML render of the same report the PDF is built
      // from — the viewer prefers this over the frozen PDF iframe. Electrical /
      // plumbing store good/better/best, which /api/q/[token]/html renders via
      // buildQuoteReportHtml. RC-1: commercial painting authors its own tender
      // PDF with no generic HTML equivalent, so we withhold htmlUrl and let the
      // viewer embed the tender PDF inline — the preview then matches the
      // downloaded/MMS'd document instead of a generic Good/Better/Best render.
      htmlUrl={tradeRendersOwnQuotePdf(trade) ? undefined : `/api/q/${token}/html`}
      capabilities={adapter.capabilities}
      tiers={{
        good: (quote.good as ViewerTier) ?? null,
        better: (quote.better as ViewerTier) ?? null,
        best: (quote.best as ViewerTier) ?? null,
      }}
    />
  )
}
