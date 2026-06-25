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
import { getReportAdapter } from '@/lib/quote/report-adapters/registry'
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
    .select('id, intake_id, tenant_id, good, better, best, needs_inspection, paid_at')
    .eq('share_token', token)
    .maybeSingle()
  if (!quote) notFound()

  // Trade lives on the intake (legacy rows without it default to electrical,
  // matching /q/[token]).
  const { data: intake } = quote.intake_id
    ? await supabase.from('intakes').select('trade').eq('id', quote.intake_id).maybeSingle()
    : { data: null }
  const trade = ((intake?.trade as string | null | undefined) ?? 'electrical').trim() || 'electrical'

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

  return (
    <QuoteReportViewerClient
      quoteId={quote.id as string}
      shareToken={token}
      trade={trade}
      gstRegistered={gstRegistered}
      needsInspection={!!quote.needs_inspection}
      paid={!!quote.paid_at}
      bodyMode={adapter.bodyMode}
      pdfUrl={adapter.pdfPath(token)}
      capabilities={adapter.capabilities}
      tiers={{
        good: (quote.good as ViewerTier) ?? null,
        better: (quote.better as ViewerTier) ?? null,
        best: (quote.best as ViewerTier) ?? null,
      }}
    />
  )
}
