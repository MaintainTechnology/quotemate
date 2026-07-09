'use client'

// Owner-only floating pill on trade CUSTOMER quote pages (/q/roof, /q/paint,
// /q/commercial-paint, /q/aircon) — spec tradie-onsite-quote-editing R3.
//
// On mount it asks /api/tenant/trade-jobs/owner-link (bearer auth) whether the
// signed-in visitor owns this job. Owners always get the "← Dashboard" link;
// the edit link renders only when the server returns a tradieHref (a tradie
// detail page /m/…//p/…, or a static dashboard workspace tab for trades
// without one). Customers and signed-out visitors see nothing — the tradie
// token never reaches a non-owner.
//
// Portalled to document.body for the same reason as TradieEditor: QuoteChrome's
// <main> creates a stacking context that would paint a fixed banner behind the
// sticky header/footer/noise overlay.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getAuthToken } from '@/lib/auth/client-token'

export function TradieJobBanner({
  trade,
  publicToken,
  editLabel = 'Review & edit',
}: {
  trade: 'roofing' | 'painting' | 'commercial-painting' | 'aircon'
  publicToken: string
  editLabel?: string
}) {
  const [check, setCheck] = useState<{ tradieHref: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const token = await getAuthToken()
      if (!token) return // no session → can't be the tradie; render nothing
      try {
        const res = await fetch(
          `/api/tenant/trade-jobs/owner-link?trade=${trade}&token=${encodeURIComponent(publicToken)}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
        )
        if (!res.ok) return
        const body = (await res.json()) as { owner?: boolean; tradieHref?: string | null }
        if (!cancelled && body.owner === true) {
          setCheck({ tradieHref: typeof body.tradieHref === 'string' ? body.tradieHref : null })
        }
      } catch {
        /* silent — the customer page must never break on this */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [trade, publicToken])

  if (!check || typeof document === 'undefined') return null
  return createPortal(
    // qm-tradie-pill: portalled outside .qm-quote, so the scoped qm-print-hide
    // rule can't reach it — an unscoped @media print rule hides it instead.
    <div className="qm-tradie-pill fixed top-16 right-3 z-40 max-w-[90vw]">
      <div className="flex flex-wrap items-center justify-end gap-3 bg-accent text-white px-4 py-2.5 shadow-lg">
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] font-bold">
          Tradie
        </span>
        <a
          href="/dashboard"
          className="font-mono text-[0.65rem] uppercase tracking-[0.14em] font-bold border border-accent-ink/50 text-accent-ink px-3 py-1 hover:bg-accent-ink/10 transition-colors whitespace-nowrap"
        >
          &larr; Dashboard
        </a>
        {check.tradieHref && (
          <a
            href={check.tradieHref}
            className="font-mono text-[0.65rem] uppercase tracking-[0.14em] font-bold bg-white text-accent px-3 py-1 hover:bg-white/90 transition-colors whitespace-nowrap"
          >
            {editLabel} &rarr;
          </a>
        )}
      </div>
    </div>,
    document.body,
  )
}
