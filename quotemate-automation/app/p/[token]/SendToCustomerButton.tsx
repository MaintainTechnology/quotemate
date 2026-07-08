'use client'

// Tradie "Send to customer" action on the /p review page. Releases the held
// painting quote (stamps released_at + texts the customer their full quote)
// via POST /api/painting/release/[estimate_token]. Idempotent server-side, so
// a double-click never re-texts; the button just reflects the sent state.

import { useEffect, useRef, useState } from 'react'

export function SendToCustomerButton({
  estimateToken,
  released,
}: {
  estimateToken: string
  released: boolean
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>(released ? 'sent' : 'idle')
  const [err, setErr] = useState<string | null>(null)
  // Resend of an already-released quote (spec tradie-onsite-quote-editing R5)
  // — after an on-site edit the tradie re-texts the updated quote. POSTs
  // { resend: true }; the server sends without restamping released_at.
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current) }, [])

  const send = async () => {
    setState('sending')
    setErr(null)
    try {
      const res = await fetch(`/api/painting/release/${estimateToken}`, { method: 'POST' })
      const j = await res.json()
      if (j.ok) setState('sent')
      else {
        setState('error')
        setErr(j.error ?? 'Could not send the quote.')
      }
    } catch (e) {
      setState('error')
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const resend = async () => {
    // A stale reset timer from a previous resend must not flip the state back
    // to idle while this request is in flight.
    if (resetTimer.current) clearTimeout(resetTimer.current)
    setResendState('sending')
    setErr(null)
    try {
      const res = await fetch(`/api/painting/release/${estimateToken}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resend: true }),
      })
      const j = await res.json()
      if (j.ok) {
        setResendState('done')
        resetTimer.current = setTimeout(() => setResendState('idle'), 4000)
      } else {
        setResendState('error')
        setErr(j.error ?? 'Could not resend the quote.')
      }
    } catch (e) {
      setResendState('error')
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  if (state === 'sent') {
    return (
      <span className="inline-flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 border border-accent bg-accent/10 px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-accent">
          ✓ Sent to customer
        </span>
        <button
          type="button"
          onClick={resend}
          disabled={resendState === 'sending'}
          className="inline-flex items-center gap-2 border border-ink-line px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {resendState === 'sending' ? 'Resending…' : 'Resend updated quote'}
        </button>
        {resendState === 'done' && (
          <span className="font-mono text-sm uppercase tracking-[0.14em] text-accent">✓ Resent</span>
        )}
        {resendState === 'error' && err && <span className="text-sm text-warning">{err}</span>}
      </span>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={send}
        disabled={state === 'sending'}
        className="inline-flex items-center gap-2 bg-accent px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === 'sending' ? 'Sending…' : (<>Send to customer <span aria-hidden="true">&rarr;</span></>)}
      </button>
      {err && <span className="text-sm text-warning">{err}</span>}
    </span>
  )
}
