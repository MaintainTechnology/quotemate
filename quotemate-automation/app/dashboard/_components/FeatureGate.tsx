'use client'

// Client-side feature gate for dedicated dashboard tool routes
// (/dashboard/painting, /dashboard/aircon, /dashboard/roofing/measure, …).
//
// Calls the lightweight GET /api/tenant/features, checks the tenant's trades[]
// for the gating slug, and renders the tool only when allowed. A disabled
// feature shows a "not enabled" panel with a link back to the dashboard rather
// than the tool — so a deep-link to a feature the tenant doesn't have can't
// reach the UI. The matching server requireFeature guard blocks the APIs, so
// this is UX, not the security boundary.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getAuthToken } from '@/lib/auth/client-token'
import { tenantHasFeature } from '@/lib/features/catalog'

export type FeatureGateState = 'loading' | 'allowed' | 'denied' | 'signed-out'

export function useFeatureGate(slug: string): FeatureGateState {
  const [state, setState] = useState<FeatureGateState>('loading')
  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Mint a FRESH token per request — a Clerk user has no Supabase session,
      // and even a legacy Supabase token captured at mount expires. getAuthToken()
      // returns a current Clerk token (or the legacy Supabase one), or null.
      const token = await getAuthToken()
      if (!token) {
        if (!cancelled) setState('signed-out')
        return
      }
      try {
        const res = await fetch('/api/tenant/features', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const json = (await res.json()) as { ok: boolean; trades?: string[] }
        if (cancelled) return
        setState(json.ok && tenantHasFeature(json.trades ?? [], slug) ? 'allowed' : 'denied')
      } catch {
        if (!cancelled) setState('denied')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug])
  return state
}

export function FeatureGate({
  slug,
  featureLabel,
  children,
}: {
  slug: string
  featureLabel: string
  children: React.ReactNode
}) {
  const state = useFeatureGate(slug)
  if (state === 'allowed') return <>{children}</>
  if (state === 'loading') {
    return <GateNotice>Checking access…</GateNotice>
  }
  if (state === 'signed-out') {
    return (
      <GateNotice>
        Sign in to use {featureLabel}.{' '}
        <Link href="/signin" className="text-accent hover:underline">
          Sign in
        </Link>
      </GateNotice>
    )
  }
  return (
    <GateNotice>
      <strong className="text-text-pri">{featureLabel} isn&rsquo;t enabled for your account.</strong>
      <span className="mt-2 block">
        Ask the QuoteMax team to switch it on, or head back to your{' '}
        <Link href="/dashboard" className="text-accent hover:underline">
          dashboard
        </Link>
        .
      </span>
    </GateNotice>
  )
}

function GateNotice({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <div className="mx-auto max-w-3xl px-6 pt-20 sm:px-10">
        <div className="flex flex-wrap items-center gap-3 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
          <Link href="/dashboard" className="transition-colors hover:text-text-pri">
            Dashboard
          </Link>
          <span className="text-ink-line">/</span>
          <span className="text-text-pri">Feature</span>
        </div>
        <div className="rounded-card edge-lit mt-8 border border-ink-line bg-ink-card px-6 py-8 text-base leading-relaxed text-text-sec">
          {children}
        </div>
      </div>
    </main>
  )
}
