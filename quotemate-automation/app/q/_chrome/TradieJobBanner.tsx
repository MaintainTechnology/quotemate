'use client'

// Owner-only floating pill on the roofing/painting CUSTOMER quote pages
// (/q/roof/[token], /q/paint/[token]) — spec tradie-onsite-quote-editing R3.
//
// On mount it asks /api/tenant/trade-jobs/owner-link (bearer auth) whether the
// signed-in visitor owns this job; only then does the server return the tradie
// detail link (/m/[measure_token] or /p/[estimate_token]) and the pill render.
// Customers and signed-out visitors see nothing — the tradie token never
// reaches a non-owner.
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
}: {
  trade: 'roofing' | 'painting'
  publicToken: string
}) {
  const [tradieHref, setTradieHref] = useState<string | null>(null)

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
        if (!cancelled && body.owner === true && typeof body.tradieHref === 'string') {
          setTradieHref(body.tradieHref)
        }
      } catch {
        /* silent — the customer page must never break on this */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [trade, publicToken])

  if (!tradieHref || typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed top-16 right-3 z-40 max-w-[90vw]">
      <div className="flex items-center gap-3 bg-accent text-white px-4 py-2.5 shadow-lg">
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] font-bold">
          Tradie
        </span>
        <a
          href={tradieHref}
          className="font-mono text-[0.65rem] uppercase tracking-[0.14em] font-bold bg-white text-accent px-3 py-1 hover:bg-white/90 transition-colors"
        >
          Review &amp; edit &rarr;
        </a>
      </div>
    </div>,
    document.body,
  )
}
