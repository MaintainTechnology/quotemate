// /onboard/stripe/refresh — Stripe redirects here when an onboarding
// account link expires or is reused before the tradie finishes (account
// links are single-use + short-lived). Job of this page: silently mint a
// fresh link and bounce the tradie straight back into the Stripe flow.
//
// Client component because re-minting the link calls
// POST /api/stripe/connect/start, which is Bearer-authed with the
// tradie's Supabase session.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getBrowserSupabase } from '@/lib/supabase/client'

type State =
  | { phase: 'working' }
  | { phase: 'signin' }
  | { phase: 'error'; message: string }

export default function StripeConnectRefresh() {
  const [state, setState] = useState<State>({ phase: 'working' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const supabase = getBrowserSupabase()
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token ?? null
        if (!token) {
          if (!cancelled) setState({ phase: 'signin' })
          return
        }
        const res = await fetch('/api/stripe/connect/start', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = await res.json().catch(() => null)
        if (res.ok && json?.ok && json.url) {
          window.location.href = json.url as string
          return
        }
        if (!cancelled) {
          setState({
            phase: 'error',
            message:
              json?.detail || json?.error || `Couldn't restart onboarding (HTTP ${res.status}).`,
          })
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-16 text-center">
      <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-text-dim">
        Payout setup
      </span>

      {state.phase === 'working' && (
        <>
          <h1 className="mt-4 font-extrabold uppercase text-[clamp(1.8rem,5vw,3rem)] leading-[0.95] tracking-[-0.04em]">
            Reconnecting you<br />
            <span className="text-accent">to Stripe&hellip;</span>
          </h1>
          <p className="mt-6 max-w-md text-text-dim">
            Your secure onboarding link expired. Generating a fresh one — hold tight.
          </p>
        </>
      )}

      {state.phase === 'signin' && (
        <>
          <h1 className="mt-4 font-extrabold uppercase text-[clamp(1.8rem,5vw,3rem)] leading-[0.95] tracking-[-0.04em]">
            Sign in to<br />
            <span className="text-accent">continue</span>
          </h1>
          <p className="mt-6 max-w-md text-text-dim">
            Sign in to your QuoteMax account, then restart payout setup from the dashboard.
          </p>
          <Link
            href="/signin"
            className="mt-8 inline-block bg-accent px-8 py-4 font-extrabold uppercase tracking-tight text-white"
          >
            Sign in
          </Link>
        </>
      )}

      {state.phase === 'error' && (
        <>
          <h1 className="mt-4 font-extrabold uppercase text-[clamp(1.8rem,5vw,3rem)] leading-[0.95] tracking-[-0.04em]">
            Something<br />
            <span className="text-accent">went wrong</span>
          </h1>
          <p className="mt-6 max-w-md text-text-dim">{state.message}</p>
          <Link
            href="/dashboard"
            className="mt-8 inline-block bg-accent px-8 py-4 font-extrabold uppercase tracking-tight text-white"
          >
            Back to dashboard
          </Link>
        </>
      )}
    </main>
  )
}
