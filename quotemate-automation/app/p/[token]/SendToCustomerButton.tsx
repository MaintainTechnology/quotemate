'use client'

// Tradie "Send to customer" action on the /p review page. Releases the held
// painting quote (stamps released_at + texts the customer their full quote)
// via POST /api/painting/release/[estimate_token]. Idempotent server-side, so
// a double-click never re-texts; the button just reflects the sent state.

import { useState } from 'react'

export function SendToCustomerButton({
  estimateToken,
  released,
}: {
  estimateToken: string
  released: boolean
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>(released ? 'sent' : 'idle')
  const [err, setErr] = useState<string | null>(null)

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

  if (state === 'sent') {
    return (
      <span className="inline-flex items-center gap-2 border border-accent bg-accent/10 px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-accent">
        ✓ Sent to customer
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
