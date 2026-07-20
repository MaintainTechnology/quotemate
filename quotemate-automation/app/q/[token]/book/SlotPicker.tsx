'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BookingOption } from '@/lib/quote/slots'

type Status = 'idle' | 'submitting' | 'done' | 'error'

export function SlotPicker({
  token,
  options,
  tier,
  endpoint,
  labels,
}: {
  token: string
  /** AM/PM half-day windows (or legacy exact-time slots) to choose from.
   *  Each carries the canonical instant (`iso`) posted to the book API. */
  options: BookingOption[]
  /** Tier the customer chose on the quote page — passed to the book API
   *  so the deposit step at the end charges the right amount. */
  tier?: string
  /** Where to POST the chosen slot. Defaults to the quotes book route.
   *  The already-paid trade surfaces (roof/paint) pass their own
   *  /api/q/book/<trade>/<token> route — there is no deposit step after, so
   *  they also override `labels`. Whatever the endpoint returns as `next`
   *  is where we send the customer. */
  endpoint?: string
  /** Button copy for the three states. Defaults suit the quotes book-then-pay
   *  flow ("...& pay deposit"); the trade surfaces pass booking-only copy. */
  labels?: { idle?: string; submitting?: string; done?: string }
}) {
  const postUrl = endpoint ?? `/api/q/${token}/book`
  const idleLabel = labels?.idle ?? 'Hold this time & pay deposit →'
  const submittingLabel = labels?.submitting ?? 'Holding…'
  const doneLabel = labels?.done ?? 'Taking you to deposit…'

  // Group by day. `options` are already future-only and date-sorted by the
  // server (resolveBookingOptions), so no client filter or sort is needed.
  const groups = useMemo(() => {
    const g: { day: string; items: { iso: string; chip: string }[] }[] = []
    for (const o of options) {
      let row = g.find((x) => x.day === o.dayLabel)
      if (!row) {
        row = { day: o.dayLabel, items: [] }
        g.push(row)
      }
      row.items.push({ iso: o.iso, chip: o.chipLabel })
    }
    return g
  }, [options])

  // Two-step, mobile-first: pick a DAY from a compact horizontal strip, then
  // the times for that day. This keeps the picker ~2 rows tall instead of a
  // fortnight of stacked day blocks the customer has to scroll through.
  const [selectedDay, setSelectedDay] = useState<string | null>(groups[0]?.day ?? null)
  const [picked, setPicked] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // The sticky confirm bar is portaled OUT of this component's tree: a
  // position:fixed bar nested under a transformed ancestor (the animated quote
  // sections) gets trapped in that stacking context and hides behind the
  // QuoteChrome deposit footer. Portaling to the nearest `.qm-quote` scope
  // frees it (so z-30 wins over the footer's z-25) while keeping the light/dark
  // theme tokens; on the standalone book page it falls back to document.body.
  const rootRef = useRef<HTMLDivElement>(null)
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setPortalHost((rootRef.current?.closest('.qm-quote') as HTMLElement | null) ?? document.body)
  }, [])

  const activeDay = groups.find((g) => g.day === selectedDay) ?? groups[0] ?? null
  const pickedOption = picked ? (options.find((o) => o.iso === picked) ?? null) : null

  async function onConfirm() {
    if (!picked) return
    setStatus('submitting')
    setErrorMessage(null)
    try {
      const res = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: picked, tier }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `Couldn't hold that time (HTTP ${res.status}).`)
      }
      setStatus('done')
      // The endpoint returns where to send the customer next (the pay
      // short-link for book-then-pay, or the reloaded page for the already-
      // paid trade surfaces). Fall back to a reload if absent.
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
  const bookLabel = status === 'submitting' ? submittingLabel : status === 'done' ? doneLabel : idleLabel

  return (
    <div ref={rootRef}>
      {/* Step 1 — pick a day. Horizontal strip so a fortnight stays one row. */}
      <div className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
        Choose a day
      </div>
      <div
        className="mt-2 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:thin]"
        role="group"
        aria-label="Choose a day"
      >
        {groups.map((g) => {
          const isSelected = g.day === (activeDay?.day ?? null)
          return (
            <button
              key={g.day}
              type="button"
              onClick={() => setSelectedDay(g.day)}
              disabled={locked}
              aria-pressed={isSelected}
              className={`shrink-0 whitespace-nowrap border px-3.5 py-2.5 text-sm font-bold tracking-tight transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                isSelected
                  ? 'border-accent bg-accent text-ink-deep'
                  : 'border-ink-line bg-ink-card text-text-sec hover:border-accent/60'
              } ${locked ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              {g.day}
            </button>
          )
        })}
      </div>

      {/* Step 2 — pick a time on that day. */}
      <div className="mt-5 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
        Choose a time
      </div>
      <div className="mt-2 flex flex-wrap gap-2.5" role="group" aria-label={`Times on ${activeDay?.day ?? ''}`}>
        {activeDay?.items.map(({ iso, chip }) => {
          const isPicked = picked === iso
          return (
            <button
              key={iso}
              type="button"
              onClick={() => setPicked(iso)}
              disabled={locked}
              aria-pressed={isPicked}
              className={`border px-5 py-3.5 text-base font-bold tracking-tight transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                isPicked
                  ? 'border-accent bg-accent text-ink-deep'
                  : 'border-ink-line bg-ink-card text-text-pri hover:border-accent/60'
              } ${locked ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              {chip}
            </button>
          )
        })}
      </div>

      {errorMessage ? (
        <p className="mt-4 font-mono text-[0.75rem] uppercase tracking-widest text-red-400">
          {errorMessage}
        </p>
      ) : null}

      {/* Sticky confirm bar — pops up once a time is picked so the customer
          never has to scroll to find the button (mirrors the Pay $99 CTA).
          Portaled to `.qm-quote` so z-30 clears the QuoteChrome footer. */}
      {portalHost && picked && pickedOption
        ? createPortal(
        <div
          className="qm-print-hide motion-safe:animate-[fade-up_180ms_ease-out_both]"
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 30,
            borderTop: '1px solid var(--ink-line)',
            background: 'var(--ink-card)',
            padding: '12px 20px',
            boxShadow: '0 -8px 24px -12px rgba(0,0,0,0.4)',
          }}
        >
          <div
            style={{
              maxWidth: 'var(--qm-sheet-w, 560px)',
              margin: '0 auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9.5,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  color: 'var(--text-dim)',
                }}
              >
                Your visit time
              </div>
              <div
                style={{
                  marginTop: 3,
                  fontWeight: 800,
                  fontSize: 15,
                  color: 'var(--text-pri)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {pickedOption.dayLabel} · {pickedOption.chipLabel}
              </div>
            </div>
            <button
              type="button"
              onClick={onConfirm}
              disabled={locked}
              aria-busy={status === 'submitting'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 9,
                border: '1px solid transparent',
                background: 'var(--accent)',
                color: 'var(--accent-ink)',
                padding: '13px 22px',
                fontFamily: 'var(--font-sans)',
                fontWeight: 700,
                fontSize: 13,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                whiteSpace: 'nowrap',
                cursor: locked ? 'default' : 'pointer',
                opacity: locked ? 0.75 : 1,
              }}
            >
              {bookLabel}
            </button>
          </div>
        </div>,
            portalHost,
          )
        : null}
    </div>
  )
}
