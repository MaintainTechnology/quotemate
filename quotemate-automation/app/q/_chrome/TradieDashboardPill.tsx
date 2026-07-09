'use client'

// Owner-only "← Dashboard" pill for customer quote pages that have no other
// tradie affordance (solar today — its page has no TradieEditor and no
// trade-jobs banner, so the signed-in tradie was stranded with no route back).
//
// Same gate as TradieEditor: on mount it asks /api/quote/[id]/check-owner with
// the visitor's bearer token; only the tradie who owns the quote's tenant sees
// the pill. Customers and signed-out visitors (including the Gotenberg PDF
// render, which has no session) see nothing.
//
// Portalled to document.body for the same reason as TradieEditor: QuoteChrome's
// <main> would trap a fixed element behind the sticky header/footer/grain.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { getAuthToken } from '@/lib/auth/client-token'

export function TradieDashboardPill({
  quoteId,
  editHref,
  editLabel = 'Edit pricing',
}: {
  quoteId: string
  // Optional owner-only edit link (e.g. the solar dashboard tab — the only
  // edit path that keeps the displayed price and the charged price in sync).
  editHref?: string
  editLabel?: string
}) {
  const [check, setCheck] = useState<{ owner: boolean; tenantBusinessName?: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const token = await getAuthToken()
      if (!token) return // no session → can't be the tradie; render nothing
      try {
        const res = await fetch(`/api/quote/${quoteId}/check-owner`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (!res.ok) return
        const body = (await res.json()) as { owner: boolean; tenantBusinessName?: string }
        if (!cancelled && body.owner === true) setCheck(body)
      } catch {
        /* silent — the customer page must never break on this */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [quoteId])

  if (!check?.owner || typeof document === 'undefined') return null
  return createPortal(
    // qm-tradie-pill: portalled outside .qm-quote, so the scoped qm-print-hide
    // rule can't reach it — an unscoped @media print rule hides it instead.
    <div className="qm-tradie-pill fixed top-16 right-3 z-40 max-w-[90vw]">
      <div className="flex flex-wrap items-center justify-end gap-3 bg-accent text-white px-4 py-2.5 shadow-lg">
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] font-bold">
          Tradie · {check.tenantBusinessName ?? 'You'}
        </span>
        <Link
          href="/dashboard"
          className={`font-mono text-[0.65rem] uppercase tracking-[0.14em] font-bold px-3 py-1 transition-colors whitespace-nowrap ${
            editHref
              ? 'border border-accent-ink/50 text-accent-ink hover:bg-accent-ink/10'
              : 'bg-white text-accent hover:bg-white/90'
          }`}
        >
          ← Dashboard
        </Link>
        {editHref && (
          <Link
            href={editHref}
            className="font-mono text-[0.65rem] uppercase tracking-[0.14em] font-bold bg-white text-accent px-3 py-1 hover:bg-white/90 transition-colors whitespace-nowrap"
          >
            {editLabel} →
          </Link>
        )}
      </div>
    </div>,
    document.body,
  )
}
