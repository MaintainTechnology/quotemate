'use client'

import { getAuthToken } from '@/lib/auth/client-token'
// The de-modaled document workspace (spec 2026-07-06 §5, Phase 1 Task E). One
// living document: branding bar + live editor + a single "Save & Apply Edits"
// bar. Content + branding save through the money-free POST /api/quote/[id]/
// document; pricing is a locked node whose "Edit prices" hands off to the
// grounded Pricing section (onEditPrices). Holds one working draft; typing and
// branding changes mark it dirty until saved.

import { useCallback, useState } from 'react'
import QuoteDocumentEditor, { type DocEditorTiers } from './QuoteDocumentEditor'
import BrandingControl from './BrandingControl'
import type { ReportDoc } from '@/lib/quote/report-doc/types'
import type { ReportStyle } from '@/lib/quote/report-doc/style'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export type QuoteDocumentWorkspaceProps = {
  /** Quote id for the save endpoint. Omit in the dev harness for a mock save. */
  quoteId?: string
  /** Supabase access token (Bearer) for the owner-gated save. */
  authToken?: string
  initialDoc: ReportDoc
  initialStyle: ReportStyle
  tiers: DocEditorTiers | null
  /** "Edit prices" hand-off to the grounded Pricing section. */
  onEditPrices?: () => void
}

export default function QuoteDocumentWorkspace({
  quoteId,
  authToken,
  initialDoc,
  initialStyle,
  tiers,
  onEditPrices,
}: QuoteDocumentWorkspaceProps) {
  const [doc, setDoc] = useState<ReportDoc>(initialDoc)
  const [style, setStyle] = useState<ReportStyle>(initialStyle)
  const [dirty, setDirty] = useState(false)
  const [save, setSave] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  const onDoc = useCallback((d: ReportDoc) => {
    setDoc(d)
    setDirty(true)
    setSave('idle')
  }, [])

  const onStyle = useCallback((s: ReportStyle) => {
    setStyle(s)
    setDirty(true)
    setSave('idle')
  }, [])

  const onSave = useCallback(async () => {
    // Dev harness (no quote/token): mock a successful save.
    if (!quoteId || !authToken) {
      setDirty(false)
      setSave('saved')
      return
    }
    setSave('saving')
    setError(null)
    try {
      // Dual-auth: mint a FRESH token immediately before the POST. Clerk's
      // default session token expires ~60s after mount, so the `authToken` prop
      // captured by the parent is stale by the time the tradie clicks Save.
      const token = (await getAuthToken()) ?? authToken
      const res = await fetch(`/api/quote/${quoteId}/document`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ report_doc: doc, report_style: style }),
      })
      if (res.ok) {
        setDirty(false)
        setSave('saved')
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setSave('error')
        setError(body?.error ?? `save failed (${res.status})`)
      }
    } catch {
      setSave('error')
      setError('network error')
    }
  }, [quoteId, authToken, doc, style])

  return (
    <div className="qm-workspace">
      <BrandingControl value={style} onChange={onStyle} />
      <QuoteDocumentEditor value={initialDoc} tiers={tiers} onChange={onDoc} onEditPrices={onEditPrices} />
      <div className="qm-savebar" role="status">
        <span className={`qm-save-state qm-save-${save}`}>
          {save === 'saving'
            ? 'Saving…'
            : save === 'saved' && !dirty
              ? 'Saved'
              : save === 'error'
                ? `Couldn’t save — ${error}`
                : dirty
                  ? 'Unsaved changes'
                  : ''}
        </span>
        <button
          type="button"
          className="qm-save-btn"
          disabled={!dirty || save === 'saving'}
          onClick={onSave}
          data-testid="save-apply"
        >
          Save &amp; Apply Edits
        </button>
      </div>
    </div>
  )
}
