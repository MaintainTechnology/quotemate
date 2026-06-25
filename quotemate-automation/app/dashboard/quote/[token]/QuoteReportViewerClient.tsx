'use client'

// QuoteReportViewerClient — the trade-agnostic viewer shell for the dashboard
// "View PDF" flow. Renders the report body (inline PDF for electrical/plumbing;
// a download card for trades whose adapter isn't built yet) plus a toolbar:
// Edit · Download PDF · Edit with AI. Edit and Edit-with-AI drive the existing
// TradieEditor (mounted hidden) via its imperative onReady handle; the editor
// owns auth, grounding, Stripe re-issue, PDF regeneration, and notify. After a
// save we bump the iframe key so the regenerated PDF reloads.
//
// Per-trade behaviour comes entirely from the props the server resolved off the
// adapter (bodyMode / capabilities / pdfUrl) — this component knows nothing
// trade-specific, which is what lets new trades light up without touching it.

import { useMemo, useState } from 'react'
import TradieEditor, { type EditorApi } from '@/app/q/[token]/TradieEditor'

type Tier = {
  label?: string
  timeframe?: string
  subtotal_ex_gst?: number
  line_items?: Array<{
    description: string
    quantity: number
    unit?: string
    unit_price_ex_gst: number
    total_ex_gst?: number
    source?: string
  }>
} | null

export default function QuoteReportViewerClient(props: {
  quoteId: string
  shareToken: string
  trade: string
  gstRegistered: boolean
  needsInspection: boolean
  paid: boolean
  bodyMode: 'pdf-inline' | 'download-only'
  pdfUrl: string
  capabilities: { manualEdit: boolean; aiEdit: boolean }
  tiers: { good: Tier; better: Tier; best: Tier }
}) {
  const {
    quoteId,
    shareToken,
    trade,
    gstRegistered,
    needsInspection,
    paid,
    bodyMode,
    pdfUrl,
    capabilities,
    tiers,
  } = props

  const [api, setApi] = useState<EditorApi | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const owner = !!api?.canEdit // owner of an unpaid quote (resolved by TradieEditor)
  const canEdit = capabilities.manualEdit && owner && !needsInspection && !paid
  const canAi = capabilities.aiEdit && owner && !needsInspection && !paid

  const disabledReason = useMemo(() => {
    if (!capabilities.manualEdit) return `Editing isn’t available for ${trade} quotes yet — view & download only.`
    if (paid) return 'This quote is paid and can’t be edited.'
    if (needsInspection) return 'Inspection quotes are a flat $99 — there are no tiers to edit.'
    if (!owner) return 'Sign in as the quote owner to edit.'
    return null
  }, [capabilities.manualEdit, paid, needsInspection, owner, trade])

  const inlineSrc = `${pdfUrl}${pdfUrl.includes('?') ? '&' : '?'}disposition=inline&v=${reloadKey}`

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      {/* ─── Toolbar (modelled on the report-viewer reference) ─── */}
      <div className="sticky top-0 z-30 border-b border-ink-line bg-ink-deep/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim">
            Quote report · <span className="text-text-sec">{trade}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => api?.openEditor()}
              disabled={!canEdit}
              title={!canEdit ? disabledReason ?? undefined : undefined}
              className="inline-flex min-h-[40px] items-center gap-2 border border-ink-line px-4 py-2 text-xs font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-ink-line disabled:hover:text-text-pri"
            >
              ✎ Edit Report
            </button>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[40px] items-center gap-2 border border-ink-line px-4 py-2 text-xs font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent"
            >
              ↓ Download PDF
            </a>
            <button
              type="button"
              onClick={() => api?.openEditor({ chat: true })}
              disabled={!canAi}
              title={!canAi ? disabledReason ?? undefined : undefined}
              className="inline-flex min-h-[40px] items-center gap-2 bg-accent px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
            >
              ⚡ Edit with AI
              <span className="rounded-sm bg-white/20 px-1.5 py-0.5 font-mono text-[0.55rem] leading-none">
                Beta
              </span>
            </button>
          </div>
        </div>
        {disabledReason && (
          <div className="mx-auto max-w-5xl px-4 pb-2 sm:px-6">
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-text-dim">
              {disabledReason}
            </p>
          </div>
        )}
      </div>

      {/* ─── Report body ─── */}
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {bodyMode === 'pdf-inline' ? (
          <iframe
            key={reloadKey}
            src={inlineSrc}
            title="Quote PDF"
            className="h-[80vh] w-full rounded border border-ink-line bg-white"
          />
        ) : (
          <div className="flex flex-col items-center gap-4 rounded border border-ink-line bg-ink-card px-6 py-16 text-center">
            <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-text-dim">
              Inline preview not available yet for {trade}
            </div>
            <p className="max-w-md text-sm text-text-sec">
              Download the PDF to view this quote. An in-page preview and editing for{' '}
              {trade} are coming as each trade is wired up.
            </p>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[44px] items-center gap-2 bg-accent px-5 py-3 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-accent-press"
            >
              ↓ Download PDF
            </a>
          </div>
        )}
      </div>

      {/* ─── Hidden editor: owns auth + grounding + save; toolbar drives it ─── */}
      {capabilities.manualEdit && (
        <TradieEditor
          quoteId={quoteId}
          gstRegistered={gstRegistered}
          initialTiers={tiers}
          hideBanner
          onReady={setApi}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      )}
    </main>
  )
}
