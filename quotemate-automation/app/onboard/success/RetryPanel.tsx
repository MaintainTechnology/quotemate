// Retry panel rendered on /onboard/success when activation finished
// but Twilio + Vapi provisioning didn't (most often: TWILIO_* env vars
// missing on Vercel, or no AU inventory). Hits the /api/onboard/retry-
// provision endpoint with the user's Supabase session, so the existing
// tenant row gets the number stamped without going back through the
// wizard (which would fail on the unique-email constraint).

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase/client'

export function RetryPanel({ warning }: { warning: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRetry() {
    setBusy(true)
    setError(null)
    try {
      const supabase = getBrowserSupabase()
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) {
        setError('Not signed in. Open the dashboard to retry.')
        setBusy(false)
        return
      }
      const res = await fetch('/api/onboard/retry-provision', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!body.ok) {
        setError(body.error ?? `Retry failed (HTTP ${res.status})`)
        setBusy(false)
        return
      }
      // Number assigned — bounce back through /onboard/success with the
      // phone in the URL so the celebration screen re-renders correctly.
      const sp = new URLSearchParams({
        tenant: body.tenantId,
        phone: body.phoneNumber ?? '',
      })
      router.replace(`/onboard/success?${sp.toString()}`)
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? 'Retry failed')
      setBusy(false)
    }
  }

  return (
    <div className="mt-6 flex flex-col items-center gap-3">
      {warning && (
        <p className="max-w-lg text-sm text-amber-300/90 font-mono leading-snug">
          {warning}
        </p>
      )}
      <button
        type="button"
        onClick={handleRetry}
        disabled={busy}
        className="inline-flex items-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-6 py-3 text-xs uppercase tracking-wider transition-colors disabled:opacity-50"
      >
        {busy ? 'Retrying provisioning…' : 'Retry provisioning'}
      </button>
      {error && (
        <p className="max-w-lg text-sm text-amber-300 font-mono leading-snug text-center">
          {error}
        </p>
      )}
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-text-dim text-center max-w-md">
        Or hit /api/onboard/preflight in your browser to see which env vars are missing on this deploy.
      </p>
    </div>
  )
}
