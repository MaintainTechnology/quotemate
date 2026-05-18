'use client'

import { useState } from 'react'

type Status = 'idle' | 'submitting' | 'done' | 'error'

function formatSlot(iso: string): { day: string; time: string } {
  const d = new Date(iso)
  const day = d.toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Australia/Sydney',
  })
  const time = d.toLocaleString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Australia/Sydney',
  })
  return { day, time }
}

export function SlotPicker({
  token,
  slots,
  tier,
}: {
  token: string
  slots: string[]
  /** Tier the customer chose on the quote page — passed to the book API
   *  so the deposit step at the end charges the right amount. */
  tier?: string
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Sort by time ascending; future slots only.
  const now = Date.now()
  const visible = [...slots]
    .filter((s) => {
      const t = Date.parse(s)
      return Number.isFinite(t) && t > now
    })
    .sort((a, b) => Date.parse(a) - Date.parse(b))

  async function onConfirm() {
    if (!picked) return
    setStatus('submitting')
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/q/${token}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: picked, tier }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `Couldn't hold that time (HTTP ${res.status}).`)
      }
      setStatus('done')
      // Book-first / pay-last: the time is now reserved on the quote.
      // Send the customer straight to the deposit step (the LAST step) —
      // the booking is confirmed once that's paid. `next` is the pay
      // short-link returned by the API; fall back to a reload if absent.
      setTimeout(() => {
        if (typeof json?.next === 'string' && json.next) {
          window.location.href = json.next as string
        } else {
          window.location.reload()
        }
      }, 600)
    } catch (err: any) {
      setStatus('error')
      setErrorMessage(err?.message ?? 'Booking failed. Try another slot or reply to your SMS.')
    }
  }

  if (visible.length === 0) {
    return (
      <p className="border border-ink-line bg-ink-card p-5 font-mono text-[0.8rem] uppercase tracking-[0.12em] text-text-dim">
        No upcoming slots are open. Your tradie will SMS you to arrange a time.
      </p>
    )
  }

  const locked = status === 'submitting' || status === 'done'

  return (
    <div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {visible.map((iso) => {
          const { day, time } = formatSlot(iso)
          const isPicked = picked === iso
          return (
            <li key={iso}>
              <button
                type="button"
                onClick={() => setPicked(iso)}
                disabled={locked}
                className={`w-full border p-4 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  isPicked
                    ? 'border-accent bg-accent text-white'
                    : 'border-ink-line bg-ink-card text-text-pri hover:border-accent/60'
                } ${locked ? 'cursor-not-allowed opacity-50' : ''}`}
                aria-pressed={isPicked}
              >
                <div
                  className={`font-mono text-[0.65rem] font-semibold uppercase tracking-[0.16em] ${
                    isPicked ? 'text-white/80' : 'text-text-dim'
                  }`}
                >
                  {day}
                </div>
                <div className="mt-1.5 text-xl font-extrabold tracking-tight">
                  {time}
                </div>
              </button>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={onConfirm}
        disabled={!picked || locked}
        className={`mt-8 inline-flex w-full items-center justify-center gap-2 px-5 py-3.5 text-sm font-semibold uppercase tracking-wider transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          !picked || locked
            ? 'cursor-not-allowed border border-ink-line bg-ink-card text-text-dim'
            : 'bg-accent text-white hover:bg-accent-press'
        }`}
      >
        {status === 'submitting'
          ? 'Holding…'
          : status === 'done'
            ? 'Taking you to deposit…'
            : 'Hold this time & pay deposit →'}
      </button>

      {errorMessage ? (
        <p className="mt-4 font-mono text-[0.75rem] uppercase tracking-widest text-red-400">
          {errorMessage}
        </p>
      ) : null}
    </div>
  )
}
