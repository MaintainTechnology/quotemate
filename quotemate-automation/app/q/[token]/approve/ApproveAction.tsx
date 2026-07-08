'use client'

// Mig 078 — client component for the tradie "Send now" button on the
// /q/<token>/approve page. Captures the signed-in tradie's Supabase
// access token from the browser session and POSTs it to
// /api/quote/[id]/approve, then renders a confirmation badge.

import { useEffect, useState } from 'react'
import { getAuthToken } from '@/lib/auth/client-token'

export function ApproveAction({
  quoteId,
  shareToken,
}: {
  quoteId: string
  shareToken: string
}) {
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Soft visual cue while we resolve the session.
  const [sessionReady, setSessionReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const token = await getAuthToken()
      if (cancelled) return
      setAccessToken(token)
      setSessionReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function approve() {
    if (busy || sent) return
    // Dual-auth: mint a FRESH token immediately before the fetch. Clerk's
    // default session token expires ~60s after it is minted, so a token
    // captured in the mount effect would be stale by click time; and a
    // Clerk-authed tradie has no Supabase session at all. Fall back to the
    // mount-captured token only if getAuthToken returns nothing.
    const token = (await getAuthToken()) ?? accessToken
    if (!token) {
      setError('Sign in as the tradie owner to approve. (Open /signin in a new tab, then come back.)')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/quote/${encodeURIComponent(quoteId)}/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        message?: string
        channel?: string
        already_actioned?: boolean
      }
      if (!res.ok || !json.ok) {
        setError(json.message || json.error || `HTTP ${res.status}`)
        return
      }
      setSent(true)
    } catch (e: any) {
      setError(e?.message ?? 'Approve failed')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="inline-flex items-center gap-3 bg-success/10 border border-success/40 text-[#4ade80] px-4 py-3 font-mono text-xs uppercase tracking-[0.15em] font-bold">
        ✓ Sent to customer
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={approve}
        disabled={busy || !sessionReady}
        className="inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-press text-white font-mono text-xs uppercase tracking-[0.15em] font-bold px-5 py-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Sending…' : !sessionReady ? 'Loading…' : 'Send now →'}
      </button>
      {error ? (
        <div className="ml-2 inline-block font-mono text-[0.65rem] uppercase tracking-[0.14em] text-warning">
          {error}
        </div>
      ) : null}
      {/* Hint when not signed in — only renders after the session check
          resolves. The {shareToken} is intentionally referenced so the
          sign-in flow can deep-link back here. */}
      {sessionReady && !accessToken ? (
        <a
          href={`/signin?next=${encodeURIComponent(`/q/${shareToken}/approve`)}`}
          className="ml-2 font-mono text-[0.7rem] uppercase tracking-[0.15em] text-accent hover:text-accent-press underline"
        >
          Sign in to send
        </a>
      ) : null}
    </>
  )
}
