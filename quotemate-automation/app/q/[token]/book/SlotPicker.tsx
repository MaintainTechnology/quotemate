'use client'

import { useState } from 'react'
import type { BookingOption } from '@/lib/quote/slots'

type Status = 'idle' | 'submitting' | 'done' | 'error'

export function SlotPicker({
  token,
  options,
  tier,
}: {
  token: string
  /** AM/PM half-day windows (or legacy exact-time slots) to choose from.
   *  Each carries the canonical instant (`iso`) posted to the book API. */
  options: BookingOption[]
  /** Tier the customer chose on the quote page — passed to the book API
   *  so the deposit step at the end charges the right amount. */
  tier?: string
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Group by day heading so the whole fortnight fits on one screen: one
  // compact block per day, AM/PM windows as chips, blocks flow into a
  // responsive multi-column grid. `options` are already future-only and
  // date-sorted by the server (resolveBookingOptions), so no client filter.
  const groups: { day: string; items: { iso: string; chip: string }[] }[] = []
  for (const o of options) {
    let g = groups.find((x) => x.day === o.dayLabel)
    if (!g) {
      g = { day: o.dayLabel, items: [] }
      groups.push(g)
    }
    g.items.push({ iso: o.iso, chip: o.chipLabel })
  }

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

  if (options.length === 0) {
    return (
      <p className="border border-ink-line bg-ink-card p-5 font-mono text-[0.8rem] uppercase tracking-[0.12em] text-text-dim">
        No upcoming slots are open. Your tradie will SMS you to arrange a time.
      </p>
    )
  }

  const locked = status === 'submitting' || status === 'done'

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <div
            key={g.day}
            className="border border-ink-line bg-ink-card p-3"
          >
            <div className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
              {g.day}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {g.items.map(({ iso, chip }) => {
                const isPicked = picked === iso
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => setPicked(iso)}
                    disabled={locked}
                    aria-pressed={isPicked}
                    className={`border px-3 py-2 text-sm font-bold tracking-tight transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      isPicked
                        ? 'border-accent bg-accent text-white'
                        : 'border-ink-line text-text-pri hover:border-accent/60'
                    } ${locked ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    {chip}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onConfirm}
        disabled={!picked || locked}
        className={`mt-6 inline-flex w-full items-center justify-center gap-2 px-5 py-3.5 text-sm font-semibold uppercase tracking-wider transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${
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
